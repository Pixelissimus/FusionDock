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

  Navigator.prototype._save = function () {
    if (this.rootPage) {
      this.memory[this.rootPage] = { stack: this.stack.slice(), offset: this.offset };
    }
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
