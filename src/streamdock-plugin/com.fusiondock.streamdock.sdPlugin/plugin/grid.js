/*
 * Maps logical layout slots onto physical Stream Dock keys.
 *
 * The original target, the VSD Stream Dock N1, reports its 15-key surface in a
 * native portrait frame: 3 columns x 5 rows. Landscape mode therefore needs a
 * coordinate rotation.
 *
 * Some compatible Stream Dock models, including the MiraBox Stream Dock 293SV3,
 * report the same 15-key landscape surface directly as 5 columns x 3 rows.
 *
 * The plugin keeps the N1 mapping as the default and switches to the native 5x3
 * profile only after seeing a Keypad coordinate that cannot exist on the N1
 * main keypad (column 3 or 4).
 */
(function (root) {
  'use strict';

  var DEVICE_PROFILE_N1 = 'n1-portrait-native';
  var DEVICE_PROFILE_5X3 = 'landscape-5x3-native';
  var deviceProfile = DEVICE_PROFILE_N1;

  var NATIVE_COLUMNS = 3;
  var NATIVE_ROWS = 5;
  var KEY_COUNT = 15;
  var LAST_NATIVE_ROW = NATIVE_ROWS - 1;

  function applyDeviceProfile(profile) {
    deviceProfile = profile;

    if (profile === DEVICE_PROFILE_5X3) {
      NATIVE_COLUMNS = 5;
      NATIVE_ROWS = 3;
    } else {
      NATIVE_COLUMNS = 3;
      NATIVE_ROWS = 5;
    }

    LAST_NATIVE_ROW = NATIVE_ROWS - 1;

    api.NATIVE_COLUMNS = NATIVE_COLUMNS;
    api.NATIVE_ROWS = NATIVE_ROWS;
    api.AUX_ROW = profile === DEVICE_PROFILE_N1 ? NATIVE_ROWS : null;
  }

  /*
   * Observe coordinates reported by willAppear.
   *
   * N1 main keypad:
   *   columns 0..2
   *   rows    0..4
   *
   * Native landscape 5x3 keypad:
   *   columns 0..4
   *   rows    0..2
   *
   * Seeing column 3 or 4 on a Keypad cell therefore proves that the device is
   * exposing a native 5x3 frame rather than the N1's native 3x5 frame.
   */
  function observeCell(cell, controller) {
    if (!cell || controller !== 'Keypad') {
      return false;
    }

    if (
      deviceProfile === DEVICE_PROFILE_N1
      && cell.column >= 3
      && cell.row < 3
    ) {
      applyDeviceProfile(DEVICE_PROFILE_5X3);
      return true;
    }

    return false;
  }

  function currentDeviceProfile() {
    return deviceProfile;
  }

  function resetDeviceProfile() {
    applyDeviceProfile(DEVICE_PROFILE_N1);
  }

  /*
   * The N1 addresses its auxiliary controls as a sixth row:
   *
   *   row 5, column 0 -> side button 1
   *   row 5, column 1 -> side button 2
   *   row 5, column 2 -> dial
   *
   * The 293SV3 does not expose its side area using this N1-style coordinate
   * scheme, so auxiliary-cell detection is enabled only for the N1 profile.
   */
  function isAuxCell(cell) {
    return deviceProfile === DEVICE_PROFILE_N1
      && !!cell
      && cell.row === NATIVE_ROWS;
  }

  /*
   * Key images are drawn upright. Any physical image rotation belongs to the
   * Stream Dock / VSD Craft host rather than the plugin.
   */
  var LANDSCAPE_IMAGE_ROTATION_DEG = 0;

  function cellId(cell) {
    return cell.column + ',' + cell.row;
  }

  /*
   * Logical layout dimensions as the user sees the device.
   */
  function dimensions(orientation) {
    return orientation === 'landscape'
      ? { columns: 5, rows: 3 }
      : { columns: 3, rows: 5 };
  }

  /*
   * Convert a logical layout cell to the native coordinate reported by the host.
   */
  function nativeCell(orientation, row, column) {
    /*
     * Devices such as the 293SV3 already report landscape as a native 5x3 grid,
     * so landscape requires no transformation.
     *
     * Keep portrait support by rotating the logical 3x5 layout into the native
     * 5x3 frame.
     */
    if (deviceProfile === DEVICE_PROFILE_5X3) {
      if (orientation === 'portrait') {
        return {
          row: column,
          column: (NATIVE_COLUMNS - 1) - row
        };
      }

      return {
        row: row,
        column: column
      };
    }

    /*
     * N1 native frame is portrait 3x5. Landscape is the native frame rotated
     * clockwise.
     */
    if (orientation === 'landscape') {
      return {
        row: LAST_NATIVE_ROW - column,
        column: row
      };
    }

    return {
      row: row,
      column: column
    };
  }

  /*
   * Native cells available for context commands, returned in logical reading
   * order for the selected orientation.
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
    return orientation === 'landscape'
      ? LANDSCAPE_IMAGE_ROTATION_DEG
      : 0;
  }

  var api = {
    NATIVE_COLUMNS: NATIVE_COLUMNS,
    NATIVE_ROWS: NATIVE_ROWS,
    KEY_COUNT: KEY_COUNT,
    AUX_ROW: NATIVE_ROWS,

    DEVICE_PROFILE_N1: DEVICE_PROFILE_N1,
    DEVICE_PROFILE_5X3: DEVICE_PROFILE_5X3,

    observeCell: observeCell,
    currentDeviceProfile: currentDeviceProfile,
    resetDeviceProfile: resetDeviceProfile,

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
