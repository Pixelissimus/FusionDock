/*
 * End-to-end test of the plugin against a real bridge over real HTTP.
 *
 * The plugin is browser code, so the browser APIs it needs are shimmed here: a fake host
 * WebSocket, a minimal EventSource, and a stub renderer (canvas has no meaning in Node and
 * the pixels are not what is under test). Everything else runs for real -- the SSE wire
 * format, the layout engine, the key/context bookkeeping, and the HTTP command calls.
 *
 * This is the layer the unit tests cannot reach: the glue in main.js.
 *
 * Run:  node --test "tests/*.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const http = require('http');
const { spawn } = require('child_process');

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const PLUGIN_DIR = path.join(
  __dirname, '..', 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin', 'plugin'
);

let bridgeProcess = null;

/* ------------------------------------------------------------------ shims */

const sentToHost = [];
let hostSocket = null;

class FakeHostSocket {
  constructor() {
    this.readyState = 1;      // the plugin checks this before sending
    hostSocket = this;
    setTimeout(() => { if (this.onopen) { this.onopen(); } }, 0);
  }
  send(raw) { sentToHost.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
}

/* Just enough EventSource to consume the bridge's stream. Proves the wire format the
 * real add-in emits is parseable by a standards-shaped client. */
class MiniEventSource {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.onerror = null;
    this._buffer = '';
    this._request = http.get(url, (response) => {
      if (response.statusCode !== 200) {
        if (this.onerror) { this.onerror(new Error('status ' + response.statusCode)); }
        return;
      }
      response.setEncoding('utf8');
      response.on('data', (piece) => this._consume(piece));
      response.on('error', () => { if (this.onerror) { this.onerror(); } });
    });
    this._request.on('error', () => { if (this.onerror) { this.onerror(); } });
    // An SSE stream never ends, so without this the open socket keeps Node's event loop
    // alive and the test file hangs after the last assertion instead of exiting.
    this._request.on('socket', (socket) => socket.unref());
  }
  _consume(piece) {
    this._buffer += piece;
    let index = this._buffer.indexOf('\n\n');
    while (index !== -1) {
      const frame = this._buffer.slice(0, index);
      this._buffer = this._buffer.slice(index + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ') && this.onmessage) {
          this.onmessage({ data: line.slice(6) });
        }
      }
      index = this._buffer.indexOf('\n\n');
    }
  }
  close() { this._request.destroy(); }
}

function installShims() {
  globalThis.self = globalThis;
  globalThis.WebSocket = FakeHostSocket;
  globalThis.EventSource = MiniEventSource;

  globalThis.FsdGrid = require(path.join(PLUGIN_DIR, 'grid.js'));
  globalThis.FsdLayout = require(path.join(PLUGIN_DIR, 'layout.js'));
  // Canvas output is not under test; record what would have been drawn instead.
  globalThis.FsdRender = {
    renderKey: (spec) => Promise.resolve('rendered:' + (spec.label || '')),
    blankKey: () => Promise.resolve('rendered:'),
    clearCache: () => {}
  };

  // The plugin fetches its layout with a relative URL, as it does inside the host.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    const absolute = /^https?:/.test(url)
      ? url
      : new URL(url.replace(/^\.\.\//, ''), BASE + '/').toString();
    return nativeFetch(absolute, options);
  };

  const source = fs.readFileSync(path.join(PLUGIN_DIR, 'main.js'), 'utf8');
  // runInThisContext leaves `module` undefined, so main.js attaches to the global object
  // exactly as it does in the browser.
  vm.runInThisContext(source, { filename: 'main.js' });
}

/* ------------------------------------------------------------------ helpers */

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Must await: an async predicate returns a Promise, which is always truthy, so an
    // unawaited check would succeed instantly and the wait would do nothing.
    if (await predicate()) { return true; }
    await wait(30);
  }
  return false;
}

function toPlugin(event) {
  hostSocket.onmessage({ data: JSON.stringify(event) });
}

const LANDSCAPE_ACTION = 'com.fusiondock.streamdock.key';
const PORTRAIT_ACTION = 'com.fusiondock.streamdock.key.portrait';

/* Place the Fusion Key action on every control. The action UUID is what tells the plugin
 * which orientation the user is working in -- there is no orientation setting. */
function registerEveryKey(action) {
  action = action || LANDSCAPE_ACTION;
  const cells = [];
  for (let row = 0; row < FsdGrid.NATIVE_ROWS; row += 1) {
    for (let column = 0; column < FsdGrid.NATIVE_COLUMNS; column += 1) {
      const id = FsdGrid.cellId({ row, column });
      cells.push(id);
      toPlugin({
        event: 'willAppear',
        action,
        context: 'key-' + id,
        payload: { controller: 'Keypad', coordinates: { column, row } }
      });
    }
  }
  // Exactly what a real N1 sends (captured from hardware 2026-07-27): the side buttons are
  // ordinary "Keypad" cells in the auxiliary row, NOT "Information"/"SecondaryScreen".
  toPlugin({
    event: 'willAppear',
    context: 'aux-0',
    action,
    payload: { controller: 'Keypad', coordinates: { column: 0, row: FsdGrid.AUX_ROW } }
  });
  toPlugin({
    event: 'willAppear',
    context: 'aux-1',
    action,
    payload: { controller: 'Keypad', coordinates: { column: 1, row: FsdGrid.AUX_ROW } }
  });
  toPlugin({
    event: 'willAppear',
    context: 'knob-0',
    action,
    payload: { controller: 'Knob', coordinates: { column: 2, row: FsdGrid.AUX_ROW } }
  });
  return cells;
}

async function setFusionState(patch) {
  await fetch(BASE + '/_sim/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

async function commandLog() {
  const response = await fetch(BASE + '/_sim/log');
  return (await response.json()).commands;
}

/* Physical context sitting at slot N of the current page, in the given orientation. */
function contextForSlot(orientation, slot) {
  const cell = FsdGrid.contextCells(orientation)[slot];
  return 'key-' + FsdGrid.cellId(cell);
}

/* ------------------------------------------------------------------ lifecycle */

test.before(async () => {
  bridgeProcess = spawn(
    process.execPath,
    [path.join(__dirname, 'fake-bridge.js'), String(PORT)],
    { stdio: 'ignore' }
  );
  const up = await waitFor(async () => {
    try {
      const response = await fetch(BASE + '/health');
      return response.ok;
    } catch (error) {
      return false;
    }
  }, 10000);
  assert.ok(up, 'fake bridge should start');

  installShims();

  connectElgatoStreamDeckSocket(
    0,
    'test-uuid',
    'registerPlugin',
    JSON.stringify({
      devices: [{ id: 'sim-n1', name: 'N1', size: { columns: 5, rows: 3 }, type: 7 }]
    })
  );

  // The plugin defaults to 8731. Point it at this test's own bridge, or it would happily
  // talk to any other bridge already listening on the default port.
  FsdPlugin.applySettings({ port: PORT });

  const ready = await waitFor(() => FsdPlugin.getNavigator() !== null);
  assert.ok(ready, 'plugin should have loaded its layout');
  registerEveryKey();
  await wait(400);
});

test.after(() => {
  if (bridgeProcess) { bridgeProcess.kill(); }
});

/* ------------------------------------------------------------------ tests */

test('registers with the host and requests its settings on connect', () => {
  const events = sentToHost.map((message) => message.event);
  assert.ok(events.includes('registerPlugin'), 'must send the register event');
  assert.ok(events.includes('getGlobalSettings'), 'must ask for stored settings');
});

test('orientation is taken from the device info the host supplies', () => {
  assert.strictEqual(FsdPlugin.getSettings().orientation, 'landscape');
});

test('receives Fusion state over SSE and resolves the matching page', async () => {
  const state = FsdPlugin.getState();
  assert.strictEqual(state.connected, true, 'should have received a state frame');
  assert.strictEqual(FsdPlugin.getNavigator().currentPageId(), 'solid',
    'Design + Solid tab should resolve to the solid page');
});

test('paints every one of the 15 keys plus the auxiliary buttons', async () => {
  const painted = new Set(
    sentToHost.filter((message) => message.event === 'setImage')
      .map((message) => message.context)
  );
  for (let row = 0; row < FsdGrid.NATIVE_ROWS; row += 1) {
    for (let column = 0; column < FsdGrid.NATIVE_COLUMNS; column += 1) {
      const context = 'key-' + FsdGrid.cellId({ row, column });
      assert.ok(painted.has(context), `key ${context} was never painted`);
    }
  }
  assert.ok(painted.has('aux-0'), 'Home button was never painted');
  assert.ok(painted.has('aux-1'), 'Back button was never painted');
});

test('pressing a key sends that command to Fusion', async () => {
  const before = (await commandLog()).length;
  // Slot 0 of the solid page is "Create Sketch".
  toPlugin({ event: 'keyDown', context: contextForSlot('landscape', 0), payload: {} });

  const arrived = await waitFor(async () => (await commandLog()).length > before);
  assert.ok(arrived, 'a command should have reached the bridge');

  const log = await commandLog();
  const last = log[log.length - 1];
  assert.strictEqual(last.action, 'execute');
  assert.strictEqual(last.id, 'SketchCreate');
});

test('entering the sketch environment switches the device to sketch tools', async () => {
  await setFusionState({ inSketch: true });
  const switched = await waitFor(
    () => FsdPlugin.getNavigator().currentPageId() === 'sketch'
  );
  assert.ok(switched, 'device should follow the user into sketch mode');
});

test('a folder key opens its variant page rather than running a command', async () => {
  // The scenario from the brief: press Rectangle, get the rectangle variants.
  const navigator = FsdPlugin.getNavigator();
  const slot = navigator.currentPage().keys.findIndex((key) => key.page === 'sketch.rectangle');
  assert.ok(slot >= 0, 'sketch page should offer a rectangle folder');

  const before = (await commandLog()).length;
  toPlugin({ event: 'keyDown', context: contextForSlot('landscape', slot), payload: {} });
  await wait(200);

  assert.strictEqual(navigator.currentPageId(), 'sketch.rectangle');
  assert.strictEqual((await commandLog()).length, before,
    'opening a folder must not send a command to Fusion');
});

test('a variant key inside the folder runs the right command', async () => {
  const before = (await commandLog()).length;
  toPlugin({ event: 'keyDown', context: contextForSlot('landscape', 1), payload: {} });

  await waitFor(async () => (await commandLog()).length > before);
  const log = await commandLog();
  // Read the expected id from the layout rather than hardcoding it. Command ids are install-
  // derived (scripts/resolve-commands.js rewrites them against the running Fusion), so a
  // literal here goes stale the next time they are resolved -- as it did on 2026-07-27.
  const layout = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'src', 'layouts', 'default.json'), 'utf8'));
  const expected = layout.pages['sketch.rectangle'].keys[1].cmd;
  assert.strictEqual(log[log.length - 1].id, expected,
    'slot 1 of the rectangle page is the 3-point variant');
});

test('the auxiliary buttons run Undo and Redo', async () => {
  // Undo/Redo are on the discrete side buttons, not the dial: an encoder is easy to nudge
  // while pressing, and a stray rotation that undoes work is far worse than one that only
  // moves the camera.
  const before = (await commandLog()).length;
  toPlugin({ event: 'keyDown', context: 'aux-0', payload: {} });
  await waitFor(async () => (await commandLog()).length > before);
  assert.strictEqual((await commandLog())[before].id, 'UndoCommand');

  toPlugin({ event: 'keyDown', context: 'aux-1', payload: {} });
  await waitFor(async () => (await commandLog()).length > before + 1);
  assert.strictEqual((await commandLog())[before + 1].id, 'RedoCommand');
});

test('pressing the dial returns Home when no dialog is open', async () => {
  const navigator = FsdPlugin.getNavigator();
  navigator.open('sketch.circle');
  toPlugin({ event: 'dialDown', context: 'knob-0', payload: {} });
  await wait(150);
  assert.strictEqual(navigator.currentPageId(), 'sketch');
});

test('rotating the dial steps through the view cycle and wraps', async () => {
  const before = (await commandLog()).length;
  toPlugin({ event: 'dialRotate', context: 'knob-0', payload: { ticks: 1 } });
  await waitFor(async () => (await commandLog()).length > before);
  const first = (await commandLog())[before];
  assert.strictEqual(first.action, 'view', 'dial rotation must not send a command id');

  // Rotating back past the start must wrap rather than dead-end.
  toPlugin({ event: 'dialRotate', context: 'knob-0', payload: { ticks: -1 } });
  await waitFor(async () => (await commandLog()).length > before + 1);
  toPlugin({ event: 'dialRotate', context: 'knob-0', payload: { ticks: -1 } });
  await waitFor(async () => (await commandLog()).length > before + 2);
  const wrapped = (await commandLog())[before + 2];
  assert.strictEqual(wrapped.action, 'view');
  assert.ok(wrapped.view, 'wrapped entry should still be a real view');
});

test('a Fusion dialog opening takes over the device, and closing restores the page', async () => {
  const navigator = FsdPlugin.getNavigator();
  navigator.open('sketch.circle');
  await wait(100);

  // A modal feature dialog OUTSIDE sketch mode takes over the keys.
  await setFusionState({ dialogOpen: true, inSketch: false, activeCommand: 'Extrude' });
  assert.ok(await waitFor(() => navigator.currentPageId() === 'dialog'),
    'an open dialog should take over the keys');

  await setFusionState({ dialogOpen: false, inSketch: true, activeCommand: 'SelectCommand' });
  assert.ok(await waitFor(() => navigator.currentPageId() === 'sketch.circle'),
    'closing the dialog must put you back where you were, not at the root');
});

test('a sketch drawing tool does not hijack the keys', async () => {
  // Confirmed on hardware: sketch tools hold dialogOpen for as long as they are active, so
  // treating that as "a dialog is up" replaced every sketch tool with OK/Cancel and made it
  // impossible to chain one tool into the next. The dial still confirms -- only the grid
  // takeover is suppressed.
  const navigator = FsdPlugin.getNavigator();
  await setFusionState({ dialogOpen: false, inSketch: true, activeCommand: 'SelectCommand' });
  await wait(250);
  // Whatever sketch page is showing, starting a drawing tool must not move off it.
  const before = navigator.currentPageId();
  assert.notStrictEqual(before, 'dialog', 'precondition: not already on the dialog page');

  await setFusionState({
    dialogOpen: true, inSketch: true, activeCommand: 'ShapeRectangleThreePoint'
  });
  await wait(250);
  assert.strictEqual(navigator.currentPageId(), before,
    'drawing a rectangle must leave the sketch tools on the device');

  await setFusionState({ dialogOpen: false, activeCommand: 'SelectCommand' });
});

test('the dial confirms an open dialog', async () => {
  await setFusionState({ dialogOpen: true, activeCommand: 'ExtrudeCommand' });
  await waitFor(() => FsdPlugin.getState().dialogOpen === true);

  const before = (await commandLog()).length;
  toPlugin({ event: 'dialDown', context: 'knob-0', payload: {} });

  await waitFor(async () => (await commandLog()).length > before);
  const log = await commandLog();
  assert.strictEqual(log[log.length - 1].text, 'NuCommands.CommitCmd');

  await setFusionState({ dialogOpen: false, activeCommand: 'SelectCommand' });
  await wait(150);
});

test('the dial pages through a page too large for the grid', async () => {
  await setFusionState({ inSketch: false, tab: 'SolidTab' });
  await waitFor(() => FsdPlugin.getNavigator().currentPageId() === 'solid');

  const navigator = FsdPlugin.getNavigator();
  // Slot count comes from the grid, not a literal: all 15 keys are context keys, and hard
  // coding 12 here made a 13-key folder look like it overflowed when it does not.
  const slots = FsdGrid.contextCells(FsdPlugin.getSettings().orientation).length;
  navigator.open('solid.create');   // 9 commands + Back, one page
  assert.strictEqual(navigator.pageCount(slots), 1);
  toPlugin({ event: 'dialRotate', context: 'knob-0', payload: { ticks: 1 } });
  await wait(120);
  assert.strictEqual(navigator.offset, 0, 'a single-page list must not scroll');

  navigator.back();
  navigator.open('sketch.constrain');   // 12 constraints + Back, still one page
  assert.strictEqual(navigator.pageCount(slots), 1);

  // Leave the navigator at the context root. Without this the per-context memory quite
  // correctly restores this sub-page in later tests, which then look like failures.
  navigator.home();
});

test('losing Fusion moves the device to the disconnected page', async () => {
  await setFusionState({ connected: false });
  const moved = await waitFor(
    () => FsdPlugin.getNavigator().currentPageId() === 'disconnected'
  );
  assert.ok(moved, 'device should show a disconnected page when Fusion goes away');
});

test('Fusion coming back restores a working page', async () => {
  await setFusionState({ connected: true, inSketch: false, tab: 'SolidTab', dialogOpen: false });
  // Assert on the ROOT page, not the visible one: if the user had been inside a sub-page
  // before Fusion went away, restoring them to it is the intended behaviour.
  const restored = await waitFor(
    () => FsdPlugin.getNavigator().rootPage === 'solid'
  );
  assert.ok(restored, 'device should recover when Fusion returns');
});

test('placing the portrait action remaps which physical key holds which slot', async () => {
  // Orientation follows the action the user placed, so switching means re-placing the keys --
  // exactly what a user does. There is no setting to poke.
  FsdPlugin.getNavigator().home();
  registerEveryKey(PORTRAIT_ACTION);
  await wait(200);

  const before = (await commandLog()).length;
  // Slot 0 in PORTRAIT is a different physical key from slot 0 in landscape.
  const portraitSlot0 = contextForSlot('portrait', 0);
  const landscapeSlot0 = contextForSlot('landscape', 0);
  assert.notStrictEqual(portraitSlot0, landscapeSlot0,
    'the two orientations must not put slot 0 on the same key');

  toPlugin({ event: 'keyDown', context: portraitSlot0, payload: {} });
  await waitFor(async () => (await commandLog()).length > before);
  const log = await commandLog();
  assert.strictEqual(log[log.length - 1].id, 'SketchCreate',
    'slot 0 must still be the first command of the page after rotating');

  registerEveryKey(LANDSCAPE_ACTION);
  await wait(150);
});

test('a stored orientation setting cannot override the placed action', async () => {
  // An older install saved orientation into global settings. Honouring that would silently
  // transpose the grid -- the exact bug this design removes.
  registerEveryKey(LANDSCAPE_ACTION);
  await wait(150);
  FsdPlugin.applySettings({ orientation: 'portrait' });
  await wait(150);

  const before = (await commandLog()).length;
  toPlugin({ event: 'keyDown', context: contextForSlot('landscape', 0), payload: {} });
  await waitFor(async () => (await commandLog()).length > before);
  assert.strictEqual((await commandLog())[before].id, 'SketchCreate',
    'landscape mapping must survive a stale portrait setting');
});

test('a key press on an unregistered context is ignored rather than throwing', () => {
  assert.doesNotThrow(() => {
    toPlugin({ event: 'keyDown', context: 'key-99,99', payload: {} });
  });
});

test('willDisappear releases the key so a later willAppear can reclaim it', async () => {
  const cellId = FsdGrid.cellId(FsdGrid.contextCells('landscape')[0]);
  toPlugin({ event: 'willDisappear', context: 'key-' + cellId, payload: {} });

  const before = (await commandLog()).length;
  toPlugin({ event: 'keyDown', context: 'key-' + cellId, payload: {} });
  await wait(200);
  assert.strictEqual((await commandLog()).length, before,
    'a released key must not still fire commands');

  toPlugin({
    event: 'willAppear',
    context: 'key-' + cellId,
    payload: {
      controller: 'Keypad',
      coordinates: {
        column: Number(cellId.split(',')[0]),
        row: Number(cellId.split(',')[1])
      }
    }
  });
  await wait(200);
  toPlugin({ event: 'keyDown', context: 'key-' + cellId, payload: {} });
  assert.ok(await waitFor(async () => (await commandLog()).length > before),
    'the key should work again once it reappears');
});

test('a view key sends a view action, not an execute', async () => {
  // Fusion has no command definition for view orientation or visual style, so these keys
  // must not go down the execute() path -- they would silently fail as "unknown command".
  const navigator = FsdPlugin.getNavigator();
  // These tests run in order and share one navigator, so put the page back afterwards.
  const resumePage = navigator.currentPageId();
  navigator.open('view');
  const slot = navigator.currentPage().keys.findIndex((key) => key.view === 'front');
  assert.ok(slot >= 0, 'view page should offer a Front key');

  const before = (await commandLog()).length;
  toPlugin({ event: 'keyDown', context: contextForSlot('landscape', slot), payload: {} });
  await waitFor(async () => (await commandLog()).length > before);

  const last = (await commandLog())[before];
  assert.strictEqual(last.action, 'view', 'must use the view action');
  assert.strictEqual(last.view, 'front');
  assert.strictEqual(last.id, undefined, 'must not send a command id');
  navigator.open(resumePage);
});

/*
 * The tab action had no coverage at all until 2026-07-28: the fake bridge only understood
 * 'execute' and 'text', so renaming any field the plugin sends would have left every test
 * green and shown up only on hardware in front of Fusion — the slowest place this project
 * has to debug anything.
 */
test('a tab key sends a tab action carrying all three identifying fields', async () => {
  await setFusionState({ inSketch: false, workspace: 'FusionSolidEnvironment', tab: 'SolidTab' });
  await waitFor(() => FsdPlugin.getNavigator().currentPageId() === 'solid');

  const navigator = FsdPlugin.getNavigator();
  navigator.open('home');
  const slot = navigator.currentPage().keys.findIndex((key) => key.label === 'Sheet Metal');
  assert.ok(slot >= 0, 'the tab picker should offer Sheet Metal');

  const before = (await commandLog()).length;
  toPlugin({ event: 'keyDown', context: contextForSlot('landscape', slot), payload: {} });
  await waitFor(async () => (await commandLog()).length > before);

  const sent = (await commandLog())[before];
  assert.strictEqual(sent.action, 'tab', 'must use the tab action, not execute');
  assert.strictEqual(sent.tab, 'SheetMetalTab');
  assert.strictEqual(sent.workspace, 'FusionSolidEnvironment');
  assert.strictEqual(sent.tabName, 'SHEET METAL', 'the name fallback must travel too');
  assert.strictEqual(sent.id, undefined, 'must not send a command id');

  await waitFor(() => FsdPlugin.getNavigator().currentPageId() === 'sheetmetal');
});

/*
 * Reported on hardware: press Tabs in Solid, pick Solid, and the device stayed on the picker
 * because the resolved root never changed and applyState short-circuits on that. Picking a
 * destination must close the picker regardless.
 */
test('picking the tab Fusion is already on still closes the tab picker', async () => {
  await setFusionState({ inSketch: false, workspace: 'FusionSolidEnvironment', tab: 'SolidTab' });
  await waitFor(() => FsdPlugin.getNavigator().currentPageId() === 'solid');

  const navigator = FsdPlugin.getNavigator();
  navigator.open('home');
  assert.strictEqual(navigator.currentPageId(), 'home');

  const slot = navigator.currentPage().keys.findIndex((key) => key.label === 'Solid');
  assert.ok(slot >= 0);
  toPlugin({ event: 'keyDown', context: contextForSlot('landscape', slot), payload: {} });

  await waitFor(() => FsdPlugin.getNavigator().currentPageId() === 'solid');
  assert.strictEqual(navigator.currentPageId(), 'solid',
    'the picker must close even though the resolved page did not change');
});

test('a tab Fusion refuses flashes the key that asked for it', async () => {
  await setFusionState({ inSketch: false, workspace: 'FusionSolidEnvironment', tab: 'SolidTab' });
  await waitFor(() => FsdPlugin.getNavigator().currentPageId() === 'solid');

  // Drive the failure path directly: a commandResult for a tab carries no command id, which
  // is exactly why matchesResult had to learn about actions other than 'execute'.
  const navigator = FsdPlugin.getNavigator();
  navigator.open('home');
  const before = sentToHost.filter((m) => m.event === 'showAlert').length;

  await fetch(BASE + '/_sim/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'commandResult',
      ok: false,
      action: 'tab',
      tab: 'SheetMetalTab',
      tabName: 'SHEET METAL',
      message: 'unknown tab: SheetMetalTab'
    })
  });

  const flashed = await waitFor(
    () => sentToHost.filter((m) => m.event === 'showAlert').length > before
  );
  assert.ok(flashed,
    'the Sheet Metal key should flash, matched on its tab id rather than a command id');
  navigator.home();
});
