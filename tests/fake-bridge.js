/*
 * Stand-in for the Fusion add-in, so the plugin can be exercised with neither Fusion nor
 * the N1 present.
 *
 * Speaks the same HTTP + SSE contract as fsd_bridge.py, and additionally serves the
 * simulator page and the real plugin sources so everything runs from one origin.
 *
 *   node tests/fake-bridge.js
 *   -> http://127.0.0.1:8731/_sim/
 *
 * Endpoints matching the real add-in:
 *   GET  /health  /events  /commands  /icon?id=
 *   POST /command
 * Simulator-only:
 *   POST /_sim/state   set the Fusion state that gets broadcast
 *   GET  /_sim/log     commands received so far
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.argv[2]) || 8731;
const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(
  ROOT, 'src', 'streamdock-plugin', 'com.fusiondock.streamdock.sdPlugin'
);

const clients = new Set();
const commandLog = [];

let state = {
  type: 'state',
  connected: true,
  workspace: 'FusionSolidEnvironment',
  workspaceName: 'Design',
  tab: 'SolidTab',
  tabName: 'Solid',
  inSketch: false,
  sketchName: null,
  activeCommand: 'SelectCommand',
  dialogOpen: false,
  selection: { count: 0, types: [] },
  documentName: 'Simulated Design v1',
  hasDesign: true
};

/* ------------------------------------------------------------------ fake icons */

function chunk(tag, data) {
  const payload = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(payload) >>> 0, 0);
  return Buffer.concat([length, payload, crc]);
}

/* A distinct glyph per command id, so the simulator shows visibly different keys the way
 * real Fusion icons would. Not representative artwork -- just enough to see layout work. */
function fakeIcon(id, size = 64) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const [r, g, b] = hslToRgb(hue / 360, 0.65, 0.62);
  const shape = hash % 3;
  const centre = size / 2;
  const radius = size * 0.32;

  const raw = Buffer.alloc(size * (1 + size * 3));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre + 0.5;
      const dy = y - centre + 0.5;
      let inside;
      if (shape === 0) {
        inside = Math.abs(Math.hypot(dx, dy) - radius) < size * 0.06;
      } else if (shape === 1) {
        inside = Math.abs(Math.max(Math.abs(dx), Math.abs(dy)) - radius) < size * 0.06;
      } else {
        inside = Math.abs(Math.abs(dx) + Math.abs(dy) - radius) < size * 0.06;
      }
      raw[offset] = inside ? r : 28;
      raw[offset + 1] = inside ? g : 28;
      raw[offset + 2] = inside ? b : 30;
      offset += 3;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/* ------------------------------------------------------------------ broadcasting */

function publish(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const response of clients) {
    try {
      response.write(frame);
    } catch (error) {
      clients.delete(response);
    }
  }
}

/* ------------------------------------------------------------------ static files */

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

function serveFile(filePath, response) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    response.end(data);
  });
}

/* ------------------------------------------------------------------ server */

function readBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (piece) => { body += piece; });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        resolve({});
      }
    });
  });
}

function json(response, code, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const route = url.pathname;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    response.end();
    return;
  }

  if (route === '/health') {
    json(response, 200, { ok: true, protocol: 1, simulated: true });
    return;
  }

  if (route === '/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    response.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  if (route === '/commands') {
    json(response, 200, { commands: [], simulated: true });
    return;
  }

  if (route === '/icon') {
    const id = url.searchParams.get('id') || '';
    if (!id) {
      json(response, 400, { error: 'missing id' });
      return;
    }
    const png = fakeIcon(id);
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': png.length,
      'Access-Control-Allow-Origin': '*'
    });
    response.end(png);
    return;
  }

  if (route === '/command' && request.method === 'POST') {
    const payload = await readBody(request);
    commandLog.push({ at: Date.now(), ...payload });
    console.log('  command:', JSON.stringify(payload));

    // Mimic the real add-in: a command that opens a dialog changes Fusion's state, and
    // the real add-in would push that back. This is what makes the dialog page testable.
    if (payload.action === 'execute' && /Extrude|Fillet|Hole|Revolve/.test(payload.id || '')) {
      state = { ...state, activeCommand: payload.id, dialogOpen: true };
      publish(state);
    } else if (payload.action === 'text' && /CommitCmd|CancelCmd/.test(payload.text || '')) {
      state = { ...state, activeCommand: 'SelectCommand', dialogOpen: false };
      publish(state);
    }
    json(response, 202, { accepted: true });
    return;
  }

  if (route === '/_sim/state' && request.method === 'POST') {
    const patch = await readBody(request);
    state = { ...state, ...patch, type: 'state' };
    publish(state);
    console.log('  state ->', JSON.stringify(patch));
    json(response, 200, state);
    return;
  }

  if (route === '/_sim/log') {
    json(response, 200, { commands: commandLog });
    return;
  }

  if (route === '/_sim/' || route === '/_sim' || route === '/') {
    serveFile(path.join(__dirname, 'simulator', 'index.html'), response);
    return;
  }

  if (route.startsWith('/plugin/')) {
    serveFile(path.join(PLUGIN_DIR, route.replace('/plugin/', 'plugin/')), response);
    return;
  }

  if (route === '/layouts/default.json') {
    serveFile(path.join(ROOT, 'src', 'layouts', 'default.json'), response);
    return;
  }

  json(response, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake Fusion bridge on http://127.0.0.1:${PORT}`);
  console.log(`simulator:            http://127.0.0.1:${PORT}/_sim/`);
});
