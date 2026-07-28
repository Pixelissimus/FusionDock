/*
 * Layout rule-matching and navigation tests.
 *
 * The per-context memory is the feature that answers the loudest complaint in the macropad
 * user research ("a context switch dumps me back on page 1"), so it is tested hardest.
 *
 * Run:  node --test "tests/*.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const layoutModule = require(path.join(
  __dirname, '..', 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin', 'plugin', 'layout.js'
));

const { Navigator, resolveRootPage, matchesRule } = layoutModule;

const SHIPPED_LAYOUT_PATH = path.join(__dirname, '..', 'src', 'layouts', 'default.json');

// The real number of context slots on the N1. Not a magic 12: all 15 keys have been context
// keys since the fixed-region change, and a stale slot count made a page look overfull.
const SLOT_COUNT = 15;

function makeLayout() {
  return {
    fixed: [{ cmd: 'UndoCommand', label: 'Undo' }],
    rules: [
      { when: { connected: false }, page: 'disconnected' },
      { when: { dialogOpen: true }, page: 'dialog' },
      { when: { inSketch: true }, page: 'sketch' },
      { when: { workspace: 'FusionSolidEnvironment' }, page: 'solid' },
      { when: {}, page: 'home' }
    ],
    pages: {
      disconnected: { title: 'Offline', keys: [] },
      dialog: { title: 'Command', keys: [{ text: 'ok', label: 'OK' }] },
      home: { title: 'Home', keys: [{ cmd: 'A', label: 'A' }] },
      solid: { title: 'Solid', keys: [{ page: 'solid.create', label: 'Create' }] },
      'solid.create': {
        title: 'Create',
        // 14 keys so it overflows a 12-slot page and exercises scrolling.
        keys: Array.from({ length: 14 }, (_, i) => ({ cmd: 'C' + i, label: 'C' + i }))
      },
      sketch: { title: 'Sketch', keys: [{ page: 'sketch.circle', label: 'Circle' }] },
      'sketch.circle': {
        title: 'Circle',
        keys: Array.from({ length: 5 }, (_, i) => ({ cmd: 'Circ' + i, label: 'Circ' + i }))
      }
    }
  };
}

const SOLID = { connected: true, workspace: 'FusionSolidEnvironment', inSketch: false, dialogOpen: false };
const SKETCH = { connected: true, workspace: 'FusionSolidEnvironment', inSketch: true, dialogOpen: false };
const DIALOG = { connected: true, workspace: 'FusionSolidEnvironment', inSketch: true, dialogOpen: true };

/* ------------------------------------------------------------------ rule matching */

test('an empty when clause matches anything', () => {
  assert.strictEqual(matchesRule({}, { anything: 1 }), true);
  assert.strictEqual(matchesRule(undefined, {}), true);
});

test('a rule requires every listed field to match', () => {
  assert.strictEqual(matchesRule({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
  assert.strictEqual(matchesRule({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
  assert.strictEqual(matchesRule({ a: 1 }, {}), false);
});

test('rules are evaluated in order, most specific first', () => {
  const layout = makeLayout();
  // Sketch state also satisfies the workspace rule; the earlier sketch rule must win.
  assert.strictEqual(resolveRootPage(layout, SKETCH), 'sketch');
  // A dialog open during a sketch must beat both.
  assert.strictEqual(resolveRootPage(layout, DIALOG), 'dialog');
  assert.strictEqual(resolveRootPage(layout, SOLID), 'solid');
  assert.strictEqual(resolveRootPage(layout, { connected: false }), 'disconnected');
  assert.strictEqual(resolveRootPage(layout, { connected: true }), 'home');
});

test('whenNot vetoes a rule that would otherwise match', () => {
  const layout = makeLayout();
  layout.rules[1].whenNot = { activeCommand: 'SketchCreate' };

  // Confirmed on hardware: SketchCreate reports dialogOpen for the whole time the user is
  // picking a plane, which flashed OK/Cancel onto the device for no reason.
  assert.strictEqual(
    resolveRootPage(layout, Object.assign({}, DIALOG, { activeCommand: 'SketchCreate' })),
    'sketch',
    'a vetoed rule must fall through to the next match');

  // Any other command with a dialog open still gets the dialog page.
  assert.strictEqual(
    resolveRootPage(layout, Object.assign({}, DIALOG, { activeCommand: 'Extrude' })),
    'dialog');
});

/* ------------------------------------------------------------------ navigation */

test('applyState reports whether a repaint is needed', () => {
  const nav = new Navigator(makeLayout());
  assert.strictEqual(nav.applyState(SOLID), true, 'first state is a change');
  assert.strictEqual(nav.applyState(SOLID), false, 'same context must not repaint');
  assert.strictEqual(nav.applyState(SKETCH), true, 'context change must repaint');
});

test('opening and closing sub-pages walks the stack', () => {
  const nav = new Navigator(makeLayout());
  nav.applyState(SOLID);
  assert.strictEqual(nav.currentPageId(), 'solid');
  assert.strictEqual(nav.canGoBack(), false);

  assert.strictEqual(nav.open('solid.create'), true);
  assert.strictEqual(nav.currentPageId(), 'solid.create');
  assert.strictEqual(nav.canGoBack(), true);

  assert.strictEqual(nav.back(), true);
  assert.strictEqual(nav.currentPageId(), 'solid');
  assert.strictEqual(nav.back(), false, 'back at the root is a no-op');
});

test('opening an unknown page is refused rather than blanking the device', () => {
  const nav = new Navigator(makeLayout());
  nav.applyState(SOLID);
  assert.strictEqual(nav.open('does.not.exist'), false);
  assert.strictEqual(nav.currentPageId(), 'solid');
});

test('home returns to the root and reports whether anything changed', () => {
  const nav = new Navigator(makeLayout());
  nav.applyState(SOLID);
  assert.strictEqual(nav.home(), false, 'already home');
  nav.open('solid.create');
  assert.strictEqual(nav.home(), true);
  assert.strictEqual(nav.currentPageId(), 'solid');
});

/* ------------------------------ the headline feature: per-context memory */

test('returning to a context restores the sub-page you were on', () => {
  const nav = new Navigator(makeLayout());

  nav.applyState(SKETCH);
  nav.open('sketch.circle');
  assert.strictEqual(nav.currentPageId(), 'sketch.circle');

  // Leave the sketch environment entirely, then come back.
  nav.applyState(SOLID);
  assert.strictEqual(nav.currentPageId(), 'solid');

  nav.applyState(SKETCH);
  assert.strictEqual(nav.currentPageId(), 'sketch.circle',
    'coming back to sketch must restore the circle sub-page, not reset to the root');
});

test('a dialog opening and closing does not lose your place', () => {
  // The exact scenario users complain about: you are deep in a page, something transient
  // takes over the device, and when it goes you are back at square one.
  const nav = new Navigator(makeLayout());
  nav.applyState(SKETCH);
  nav.open('sketch.circle');

  nav.applyState(DIALOG);
  assert.strictEqual(nav.currentPageId(), 'dialog');

  nav.applyState(SKETCH);
  assert.strictEqual(nav.currentPageId(), 'sketch.circle');
});

test('scroll position is remembered per context too', () => {
  const nav = new Navigator(makeLayout());
  nav.applyState(SOLID);
  nav.open('solid.create');
  assert.strictEqual(nav.scroll(1, 12), true);
  assert.strictEqual(nav.offset, 1);

  nav.applyState(SKETCH);
  nav.applyState(SOLID);
  assert.strictEqual(nav.currentPageId(), 'solid.create');
  assert.strictEqual(nav.offset, 1, 'scroll offset must survive the round trip');
});

/*
 * Reported on hardware 2026-07-28, in Jamie's words: "if I press solid, it goes back to new
 * tab". Pressing Tabs pushed the global home page onto Solid's stack, the per-context memory
 * recorded it, and returning to Solid restored it. Global pages are now excluded from memory.
 */
test('a global door is never remembered as if it were a sub-page', () => {
  const layout = JSON.parse(fs.readFileSync(SHIPPED_LAYOUT_PATH, 'utf8'));
  const nav = new Navigator(layout);
  const at = (tab) => ({ connected: true, workspace: 'FusionSolidEnvironment', tab: tab,
    tabName: null, inSketch: false, dialogOpen: false, hasDesign: true });

  nav.applyState(at('SolidTab'));
  assert.strictEqual(nav.currentPageId(), 'solid');

  nav.open('home');                       // the fixed Tabs key
  assert.strictEqual(nav.currentPageId(), 'home');

  nav.applyState(at('SurfaceTab'));
  assert.strictEqual(nav.currentPageId(), 'surface', 'switching tab must leave the door');

  nav.applyState(at('SolidTab'));
  assert.strictEqual(nav.currentPageId(), 'solid',
    'coming back to Solid must land on Solid, not on the tabs page it had open');

  // The actual feature still has to work: a real folder IS remembered.
  nav.open('solid.create');
  nav.applyState(at('SurfaceTab'));
  nav.applyState(at('SolidTab'));
  assert.strictEqual(nav.currentPageId(), 'solid.create',
    'a genuine sub-page must still survive the round trip');

  // And View, the other global, behaves the same way.
  nav.home();
  nav.open('view');
  nav.applyState(at('SurfaceTab'));
  nav.applyState(at('SolidTab'));
  assert.strictEqual(nav.currentPageId(), 'solid');
});

test('a remembered sub-page that no longer exists is dropped, not rendered empty', () => {
  const layout = makeLayout();
  const nav = new Navigator(layout);
  nav.applyState(SKETCH);
  nav.open('sketch.circle');
  nav.applyState(SOLID);

  // Simulate the user editing the layout file between visits.
  delete layout.pages['sketch.circle'];

  nav.applyState(SKETCH);
  assert.strictEqual(nav.currentPageId(), 'sketch',
    'a stale remembered page must fall back to the context root');
});

/* ------------------------------------------------------------------ paging */

test('page count is derived from key count and available slots', () => {
  const nav = new Navigator(makeLayout());
  nav.applyState(SOLID);
  nav.open('solid.create');           // 14 keys
  assert.strictEqual(nav.pageCount(12), 2);
  assert.strictEqual(nav.pageCount(14), 1);
  assert.strictEqual(nav.pageCount(0), 1, 'must not divide by zero');
});

test('scrolling clamps at both ends rather than wrapping', () => {
  // Wrapping past the end back to the start is disorienting on a device you are not
  // looking at, so this is deliberate.
  const nav = new Navigator(makeLayout());
  nav.applyState(SOLID);
  nav.open('solid.create');

  assert.strictEqual(nav.scroll(-1, 12), false, 'cannot scroll before the first page');
  assert.strictEqual(nav.offset, 0);

  assert.strictEqual(nav.scroll(1, 12), true);
  assert.strictEqual(nav.scroll(1, 12), false, 'cannot scroll past the last page');
  assert.strictEqual(nav.offset, 1);
});

test('visibleKeys returns exactly the slot count, padded with nulls', () => {
  const nav = new Navigator(makeLayout());
  nav.applyState(SOLID);
  nav.open('solid.create');           // 14 keys over 12 slots

  const first = nav.visibleKeys(12);
  assert.strictEqual(first.length, 12);
  assert.strictEqual(first[0].cmd, 'C0');
  assert.strictEqual(first[11].cmd, 'C11');

  nav.scroll(1, 12);
  const second = nav.visibleKeys(12);
  assert.strictEqual(second.length, 12, 'short pages must still fill every slot');
  assert.strictEqual(second[0].cmd, 'C12');
  assert.strictEqual(second[1].cmd, 'C13');
  // Padding matters: without it, stale icons from the previous page stay on the device.
  assert.strictEqual(second[2], null);
  assert.strictEqual(second[11], null);
});

test('an unknown page id degrades to an empty page instead of throwing', () => {
  const nav = new Navigator(makeLayout());
  nav.rootPage = 'nonexistent';
  assert.deepStrictEqual(nav.currentPage(), { title: '', keys: [] });
  assert.strictEqual(nav.visibleKeys(3).length, 3);
});

/* ------------------------------------------------------------------ shipped layout */

test('the shipped layout is valid and self-consistent', () => {
  const layout = JSON.parse(fs.readFileSync(SHIPPED_LAYOUT_PATH, 'utf8'));

  // Every rule points at a page that exists.
  for (const rule of layout.rules) {
    assert.ok(layout.pages[rule.page],
      `rule targets missing page: ${rule.page}`);
  }

  // Every sub-page link points at a page that exists -- a typo here would strand the user
  // on a key that does nothing.
  for (const [pageId, page] of Object.entries(layout.pages)) {
    for (const key of page.keys || []) {
      if (key.page) {
        assert.ok(layout.pages[key.page],
          `page "${pageId}" links to missing page "${key.page}"`);
      }
      // nav is checked against the values activate() actually handles, not merely for being
      // present. A typo such as nav: "Back" would otherwise satisfy the assertion below while
      // doing nothing on the device — and on a folder page the Back key is the only
      // key-based way out.
      if (key.nav !== undefined) {
        assert.ok(['back', 'home'].includes(key.nav),
          `page "${pageId}" key "${key.label}" has nav "${key.nav}", `
          + 'which activate() does not handle');
      }
      assert.ok(key.cmd || key.page || key.text || key.view || key.tab || key.workspace
        || key.nav || key.disabled,
        `page "${pageId}" has a key with no action: ${JSON.stringify(key)}`);
    }
  }

  // Globals live on the physical aux controls, not on the grid. The N1 has exactly two side
  // buttons, so more than two entries would silently never appear.
  assert.ok(layout.aux, 'layout must define an aux block');
  assert.ok(layout.aux.buttons.length <= 2,
    'the N1 has only two side buttons');
  assert.ok(layout.aux.dial && layout.aux.dial.rotate && layout.aux.dial.press,
    'the dial needs both a rotate and a press binding');

  // Every key must have SOMETHING to draw: a Fusion icon via cmd/peek, or our own art via
  // 'icon'. A key with none of them renders as a bare label, which is what the menu keys
  // looked like before they had art.
  for (const [pageId, page] of Object.entries(layout.pages)) {
    for (const key of page.keys || []) {
      if (key.disabled) { continue; }
      assert.ok(key.cmd || key.peek || key.icon || key.view || key.text,
        `page "${pageId}" key "${key.label}" has no image source at all`);
    }
  }

  // There must be a physical way out of a sub-page, or it is a dead end. Home is enough --
  // it returns to the context root from any depth.
  const auxActions = JSON.stringify([layout.aux.buttons, layout.aux.dial]);
  assert.ok(auxActions.includes('"back"') || auxActions.includes('"home"'),
    'Back or Home must be bound on the aux controls, or sub-pages cannot be left');

  // Every page a rule can land on must offer a route to the view page, which is otherwise
  // unreachable now that View is not on a side button.
  for (const rule of layout.rules) {
    const page = layout.pages[rule.page];
    // dashboard is two keys by design -- with no design open there is nothing to look at,
    // so a View key there would be a third thing that cannot work.
    if (['disconnected', 'dialog', 'view', 'dashboard'].includes(rule.page)) {
      continue;
    }
    assert.ok((page.keys || []).some((key) => key.page === 'view'),
      `page "${rule.page}" has no way to reach the view page`);
  }

  // A final catch-all rule is required or an unmatched state resolves to nothing.
  const last = layout.rules[layout.rules.length - 1];
  assert.deepStrictEqual(last.when, {}, 'last rule must be an unconditional fallback');
});

/*
 * States captured verbatim off the running add-in, so the rules are checked against what
 * Fusion actually publishes rather than against what the rules were written to expect.
 *
 * The start-screen case earned its place: the first version of that rule matched on
 * hasDesign: false, which looked obviously right and could never fire -- Fusion keeps an
 * Untitled document behind the start screen, so hasDesign is TRUE there. Only the workspace
 * is null.
 */
test('real states captured from Fusion resolve to the right pages', () => {
  const layout = JSON.parse(fs.readFileSync(SHIPPED_LAYOUT_PATH, 'utf8'));

  const OBSERVED = [
    // Fusion's start screen, 2026-07-28.
    [{ connected: true, workspace: null, tab: null, tabName: null, inSketch: false,
      dialogOpen: false, hasDesign: true, documentName: 'Untitled' }, 'dashboard'],
    // The T-Spline environment, 2026-07-28. Form is a workspace, not a tab.
    [{ connected: true, workspace: 'TSplineEnvironment', tab: 'FormTab', tabName: 'FORM',
      inSketch: false, dialogOpen: false, hasDesign: true }, 'form'],
    // Every tab id and display name below is verbatim from GET /tabs on 2026-07-28 --
    // docs/research/tab-dump.json. Note 'Mesh', not 'MESH': Fusion's own casing is not
    // consistent, which is exactly why the rules match on id.
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'SolidTab', tabName: 'SOLID',
      inSketch: false, dialogOpen: false, hasDesign: true }, 'solid'],
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'SurfaceTab',
      tabName: 'SURFACE', inSketch: false, dialogOpen: false, hasDesign: true }, 'surface'],
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'ParaMeshOuterTab',
      tabName: 'Mesh', inSketch: false, dialogOpen: false, hasDesign: true }, 'mesh'],
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'SheetMetalTab',
      tabName: 'SHEET METAL', inSketch: false, dialogOpen: false, hasDesign: true }, 'sheetmetal'],
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'PlasticTab',
      tabName: 'PLASTIC', inSketch: false, dialogOpen: false, hasDesign: true }, 'plastic'],
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'ToolsTab',
      tabName: 'UTILITIES', inSketch: false, dialogOpen: false, hasDesign: true }, 'utilities'],
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'SketchTab', tabName: 'SKETCH',
      inSketch: true, dialogOpen: false, hasDesign: true }, 'sketch'],
    // Direct Mesh Editing. Matched on the tab alone, so it must resolve whichever workspace
    // Fusion reports -- that is the part still unconfirmed on hardware.
    [{ connected: true, workspace: 'FusionSolidEnvironment', tab: 'ParaMeshBaseFeatureTab',
      tabName: 'Direct Mesh Editing', inSketch: false, dialogOpen: false, hasDesign: true },
    'mesh.direct'],
    [{ connected: true, workspace: 'SomeOtherEnvironment', tab: 'ParaMeshBaseFeatureTab',
      tabName: 'Direct Mesh Editing', inSketch: false, dialogOpen: false, hasDesign: true },
    'mesh.direct']
  ];

  for (const [state, expected] of OBSERVED) {
    assert.strictEqual(resolveRootPage(layout, state), expected,
      `state ${JSON.stringify(state)} should resolve to "${expected}"`);
  }
});

/*
 * The fixed region is the whole reason a context page is allowed to repaint all 15 keys: three
 * of them never move, so there is always a door out. It only reads as a coherent block in both
 * orientations at slots 13-15, which means it must be the LAST three entries of the ordered
 * list -- an accidental 14- or 16-key page silently slides it somewhere else.
 */
test('every context page fills exactly 15 slots and ends with the fixed region', () => {
  const layout = JSON.parse(fs.readFileSync(SHIPPED_LAYOUT_PATH, 'utf8'));

  // Pages a rule can land on, minus the ones that are deliberately short prompts.
  const contextPages = layout.rules
    .map((rule) => rule.page)
    .filter((id) => !['disconnected', 'dialog', 'home', 'dashboard'].includes(id));
  // ...plus their page 2s, which are reached by the More key.
  for (const id of Object.keys(layout.pages)) {
    if (id.endsWith('.p2')) { contextPages.push(id); }
  }
  assert.ok(contextPages.length >= 8, 'expected a page per modelling context');

  for (const id of contextPages) {
    const keys = layout.pages[id].keys;
    assert.strictEqual(keys.length, 15, `page "${id}" must fill all 15 slots`);

    const [tabs, view, more] = keys.slice(12);
    assert.strictEqual(tabs.page, 'home', `page "${id}" slot 13 must be the Tabs door`);
    assert.strictEqual(view.page, 'view', `page "${id}" slot 14 must be the View door`);
    // Slot 15 is More on a page 1, Back on a page 2, or a plain key on a context that has
    // only one page. What it must never be is missing.
    assert.ok(more && (more.page || more.nav || more.cmd),
      `page "${id}" slot 15 must do something`);
    if (id.endsWith('.p2')) {
      assert.strictEqual(more.nav, 'back', `page "${id}" slot 15 must return to page 1`);
    }
  }
});

test('the shipped layout drives real navigation end to end', () => {
  const layout = JSON.parse(fs.readFileSync(SHIPPED_LAYOUT_PATH, 'utf8'));
  const nav = new Navigator(layout);

  nav.applyState({ connected: true, workspace: 'FusionSolidEnvironment', tab: 'SolidTab', inSketch: false, dialogOpen: false });
  assert.strictEqual(nav.currentPageId(), 'solid');

  // The scenario from the brief: start a sketch, press Rectangle, get the variants.
  nav.applyState({ connected: true, workspace: 'FusionSolidEnvironment', inSketch: true, dialogOpen: false });
  assert.strictEqual(nav.currentPageId(), 'sketch');

  // Count the commands, not the raw slots: every folder page also carries a Back key, added
  // 2026-07-28 so a folder has a visible exit rather than only the dial.
  const variants = () => nav.currentPage().keys.filter((k) => !k.nav);
  const exits = () => nav.currentPage().keys.filter((k) => k.nav === 'back');

  const rectangleKey = nav.currentPage().keys.find((k) => k.page === 'sketch.rectangle');
  assert.ok(rectangleKey, 'sketch page should offer a rectangle folder');
  nav.open(rectangleKey.page);
  assert.strictEqual(variants().length, 3, 'three rectangle variants');
  assert.strictEqual(exits().length, 1, 'and a visible way out');

  // Circles: five variants, all fitting one page of the real 15 slots.
  nav.back();
  const circleKey = nav.currentPage().keys.find((k) => k.page === 'sketch.circle');
  nav.open(circleKey.page);
  assert.strictEqual(variants().length, 5);
  assert.strictEqual(nav.pageCount(SLOT_COUNT), 1);
});
