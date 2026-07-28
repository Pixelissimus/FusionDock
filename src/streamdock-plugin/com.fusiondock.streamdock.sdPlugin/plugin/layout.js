/*
 * Layout resolution and navigation.
 *
 * Two ideas do most of the work here:
 *
 *  1. Rules map Fusion's state to a ROOT page. First matching rule wins, so rules are
 *     ordered most specific first (dialog open > in sketch > tab > workspace > fallback).
 *
 *  2. Every root context remembers where you were. The loudest complaint across macropad
 *     communities is that a context switch dumps you back on page 1 and you have to
 *     navigate home again. Leaving a context saves its stack and scroll; returning restores
 *     them. Opening a dialog and closing it puts you back exactly where you were.
 */
(function (root) {
  'use strict';

  function matchesRule(when, state) {
    var field;
    if (!when) {
      return true;
    }
    for (field in when) {
      if (Object.prototype.hasOwnProperty.call(when, field)) {
        if (state[field] !== when[field]) {
          return false;
        }
      }
    }
    return true;
  }

  /*
   * A rule may also carry "whenNot", which vetoes a match. It exists because some Fusion
   * commands report dialogOpen while they are really just waiting for a selection --
   * creating a sketch is the obvious one: it flashes OK/Cancel onto the device for the whole
   * time you are choosing a plane, which is noise, not information.
   */
  function resolveRootPage(layout, state) {
    var rules = layout.rules || [];
    var i;
    for (i = 0; i < rules.length; i += 1) {
      if (matchesRule(rules[i].when, state || {})
          && !(rules[i].whenNot && matchesRule(rules[i].whenNot, state || {}))) {
        return rules[i].page;
      }
    }
    return 'home';
  }

  function Navigator(layout) {
    this.layout = layout;
    this.rootPage = null;
    this.stack = [];
    this.offset = 0;
    this.memory = {};
  }

  /*
   * Pages marked "global" in the layout are doors, not sub-pages: Tabs and View appear on every
   * context and belong to none of them.
   *
   * They must never enter the per-context memory. Reported on hardware 2026-07-28: press Tabs
   * while in Solid, switch to Surface and back, and the device returns to the tabs page instead
   * of to Solid -- the memory had faithfully recorded "you were on the tabs page" and restored
   * it. Remembering which FOLDER you were in is the feature; remembering that you had a door
   * open is not.
   */
  Navigator.prototype._isGlobal = function (pageId) {
    var page = this.layout.pages[pageId];
    return Boolean(page && page.global);
  };

  Navigator.prototype._save = function () {
    if (!this.rootPage) {
      return;
    }
    var kept = this.stack.filter(function (id) {
      return !this._isGlobal(id);
    }, this);
    this.memory[this.rootPage] = {
      stack: kept,
      // A remembered scroll offset only means anything for the page it was taken on.
      offset: kept.length === this.stack.length ? this.offset : 0
    };
  };

  /* Returns true if the visible page changed and a repaint is needed. */
  Navigator.prototype.applyState = function (state) {
    var nextRoot = resolveRootPage(this.layout, state || {});
    if (nextRoot === this.rootPage) {
      return false;
    }
    this._save();
    this.rootPage = nextRoot;
    var remembered = this.memory[nextRoot];
    if (remembered) {
      // Sub-pages can be removed by a layout edit between visits; drop any that no longer
      // exist rather than rendering an empty page.
      this.stack = remembered.stack.filter(function (id) {
        return Boolean(this.layout.pages[id]);
      }, this);
      this.offset = remembered.offset;
    } else {
      this.stack = [];
      this.offset = 0;
    }
    return true;
  };

  /*
   * Close any door left open on top of the stack.
   *
   * Excluding globals from the memory was only half the fix. Nothing popped the door off the
   * LIVE stack, and applyState returns early when the resolved root has not changed -- so
   * pressing Solid on the tab picker while already in Solid left the device sitting on the
   * picker with the key looking dead. Worse from inside a sketch, where the inSketch rule
   * keeps the root fixed no matter which ribbon tab Fusion moves to.
   *
   * Returns true if anything was closed.
   */
  Navigator.prototype.closeDoors = function () {
    var closed = false;
    while (this.stack.length && this._isGlobal(this.stack[this.stack.length - 1])) {
      this.stack.pop();
      closed = true;
    }
    if (closed) {
      this.offset = 0;
    }
    return closed;
  };

  Navigator.prototype.currentPageId = function () {
    return this.stack.length ? this.stack[this.stack.length - 1] : this.rootPage;
  };

  Navigator.prototype.currentPage = function () {
    var page = this.layout.pages[this.currentPageId()];
    return page || { title: '', keys: [] };
  };

  Navigator.prototype.open = function (pageId) {
    if (!this.layout.pages[pageId]) {
      return false;
    }
    this.stack.push(pageId);
    this.offset = 0;
    return true;
  };

  Navigator.prototype.back = function () {
    if (!this.stack.length) {
      return false;
    }
    this.stack.pop();
    this.offset = 0;
    return true;
  };

  Navigator.prototype.home = function () {
    if (!this.stack.length && this.offset === 0) {
      return false;
    }
    this.stack = [];
    this.offset = 0;
    return true;
  };

  Navigator.prototype.pageCount = function (slotCount) {
    var total = this.currentPage().keys.length;
    if (slotCount <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(total / slotCount));
  };

  /* Dial rotation pages through a page too large to fit. Clamped, not wrapped: wrapping
   * past the end back to the start is disorienting on a device you are not looking at. */
  Navigator.prototype.scroll = function (delta, slotCount) {
    var pages = this.pageCount(slotCount);
    var next = Math.min(Math.max(this.offset + delta, 0), pages - 1);
    if (next === this.offset) {
      return false;
    }
    this.offset = next;
    return true;
  };

  /* The slice of key definitions visible right now, padded to slotCount with nulls so the
   * caller can blank unused keys rather than leaving a stale icon behind. */
  Navigator.prototype.visibleKeys = function (slotCount) {
    var keys = this.currentPage().keys || [];
    var start = this.offset * slotCount;
    var visible = keys.slice(start, start + slotCount);
    while (visible.length < slotCount) {
      visible.push(null);
    }
    return visible;
  };

  Navigator.prototype.canGoBack = function () {
    return this.stack.length > 0;
  };

  var api = {
    Navigator: Navigator,
    resolveRootPage: resolveRootPage,
    matchesRule: matchesRule
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.FsdLayout = api;
  }
}(typeof self !== 'undefined' ? self : this));
