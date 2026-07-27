/*
 * Maps logical layout slots onto physical N1 keys, for either orientation.
 *
 * The host addresses keys by coordinates -- willAppear carries {column, row} in the
 * DEVICE'S NATIVE FRAME, and the device reports its own size in the registration info.
 * Everything here converts between "logical cell the user sees" and "native cell the host
 * talks about".
 *
 * Native frame (from the Mirabox SDK's StreamDockN1 device class): the N1's background
 * screen is 480x854 -- taller than wide -- so native is taken to be PORTRAIT, 3 columns
 * by 5 rows.
 *
 *   !! UNVERIFIED ON HARDWARE !!
 *   If keys land transposed on a real device, swap NATIVE_COLUMNS/NATIVE_ROWS. Nothing
 *   else needs touching -- every mapping below derives from those two numbers.
 *
 * Orientation geometry, fixed by where the dial sits:
 *   portrait  -> dial TOP RIGHT,    3 wide x 5 tall
 *   landscape -> dial BOTTOM RIGHT, 5 wide x 3 tall
 * A top-right corner moves to bottom-right under a 90 degree CLOCKWISE turn, so landscape
 * is portrait rotated clockwise:
 *
 *   landscape (row, column) -> native (row = LAST_NATIVE_ROW - column, column = row)
 */
(function (root) {
  'use strict';

  var NATIVE_COLUMNS = 3;
  var NATIVE_ROWS = 5;
  var KEY_COUNT = NATIVE_COLUMNS * NATIVE_ROWS;
  var LAST_NATIVE_ROW = NATIVE_ROWS - 1;

  /*
   * The N1 addresses its auxiliary controls as a SIXTH row of the same coordinate space --
   * confirmed on hardware 2026-07-27 by reading willAppear:
   *
   *   row 5, column 0  ->  side button 1   controller "Keypad"
   *   row 5, column 1  ->  side button 2   controller "Keypad"
   *   row 5, column 2  ->  the dial        controller "Knob"
   *
   * Note the side buttons report as plain Keypad cells, NOT as "Information" or
   * "SecondaryScreen". They must therefore be recognised by POSITION, not by controller
   * name -- identifying them by name left them mapped to cell ids no page contains, so they
   * painted blank and did nothing. This also explains the 18-cell coordinate space seen in
   * VSD Craft's own N1 profiles.
   */
  var AUX_ROW = NATIVE_ROWS;

  function isAuxCell(cell) {
    return !!cell && cell.row === AUX_ROW;
  }

  /*
   * The plugin does NOT rotate key images. Verified on a real N1, 2026-07-27.
   *
   * The original assumption was that the host never rotates ("the N1 device class hardcodes
   * key_rotate_angle = 0") so the plugin had to pre-rotate. That is wrong: VSD Craft has its
   * own per-device icon rotation setting, which the owner already uses to run the N1 on its
   * side. Pre-rotating here fought that setting and left every glyph 90 degrees out.
   *
   * Rotation belongs to the host for a reason beyond this bug: it is the user's choice, it
   * applies to every plugin consistently, and the SDK gives no way to read it back -- so a
   * plugin that rotates on its own can only ever guess, and will be wrong for anyone whose
   * preference differs. Draw upright; let VSD Craft turn it.
   */
  var LANDSCAPE_IMAGE_ROTATION_DEG = 0;

  function cellId(cell) {
    return cell.column + ',' + cell.row;
  }

  /* Logical grid as the user sees it. */
  function dimensions(orientation) {
    return orientation === 'landscape'
      ? { columns: NATIVE_ROWS, rows: NATIVE_COLUMNS }
      : { columns: NATIVE_COLUMNS, rows: NATIVE_ROWS };
  }

  /* Logical cell -> native cell the host understands. */
  function nativeCell(orientation, row, column) {
    if (orientation === 'landscape') {
      return { row: LAST_NATIVE_ROW - column, column: row };
    }
    return { row: row, column: column };
  }

  /*
   * Native cells available for context commands, in reading order for the orientation.
   *
   * This is what lets a page be authored once as a flat ordered list: slot N lands on
   * contextCells(orientation)[N] whichever way the device is turned.
   *
   * ALL 15 keys are context keys. There used to be a three-key "fixed region" holding Undo,
   * Redo and View on every page, on the theory that keeping globals under the same finger
   * avoids disorientation. In practice it spent 20% of the grid on three commands while the
   * N1's two side buttons and dial sat unused -- so the globals moved there instead (see
   * "aux" in the layout) and the grid is now entirely context.
   */
  function contextCells(orientation) {
    var size = dimensions(orientation);
    var cells = [];
    var row;
    var column;
    for (row = 0; row < size.rows; row += 1) {
      for (column = 0; column < size.columns; column += 1) {
        cells.push(nativeCell(orientation, row, column));
      }
    }
    return cells;
  }

  function imageRotation(orientation) {
    return orientation === 'landscape' ? LANDSCAPE_IMAGE_ROTATION_DEG : 0;
  }

  var api = {
    NATIVE_COLUMNS: NATIVE_COLUMNS,
    NATIVE_ROWS: NATIVE_ROWS,
    KEY_COUNT: KEY_COUNT,
    AUX_ROW: AUX_ROW,
    isAuxCell: isAuxCell,
    cellId: cellId,
    dimensions: dimensions,
    nativeCell: nativeCell,
    contextCells: contextCells,
    imageRotation: imageRotation
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.FsdGrid = api;
  }
}(typeof self !== 'undefined' ? self : this));
