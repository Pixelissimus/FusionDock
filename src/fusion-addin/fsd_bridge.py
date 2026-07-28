"""HTTP + Server-Sent Events bridge between the Fusion add-in and the Stream Dock plugin.

Deliberately free of any Fusion imports so it can be exercised without Fusion running --
see tests/test_bridge.py. The add-in supplies callbacks; this module owns only the socket.

Endpoints:
    GET  /health            -> {"ok": true, "protocol": N, "build": {...which files are live}}
    GET  /events            -> SSE stream of state objects
    GET  /commands          -> JSON list of every known Fusion command
    GET  /tabs              -> JSON list of every workspace and its ribbon tabs
    GET  /icon?id=<cmdId>   -> PNG bytes for that command's icon
    POST /command           -> {"action": "execute", "id": "..."} queued for the main thread
"""

import collections
import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PROTOCOL_VERSION = 1

# Bound to loopback only. The plugin runs on the same machine by definition, and the add-in
# can execute arbitrary Fusion commands -- it must never be reachable off-box.
HOST = "127.0.0.1"
DEFAULT_PORT = 8731

# Dropped rather than buffered without limit if the plugin stalls or dies mid-stream.
_CLIENT_QUEUE_MAX = 32

# The Stream Dock host does not write a plugin's logMessage output anywhere readable, and the
# add-in's app.log does not reach Fusion's log file either. That left no way to see what the
# host actually sends -- key coordinates, controller names, dial payloads -- on a device whose
# SDK documentation is thin and partly wrong. The plugin mirrors raw host events here so they
# can be read back over HTTP during bring-up.
_DEBUG_MAX = 200


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # BaseHTTPRequestHandler logs every request to stderr, which inside Fusion means a
    # console that may not exist. Route it to the bridge's logger instead.
    def log_message(self, fmt, *args):
        self.server.bridge._log("http: " + (fmt % args))

    def _send(self, code, body=b"", content_type="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # The plugin page is served by the Stream Dock host, so it is a different origin.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _send_json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
        bridge = self.server.bridge

        if route == "/health":
            body = {"ok": True, "protocol": PROTOCOL_VERSION}
            try:
                body["build"] = bridge.status()
            except Exception as exc:
                body["build"] = {"error": str(exc)}
            self._send_json(200, body)
        elif route == "/events":
            self._stream_events()
        elif route == "/commands":
            try:
                self._send_json(200, {"commands": bridge.list_commands()})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
        elif route == "/tabs":
            # Same caveat as /commands: this reads the Fusion API from the HTTP thread rather
            # than marshalling to the main one. Both are read-only bring-up diagnostics meant
            # to be hit by hand, not by the device. Do not copy this into the key path.
            try:
                self._send_json(200, {"workspaces": bridge.list_tabs()})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
        elif route == "/icon":
            self._send_icon(parse_qs(parsed.query).get("id", [""])[0])
        elif route == "/debug":
            self._send_json(200, {"entries": bridge.debug_entries()})
        else:
            self._send_json(404, {"error": "not found"})

    def _send_icon(self, cmd_id):
        if not cmd_id:
            self._send_json(400, {"error": "missing id"})
            return
        try:
            data = self.server.bridge.get_icon(cmd_id)
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
            return
        if not data:
            self._send_json(404, {"error": "no icon"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        # Icon files only change when Fusion itself updates, and the add-in restarts with
        # Fusion, so a long cache is safe and saves repainting cost.
        self.send_header("Cache-Control", "max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def _stream_events(self):
        bridge = self.server.bridge
        client = queue.Queue(maxsize=_CLIENT_QUEUE_MAX)
        bridge._add_client(client)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            # Send current state immediately so a reconnecting plugin paints without
            # waiting for the next change.
            self._write_event(bridge.current_state())

            while not bridge._stopping.is_set():
                try:
                    payload = client.get(timeout=15.0)
                except queue.Empty:
                    # Comment frame doubles as a keep-alive and as the only reliable way
                    # to notice the client has gone away.
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                self._write_event(payload)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # client went away; normal
        finally:
            bridge._remove_client(client)

    def _write_event(self, payload):
        body = json.dumps(payload)
        self.wfile.write(("data: " + body + "\n\n").encode("utf-8"))
        self.wfile.flush()

    def do_POST(self):
        route = urlparse(self.path).path
        if route == "/debug":
            self._receive_debug()
            return
        if route != "/command":
            self._send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 65536:
            self._send_json(400, {"error": "bad length"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            self._send_json(400, {"error": "bad json: %s" % exc})
            return
        if not isinstance(payload, dict) or not payload.get("action"):
            self._send_json(400, {"error": "missing action"})
            return
        # Fire-and-forget: the command runs later on Fusion's main thread. Blocking here
        # would stall the plugin's UI for the length of a Fusion command.
        self.server.bridge.on_command(payload)
        self._send_json(202, {"accepted": True})

    def _receive_debug(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 65536:
            self._send_json(400, {"error": "bad length"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "bad json"})
            return
        self.server.bridge.record_debug(payload)
        self._send_json(202, {"accepted": True})


class Bridge:
    """Owns the HTTP server thread and the set of connected SSE clients."""

    def __init__(self, on_command, list_commands, get_icon, port=DEFAULT_PORT, logger=None,
                 list_tabs=None, status=None):
        self.on_command = on_command
        self.list_commands = list_commands
        self.get_icon = get_icon
        # Optional so the bridge stays constructible without Fusion, as tests do.
        self.list_tabs = list_tabs or (lambda: [])
        # Reports which add-in files are actually loaded -- see _module_status in the entry
        # point. Optional so the bridge still constructs without Fusion.
        self.status = status or (lambda: {})
        self.port = port
        self._logger = logger
        self._server = None
        self._thread = None
        self._clients = []
        self._clients_lock = threading.Lock()
        self._state = {"type": "state", "connected": False}
        self._stopping = threading.Event()
        self._debug = collections.deque(maxlen=_DEBUG_MAX)

    def _log(self, message):
        if self._logger:
            try:
                self._logger(message)
            except Exception:
                pass

    def start(self):
        self._stopping.clear()
        # Without this, restarting the add-in within the TIME_WAIT window fails to bind.
        ThreadingHTTPServer.allow_reuse_address = True
        self._server = ThreadingHTTPServer((HOST, self.port), _Handler)
        self._server.daemon_threads = True
        self._server.bridge = self
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="fsd-bridge", daemon=True
        )
        self._thread.start()
        self._log("bridge listening on %s:%d" % (HOST, self.port))

    def stop(self):
        self._stopping.set()
        # Wake every streaming client so its thread exits rather than sitting in get().
        with self._clients_lock:
            clients = list(self._clients)
        for client in clients:
            try:
                client.put_nowait({"type": "shutdown"})
            except queue.Full:
                pass
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread:
            self._thread.join(timeout=5.0)
            self._thread = None
        self._log("bridge stopped")

    def publish(self, state):
        """Broadcast a state object to every connected plugin."""
        self._state = state
        with self._clients_lock:
            clients = list(self._clients)
        for client in clients:
            try:
                client.put_nowait(state)
            except queue.Full:
                # A client this far behind is not going to catch up usefully; the next
                # state object supersedes this one anyway.
                self._log("dropped state for a slow client")

    def current_state(self):
        return self._state

    def record_debug(self, entry):
        # deque with maxlen is atomic enough for append under the GIL, and losing the oldest
        # entry is exactly the wanted behaviour.
        self._debug.append(entry)

    def debug_entries(self):
        return list(self._debug)

    def _add_client(self, client):
        with self._clients_lock:
            self._clients.append(client)
        self._log("plugin connected (%d total)" % len(self._clients))

    def _remove_client(self, client):
        with self._clients_lock:
            if client in self._clients:
                self._clients.remove(client)
        self._log("plugin disconnected (%d left)" % len(self._clients))

    @property
    def client_count(self):
        with self._clients_lock:
            return len(self._clients)
