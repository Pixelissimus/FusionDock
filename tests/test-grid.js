/*
 * Grid mapping tests.
 *
 * The orientation maths is the easiest thing in this project to get subtly wrong, and the
 * failure mode on hardware is "keys are in the wrong places" rather than a crash -- so it
 * gets checked properly here.
 *
 * Run:  node --test tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const grid = require(path.join(
  __dirname, '..', 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin', 'plugin', 'grid.js'
));

const ORIENTATIONS = ['portrait', 'landscape'];

test('logical dimensions match the documented orientations', () => {
  assert.deepStrictEqual(grid.dimensions('portrait'), { columns: 3, rows: 5 });
  assert.deepStrictEqual(grid.dimensions('landscape'), { columns: 5, rows: 3 });
});

test('every logical cell maps to a distinct native cell, covering all 15 keys', () => {
  for (const orientation of ORIENTATIONS) {
    const size = grid.dimensions(orientation);
    const seen = new Set();
    for (let row = 0; row < size.rows; row += 1) {
      for (let column = 0; column < size.columns; column += 1) {
        const cell = grid.nativeCell(orientation, row, column);
        assert.ok(cell.row >= 0 && cell.row < grid.NATIVE_ROWS,
          `${orientation} (${row},${column}) native row out of range: ${cell.row}`);
        assert.ok(cell.column >= 0 && cell.column < grid.NATIVE_COLUMNS,
          `${orientation} (${row},${column}) native column out of range: ${cell.column}`);
        seen.add(grid.cellId(cell));
      }
    }
    assert.strictEqual(seen.size, grid.KEY_COUNT,
      `${orientation} should cover all ${grid.KEY_COUNT} keys exactly once`);
  }
});

test('portrait maps straight through to the native frame', () => {
  // Portrait IS the native orientation, so the mapping must be the identity. If this ever
  // fails, the native constants and the portrait branch have drifted apart.
  assert.deepStrictEqual(grid.nativeCell('portrait', 0, 0), { row: 0, column: 0 });
  assert.deepStrictEqual(grid.nativeCell('portrait', 4, 2), { row: 4, column: 2 });
});

test('landscape is portrait rotated clockwise', () => {
  // Landscape top-left is the key that sits at portrait bottom-left, because turning the
  // device clockwise brings the bottom-left corner round to the top-left.
  assert.deepStrictEqual(grid.nativeCell('landscape', 0, 0), { row: 4, column: 0 });
  // Landscape top-right is portrait top-left.
  assert.deepStrictEqual(grid.nativeCell('landscape', 0, 4), { row: 0, column: 0 });
  // Landscape bottom-right is portrait top-right.
  assert.deepStrictEqual(grid.nativeCell('landscape', 2, 4), { row: 0, column: 2 });
});

test('every one of the 15 keys is a context key', () => {
  // The three-key fixed region (Undo/Redo/View) is gone: it spent 20% of the grid on
  // globals while the N1's two side buttons and dial sat unused. Globals moved to 'aux'
  // in the layout. If a fixed region ever comes back, this is the test that should fail.
  for (const orientation of ORIENTATIONS) {
    const context = grid.contextCells(orientation).map(grid.cellId);
    assert.strictEqual(context.length, grid.KEY_COUNT,
      `${orientation} should give all ${grid.KEY_COUNT} keys to context commands`);
    assert.strictEqual(new Set(context).size, grid.KEY_COUNT,
      `${orientation} cells must be unique`);
  }
  assert.strictEqual(grid.fixedCells, undefined, 'fixed region should be gone');
});

test('context cells are unique within an orientation', () => {
  for (const orientation of ORIENTATIONS) {
    const ids = grid.contextCells(orientation).map(grid.cellId);
    assert.strictEqual(new Set(ids).size, ids.length,
      `${orientation} produced a duplicate context cell`);
  }
});

test('context cells run in reading order for the orientation', () => {
  // Slot N of a page must land in the Nth position a user would read, or authoring a
  // layout once for both orientations stops being meaningful.
  // Landscape is 5 wide: slot 0 is top-left, slot 4 ends the top row, slot 5 starts row 1.
  const landscape = grid.contextCells('landscape');
  assert.deepStrictEqual(landscape[0], grid.nativeCell('landscape', 0, 0));
  assert.deepStrictEqual(landscape[4], grid.nativeCell('landscape', 0, 4));
  assert.deepStrictEqual(landscape[5], grid.nativeCell('landscape', 1, 0));
  assert.deepStrictEqual(landscape[14], grid.nativeCell('landscape', 2, 4));

  // Portrait is 3 wide: slot 0 is top-left, slot 3 starts row 1, slot 14 is bottom-right.
  const portrait = grid.contextCells('portrait');
  assert.deepStrictEqual(portrait[0], grid.nativeCell('portrait', 0, 0));
  assert.deepStrictEqual(portrait[2], grid.nativeCell('portrait', 0, 2));
  assert.deepStrictEqual(portrait[3], grid.nativeCell('portrait', 1, 0));
  assert.deepStrictEqual(portrait[14], grid.nativeCell('portrait', 4, 2));
});

test('the auxiliary controls live in a sixth row, outside the key grid', () => {
  // Captured from a real N1 (2026-07-27):
  //   row 5 col 0/1 -> side buttons, controller "Keypad"
  //   row 5 col 2   -> the dial,     controller "Knob"
  // The side buttons are recognised by POSITION because they arrive as ordinary Keypad
  // cells. Matching on controller name instead ("Information"/"SecondaryScreen") gave them
  // cell ids no page contains, so they painted blank and did nothing when pressed.
  assert.strictEqual(grid.AUX_ROW, grid.NATIVE_ROWS, 'aux row sits just past the key rows');
  assert.ok(grid.isAuxCell({ column: 0, row: grid.AUX_ROW }));
  assert.ok(grid.isAuxCell({ column: 1, row: grid.AUX_ROW }));
  assert.ok(!grid.isAuxCell({ column: 2, row: grid.NATIVE_ROWS - 1 }), 'last key row is not aux');
  assert.ok(!grid.isAuxCell(null));

  // No aux cell may collide with a real key cell in either orientation.
  for (const orientation of ORIENTATIONS) {
    for (const cell of grid.contextCells(orientation)) {
      assert.ok(!grid.isAuxCell(cell),
        `${orientation} context cell ${grid.cellId(cell)} must not be in the aux row`);
    }
  }
});

test('key images are never pre-rotated, in either orientation', () => {
  // Verified on a real N1 (2026-07-27): VSD Craft has its own per-device icon rotation
  // setting. Pre-rotating here fought it and left every glyph 90 degrees out. Rotation is
  // the user's choice and the SDK gives no way to read their setting back, so the plugin
  // draws upright and lets the host turn it.
  assert.strictEqual(grid.imageRotation('portrait'), 0);
  assert.strictEqual(grid.imageRotation('landscape'), 0);
});

test('orientation is never inferred from the device size', () => {
  // Verified on a real N1 (2026-07-27): the device reports its native 3x5 frame however it
  // is physically held, so size can only ever mean "portrait". Inferring from it overwrote
  // the user's landscape setting and transposed the entire grid. The capability is gone on
  // purpose -- this test exists to stop it coming back.
  assert.strictEqual(grid.orientationFromDeviceSize, undefined,
    'device size cannot distinguish orientation on this hardware');
});
