/*
 * Fusion 360 Stream Dock -- plugin entry point.
 *
 * Two connections:
 *   host    <-> WebSocket, the Stream Dock software's Elgato-derived protocol
 *   add-in  <-> HTTP + Server-Sent Events on 127.0.0.1, the Fusion bridge
 *
 * The plugin owns every key and repaints them itself. It does NOT ask the host to switch
 * profiles or pages: switchToProfile is undocumented in this SDK, absent from most of its
 * bindings, and used by no shipped plugin. Repainting needs no host cooperation.
 */
(function (root) {
  'use strict';

  var DEFAULT_PORT = 8731;
  var RECONNECT_DELAY_MS = 2000;

  var socket = null;
  var pluginUUID = null;
  var deviceId = null;

  var navigator_ = null;
  var layout = null;
  var settings = { port: DEFAULT_PORT, orientation: 'landscape' };

  // context -> {controller, cellKey}; and the reverse lookup used when painting.
  var contexts = {};
  var cellToContext = {};
  var knobContexts = [];
  var auxContexts = [];

  var events = null;
  var reconnectTimer = null;
  var lastState = { connected: false };
  var painting = false;
  var repaintQueued = false;
  var dialCycleIndex = 0;

  function log(message) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({
        event: 'logMessage',
        payload: { message: '[FusionStreamDock] ' + message }
      }));
    }
  }

  function bridgeUrl(path) {
    return 'http://127.0.0.1:' + settings.port + path;
  }

  /*
   * Mirror raw host events to the bridge so they can be read back over HTTP.
   *
   * The host does not surface logMessage anywhere readable and the add-in's app.log does not
   * reach disk, so during hardware bring-up this is the only way to see what the device
   * actually sends: key coordinates, controller names, and the dial payload shape. Fire and
   * forget -- a failed debug post must never affect key handling.
   */
  function debugToBridge(entry) {
    try {
      fetch(bridgeUrl('/debug'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      }).catch(function () {});
    } catch (error) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- add-in link */

  function connectBridge() {
    if (events) {
      events.close();
      events = null;
    }
    try {
      events = new EventSource(bridgeUrl('/events'));
    } catch (error) {
      scheduleReconnect();
      return;
    }

    events.onmessage = function (message) {
      var payload;
      try {
        payload = JSON.parse(message.data);
      } catch (error) {
        return;
      }
      handleBridgeMessage(payload);
    };

    events.onerror = function () {
      // Fusion is closed, the add-in is not loaded, or it is restarting. EventSource
      // retries on its own, but we still need the device to show a disconnected page.
      if (lastState.connected !== false) {
        lastState = { connected: false };
        applyState(lastState);
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connectBridge();
    }, RECONNECT_DELAY_MS);
  }

  function handleBridgeMessage(payload) {
    if (payload.type === 'state') {
      lastState = payload;
      applyState(payload);
    } else if (payload.type === 'commandResult' && !payload.ok) {
      // The command refused to start -- usually the wrong selection or environment.
      // Flash the key that was pressed rather than silently doing nothing.
      showAlertFor(payload.id);
      log('command failed: ' + payload.id + ' -- ' + payload.message);
    } else if (payload.type === 'shutdown') {
      lastState = { connected: false };
      applyState(lastState);
    }
  }

  function sendCommand(body) {
    return fetch(bridgeUrl('/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function () {
      // Bridge is gone; the SSE error handler will move the device to the
      // disconnected page shortly.
    });
  }

  /* ---------------------------------------------------------------- painting */

  function applyState(state) {
    if (!navigator_) {
      return;
    }
    var changed = navigator_.applyState(state);
    if (changed) {
      repaint();
    }
  }

  function specFor(entry, rotation) {
    if (!entry) {
      return { label: '', iconUrl: '', rotation: rotation };
    }
    // 'peek' lets a folder key show the icon of its most common child, so the Rectangle
    // key looks like a rectangle rather than a generic folder.
    var iconSource = entry.cmd || entry.peek || null;
    return {
      label: entry.label || '',
      iconUrl: iconSource ? bridgeUrl('/icon?id=' + encodeURIComponent(iconSource)) : '',
      accent: entry.accent,
      disabled: Boolean(entry.disabled),
      badge: Boolean(entry.page),
      rotation: rotation
    };
  }

  function setImage(context, dataUrl) {
    if (!socket || socket.readyState !== 1) {
      return;
    }
    socket.send(JSON.stringify({
      event: 'setImage',
      context: context,
      payload: { image: dataUrl, target: 0 }
    }));
  }

  function repaint() {
    if (!navigator_ || !layout) {
      // The host sends willAppear for every key as soon as the plugin registers, which
      // can beat the layout fetch. Those keys get painted by the repaint that follows
      // loadLayout(), so dropping this one loses nothing.
      return;
    }
    if (painting) {
      // A state burst (workspace change fires several events) would otherwise start
      // overlapping paints and race on the canvas cache.
      repaintQueued = true;
      return;
    }
    painting = true;

    var orientation = settings.orientation;
    var rotation = FsdGrid.imageRotation(orientation);
    var slots = FsdGrid.contextCells(orientation);
    var visible = navigator_.visibleKeys(slots.length);
    var jobs = [];

    slots.forEach(function (cell, index) {
      var context = cellToContext[FsdGrid.cellId(cell)];
      if (!context) {
        return;
      }
      jobs.push(FsdRender.renderKey(specFor(visible[index], rotation))
        .then(function (dataUrl) { setImage(context, dataUrl); }));
    });

    paintAuxiliary(jobs);

    Promise.all(jobs).then(function () {
      painting = false;
      if (repaintQueued) {
        repaintQueued = false;
        repaint();
      }
    }, function () {
      painting = false;
    });
  }

  /*
   * The two secondary-screen buttons carry whatever the layout's "aux.buttons" says. They
   * exist so globals do not have to eat main-grid keys -- all 15 keys stay context.
   */
  function auxButtons() {
    return (layout && layout.aux && layout.aux.buttons) || [];
  }

  /*
   * The dial has its own small screen. Left unpainted it shows the plugin's generic logo,
   * which says nothing. Showing what a turn will do next -- or "OK" when the dial would
   * confirm a dialog -- makes the control self-describing.
   */
  function paintKnob(jobs) {
    if (!knobContexts.length) {
      return;
    }
    var label;
    if (lastState.dialogOpen) {
      label = ((dialConfig().press || {}).whenDialogOpen || {}).label || 'OK';
    } else {
      var cycle = (dialConfig().rotate || {}).cycle || [];
      label = cycle.length ? (cycle[dialCycleIndex] || {}).label : '';
    }
    knobContexts.forEach(function (context) {
      jobs.push(FsdRender.renderKey({ label: label })
        .then(function (dataUrl) { setImage(context, dataUrl); }));
    });
  }

  function paintAuxiliary(jobs) {
    paintKnob(jobs);
    auxButtons().forEach(function (entry, index) {
      var context = auxContexts[index];
      if (!context || !entry) {
        return;
      }
      // A Back button that cannot go anywhere is dimmed rather than hidden, so the button
      // does not appear to have moved.
      var disabled = entry.nav === 'back' && !navigator_.canGoBack();
      jobs.push(FsdRender.renderKey(specFor({
        label: entry.label,
        icon: entry.icon,
        cmd: entry.cmd,
        peek: entry.peek,
        disabled: disabled
      }, 0)).then(function (dataUrl) { setImage(context, dataUrl); }));
    });
  }

  function showAlertFor(commandId) {
    if (!navigator_) {
      return;
    }
    var orientation = settings.orientation;
    var slots = FsdGrid.contextCells(orientation);
    var visible = navigator_.visibleKeys(slots.length);
    visible.forEach(function (entry, index) {
      if (!entry || entry.cmd !== commandId) {
        return;
      }
      var context = cellToContext[FsdGrid.cellId(slots[index])];
      if (context && socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ event: 'showAlert', context: context }));
      }
    });
  }

  /* ---------------------------------------------------------------- input */

  function entryForContext(context) {
    var record = contexts[context];
    if (!record || !record.cellKey || !navigator_ || !layout) {
      return null;
    }
    var orientation = settings.orientation;
    var slots = FsdGrid.contextCells(orientation);
    var index = slots.map(FsdGrid.cellId).indexOf(record.cellKey);
    if (index !== -1) {
      return navigator_.visibleKeys(slots.length)[index];
    }
    return null;
  }

  function activate(entry) {
    if (!entry || entry.disabled) {
      return;
    }
    if (entry.nav === 'back') {
      if (navigator_.back()) { repaint(); }
      return;
    }
    if (entry.nav === 'home') {
      if (navigator_.home()) { repaint(); }
      return;
    }
    if (entry.page) {
      if (navigator_.open(entry.page)) {
        repaint();
      }
      return;
    }
    if (entry.text) {
      sendCommand({ action: 'text', text: entry.text });
      return;
    }
    // Viewport orientation and visual style have no command definition in Fusion, so they
    // cannot go down the execute() path -- the add-in sets them on the viewport directly.
    if (entry.view) {
      sendCommand({ action: 'view', view: entry.view });
      return;
    }
    if (entry.cmd) {
      sendCommand({ action: 'execute', id: entry.cmd });
    }
  }

  function handleKeyDown(context) {
    if (!navigator_) {
      return;
    }
    var auxIndex = auxContexts.indexOf(context);
    if (auxIndex !== -1) {
      activate(auxButtons()[auxIndex]);
      return;
    }
    activate(entryForContext(context));
  }

  function dialConfig() {
    return (layout && layout.aux && layout.aux.dial) || {};
  }

  /*
   * Rotating the dial steps through the layout's view cycle.
   *
   * Deliberately NOT undo/redo: an encoder is easy to nudge while pressing it, and a stray
   * rotation that silently undoes work is far worse than one that merely moves the camera.
   * Undo and Redo are on the discrete side buttons instead.
   *
   * If the current page holds more keys than the grid can show, paging wins: being unable to
   * reach a key at all is worse than losing the view cycle on that one page.
   */
  function handleDialRotate(payload) {
    if (!navigator_) {
      return;
    }
    var ticks = payload && payload.ticks ? payload.ticks : 0;
    if (!ticks) {
      return;
    }
    var slots = FsdGrid.contextCells(settings.orientation).length;
    if (navigator_.currentPage().keys.length > slots) {
      if (navigator_.scroll(ticks > 0 ? 1 : -1, slots)) {
        repaint();
      }
      return;
    }
    var cycle = (dialConfig().rotate || {}).cycle || [];
    if (!cycle.length) {
      return;
    }
    // Wrap in both directions so the cycle never dead-ends at either extreme.
    dialCycleIndex = (dialCycleIndex + (ticks > 0 ? 1 : -1) + cycle.length) % cycle.length;
    activate(cycle[dialCycleIndex]);
    repaint();
  }

  function handleDialPress() {
    if (!navigator_) {
      return;
    }
    var press = dialConfig().press || {};
    // While a Fusion dialog is open the dial confirms it -- the most useful thing a
    // physical control can do at that moment.
    activate(lastState.dialogOpen ? press.whenDialogOpen : press.otherwise);
  }

  /* ---------------------------------------------------------------- host protocol */

  /*
   * Orientation is decided by WHICH ACTION the user placed, not by a setting.
   *
   * The device cannot report how it is being held -- it always says 3x5 -- and a Property
   * Inspector dropdown could silently disagree with reality, which is exactly the bug that
   * transposed the whole grid during bring-up. Placing "Fusion Key (Portrait)" instead of
   * "Fusion Key (Landscape)" is something the user does anyway when setting the device up, so
   * the answer comes from an action they cannot forget to take.
   */
  var PORTRAIT_ACTION = 'com.fusiondock.streamdock.key.portrait';

  function orientationForAction(action) {
    return action === PORTRAIT_ACTION ? 'portrait' : 'landscape';
  }

  /* Majority of placed keys wins, so a stray key of the wrong kind cannot flip the layout. */
  function recomputeOrientation() {
    var votes = { portrait: 0, landscape: 0 };
    var id;
    for (id in contexts) {
      if (Object.prototype.hasOwnProperty.call(contexts, id) && contexts[id].orientation) {
        votes[contexts[id].orientation] += 1;
      }
    }
    if (!votes.portrait && !votes.landscape) {
      return false;
    }
    var winner = votes.portrait > votes.landscape ? 'portrait' : 'landscape';
    if (winner === settings.orientation) {
      return false;
    }
    settings.orientation = winner;
    log('orientation now ' + winner + ' (portrait=' + votes.portrait
      + ' landscape=' + votes.landscape + ')');
    return true;
  }

  function registerContext(context, payload, action) {
    var controller = (payload && payload.controller) || 'Keypad';
    var record = {
      controller: controller,
      cellKey: null,
      orientation: orientationForAction(action)
    };

    var cell = payload && payload.coordinates
      ? { column: payload.coordinates.column, row: payload.coordinates.row }
      : null;

    log('willAppear controller=' + controller
      + ' coords=' + (cell ? cell.column + ',' + cell.row : 'none'));

    if (controller === 'Knob') {
      if (knobContexts.indexOf(context) === -1) {
        knobContexts.push(context);
      }
    } else if (FsdGrid.isAuxCell(cell)) {
      // Side buttons are recognised by position, not controller name: the N1 reports them as
      // ordinary "Keypad" cells in the auxiliary row. Indexed by column so button order is
      // stable no matter which order the host registers them in.
      auxContexts[cell.column] = context;
      record.auxIndex = cell.column;
    } else if (cell) {
      record.cellKey = FsdGrid.cellId(cell);
      cellToContext[record.cellKey] = context;
    }

    contexts[context] = record;
    recomputeOrientation();
  }

  function unregisterContext(context) {
    var record = contexts[context];
    if (record && record.cellKey && cellToContext[record.cellKey] === context) {
      delete cellToContext[record.cellKey];
    }
    // auxContexts is indexed by column, so clear the slot rather than compacting the array --
    // splicing it would shift the other side button onto the wrong binding.
    if (record && typeof record.auxIndex === 'number' && auxContexts[record.auxIndex] === context) {
      auxContexts[record.auxIndex] = null;
    }
    delete contexts[context];
    knobContexts = knobContexts.filter(function (id) { return id !== context; });
    recomputeOrientation();
  }

  function applySettings(incoming) {
    if (!incoming) {
      return;
    }
    var changed = false;
    if (incoming.port && Number(incoming.port) !== settings.port) {
      settings.port = Number(incoming.port);
      FsdRender.clearCache();
      connectBridge();
      changed = true;
    }
    // incoming.orientation is deliberately ignored. Orientation comes from which action the
    // user placed; honouring a stored value here would let a stale setting from an older
    // install silently transpose the grid, which is the exact failure this design removes.
    if (changed) {
      repaint();
    }
  }

  function handleHostMessage(raw) {
    var message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      return;
    }
    var event = message.event;

    // Bring-up diagnostics. Only the events whose shape is unverified on this device, so a
    // key press does not generate a debug post on every tap.
    if (event === 'willAppear' || event === 'dialRotate' || event === 'dialDown'
        || event === 'dialUp' || event === 'touchTap' || event === 'deviceDidConnect') {
      debugToBridge({ event: event, context: message.context, payload: message.payload,
        device: message.device });
    }

    if (event === 'willAppear') {
      registerContext(message.context, message.payload, message.action);
      repaint();
    } else if (event === 'willDisappear') {
      unregisterContext(message.context);
    } else if (event === 'keyDown') {
      handleKeyDown(message.context);
    } else if (event === 'dialRotate') {
      handleDialRotate(message.payload);
    } else if (event === 'dialDown') {
      handleDialPress();
    } else if (event === 'didReceiveGlobalSettings') {
      applySettings(message.payload && message.payload.settings);
    } else if (event === 'deviceDidConnect') {
      deviceId = message.device;
      // Orientation is NOT inferred from the reported device size. The N1 always reports its
      // native 3x5 frame regardless of how it is physically held, so inference always said
      // "portrait" and silently overwrote the user's setting -- which laid the whole grid out
      // transposed for anyone using it in landscape. Orientation is a user setting only.
      repaint();
    } else if (event === 'applicationDidLaunch') {
      // Fusion just started; its add-in needs a moment before the bridge accepts.
      setTimeout(connectBridge, 3000);
    } else if (event === 'applicationDidTerminate') {
      lastState = { connected: false };
      applyState(lastState);
    }
  }

  function loadLayout(attempt) {
    attempt = attempt || 0;
    return fetch('../layouts/default.json')
      .then(function (response) {
        if (!response.ok) {
          throw new Error('layout fetch returned ' + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        layout = data;
        navigator_ = new FsdLayout.Navigator(layout);
        navigator_.applyState(lastState);
      })
      .catch(function (error) {
        // Without a layout the plugin can paint nothing at all, so a single failed read
        // must not leave it permanently dead. Back off and keep trying.
        log('layout load failed (attempt ' + (attempt + 1) + '): ' + error);
        var delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(loadLayout(attempt + 1).then(repaint));
          }, delay);
        });
      });
  }

  /* Called by the Stream Dock host. Name is inherited from the Elgato SDK this one forks. */
  root.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info) {
    pluginUUID = uuid;

    var parsedInfo = {};
    try {
      parsedInfo = typeof info === 'string' ? JSON.parse(info) : (info || {});
    } catch (error) {
      parsedInfo = {};
    }
    if (parsedInfo.devices && parsedInfo.devices.length) {
      // Device size deliberately ignored -- see the note in the deviceDidConnect handler.
      deviceId = parsedInfo.devices[0].id;
    }

    socket = new WebSocket('ws://127.0.0.1:' + port);

    socket.onopen = function () {
      socket.send(JSON.stringify({ event: registerEvent, uuid: uuid }));
      socket.send(JSON.stringify({ event: 'getGlobalSettings', context: uuid }));
      loadLayout().then(function () {
        connectBridge();
        repaint();
      });
    };

    socket.onmessage = function (message) {
      handleHostMessage(message.data);
    };

    socket.onclose = function () {
      if (events) {
        events.close();
        events = null;
      }
    };
  };

  // Exposed for the simulator and tests, which drive these directly rather than through
  // a real host socket.
  root.FsdPlugin = {
    handleHostMessage: handleHostMessage,
    applySettings: applySettings,
    getSettings: function () { return settings; },
    getState: function () { return lastState; },
    getNavigator: function () { return navigator_; }
  };
}(typeof self !== 'undefined' ? self : this));
