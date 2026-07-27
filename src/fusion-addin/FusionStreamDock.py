"""Fusion 360 add-in: serves Fusion's context to the Stream Dock plugin and runs the
commands it sends back.

Threading model, which is the whole reason this file is shaped the way it is:

    HTTP thread (fsd_bridge)  --queue-->  fireCustomEvent  -->  main thread  -->  execute()

Fusion is single threaded and its API must not be touched from a worker thread. Commands
arriving over HTTP are therefore queued and drained inside a CustomEvent handler, which runs
on the main thread. execute() is forbidden inside command-related events but permitted inside
a CustomEvent handler -- which is exactly where our input lands.

fireCustomEvent from a daemon thread is not always reliable, so the periodic poll doubles as
a backup drain for the command queue.
"""

import json
import os
import queue
import sys
import threading
import traceback

import adsk.core

_ADDIN_DIR = os.path.dirname(os.path.realpath(__file__))
if _ADDIN_DIR not in sys.path:
    sys.path.insert(0, _ADDIN_DIR)

# Module names are prefixed because sys.path is shared with every other installed add-in.
import fsd_bridge  # noqa: E402
import fsd_commands  # noqa: E402
import fsd_state  # noqa: E402

COMMAND_EVENT_ID = "FusionStreamDockCommand"
POLL_EVENT_ID = "FusionStreamDockPoll"

# Fast enough that entering a sketch feels immediate on the device, slow enough to be
# invisible against Fusion's own workload. Events cover most transitions; this catches the
# ones with no event (entering sketch edit mode) and re-drains dropped commands.
POLL_INTERVAL_SECONDS = 0.4

_app = None
_ui = None
_bridge = None
_handlers = []  # must outlive run(); Fusion garbage-collects unreferenced handlers
_command_queue = queue.Queue(maxsize=64)
_command_event = None
_poll_event = None
_stop_flag = None
_poll_thread = None
_last_state_key = None


def _log(message):
    try:
        if _app:
            _app.log("[StreamDock] %s" % message)
    except Exception:
        pass


def _load_config():
    path = os.path.join(_ADDIN_DIR, "config.json")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


def _refresh_state(force=False):
    """Read Fusion's context and publish it if anything the device cares about changed.

    Main thread only.
    """
    global _last_state_key
    if not _bridge:
        return
    try:
        state = fsd_state.read_state(_app, _ui)
    except Exception:
        _log("state read failed: %s" % traceback.format_exc())
        return
    key = fsd_state.state_key(state)
    if force or key != _last_state_key:
        _last_state_key = key
        _bridge.publish(state)


def _drain_commands():
    """Run every queued command. Main thread only."""
    while True:
        try:
            payload = _command_queue.get_nowait()
        except queue.Empty:
            return
        try:
            _run_command(payload)
        except Exception:
            _log("command failed: %s" % traceback.format_exc())


def _run_command(payload):
    action = payload.get("action")
    if action == "execute":
        ok, message = fsd_commands.execute(_app, _ui, payload.get("id"))
    elif action == "text":
        ok, message = fsd_commands.execute_text_sequence(_app, payload.get("text"))
    elif action == "view":
        ok, message = fsd_commands.set_view(_app, payload.get("view"))
    elif action == "refresh":
        _refresh_state(force=True)
        return
    else:
        ok, message = False, "unknown action: %r" % action

    if not ok:
        _log("%s -> %s" % (payload.get("id") or payload.get("text"), message))
        # Tell the plugin so it can flash the key rather than leaving the user guessing
        # whether the press registered at all.
        _bridge.publish(
            {
                "type": "commandResult",
                "ok": False,
                "id": payload.get("id"),
                "message": message,
            }
        )
        # The failure notice is transient; put the real state back so the plugin does not
        # sit on a commandResult as if it were the current context.
        _refresh_state(force=True)


class _CommandEventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            _drain_commands()
        except Exception:
            _log("command handler: %s" % traceback.format_exc())


class _PollEventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            # Backup drain first: if fireCustomEvent was dropped, this is what rescues it.
            _drain_commands()
            _refresh_state()
        except Exception:
            _log("poll handler: %s" % traceback.format_exc())


class _UiChangeHandler(adsk.core.ApplicationCommandEventHandler):
    """Fires on command start/terminate. Reads state only -- never starts a command here."""

    def notify(self, args):
        try:
            _refresh_state()
        except Exception:
            pass


class _WorkspaceHandler(adsk.core.WorkspaceEventHandler):
    def notify(self, args):
        try:
            _refresh_state()
        except Exception:
            pass


class _SelectionHandler(adsk.core.ActiveSelectionEventHandler):
    def notify(self, args):
        try:
            _refresh_state()
        except Exception:
            pass


def _poll_loop(stop_flag):
    """Background heartbeat. Does no Fusion work itself -- only asks the main thread to."""
    while not stop_flag.wait(POLL_INTERVAL_SECONDS):
        try:
            _app.fireCustomEvent(POLL_EVENT_ID, "")
        except Exception:
            # Fusion is shutting down or mid-reload; the stop flag will end this shortly.
            pass


def _on_command_from_plugin(payload):
    """Called on the HTTP thread. Must not touch the Fusion API."""
    try:
        _command_queue.put_nowait(payload)
    except queue.Full:
        return
    try:
        _app.fireCustomEvent(COMMAND_EVENT_ID, "")
    except Exception:
        # Dropped; the poll heartbeat will drain it within POLL_INTERVAL_SECONDS.
        pass


def run(context):
    global _app, _ui, _bridge, _command_event, _poll_event, _stop_flag, _poll_thread
    try:
        _app = adsk.core.Application.get()
        _ui = _app.userInterface

        fsd_commands.load_overrides(_ADDIN_DIR)
        config = _load_config()
        port = int(config.get("port", fsd_bridge.DEFAULT_PORT))

        _command_event = _app.registerCustomEvent(COMMAND_EVENT_ID)
        command_handler = _CommandEventHandler()
        _command_event.add(command_handler)
        _handlers.append(command_handler)

        _poll_event = _app.registerCustomEvent(POLL_EVENT_ID)
        poll_handler = _PollEventHandler()
        _poll_event.add(poll_handler)
        _handlers.append(poll_handler)

        for event, handler in (
            (_ui.commandTerminated, _UiChangeHandler()),
            (_ui.commandStarting, _UiChangeHandler()),
            (_ui.workspaceActivated, _WorkspaceHandler()),
            (_ui.activeSelectionChanged, _SelectionHandler()),
        ):
            event.add(handler)
            _handlers.append(handler)

        _bridge = fsd_bridge.Bridge(
            on_command=_on_command_from_plugin,
            list_commands=lambda: fsd_commands.list_commands(_ui),
            get_icon=lambda command_id: fsd_commands.resolve_icon(_ui, command_id),
            port=port,
            logger=_log,
        )
        _bridge.start()

        _stop_flag = threading.Event()
        _poll_thread = threading.Thread(
            target=_poll_loop, args=(_stop_flag,), name="fsd-poll", daemon=True
        )
        _poll_thread.start()

        _refresh_state(force=True)
        _log("add-in started on port %d" % port)
    except Exception:
        message = traceback.format_exc()
        _log("startup failed: %s" % message)
        if _ui:
            _ui.messageBox("Fusion Stream Dock failed to start:\n%s" % message)


def stop(context):
    global _bridge, _stop_flag, _poll_thread, _command_event, _poll_event, _last_state_key
    try:
        if _stop_flag:
            _stop_flag.set()
        if _poll_thread:
            _poll_thread.join(timeout=2.0)
            _poll_thread = None

        if _bridge:
            _bridge.publish({"type": "state", "connected": False})
            _bridge.stop()
            _bridge = None

        for event_id in (COMMAND_EVENT_ID, POLL_EVENT_ID):
            try:
                _app.unregisterCustomEvent(event_id)
            except Exception:
                pass
        _command_event = None
        _poll_event = None
        _handlers.clear()
        _last_state_key = None
        _log("add-in stopped")
    except Exception:
        if _ui:
            _ui.messageBox("Fusion Stream Dock failed to stop:\n%s" % traceback.format_exc())
