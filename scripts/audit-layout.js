/*
 * Walk every key on every page and report anything that will not behave the way the layout
 * implies it should.
 *
 * Written after a hardware session on 2026-07-28 where a key did something subtly wrong --
 * pressing Tabs poisoned a context's memory, so returning to that context reopened the tabs
 * page. The class of bug is "the key fires, but the navigation around it is wrong", which no
 * amount of checking command ids would have caught.
 *
 * Node stdlib only. Read-only: it never touches Fusion and never presses anything.
 *
 * Usage:  node scripts/audit-layout.js
 * Exit code 1 if any ERROR is found. WARNs are judgement calls and do not fail.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LAYOUT = path.join(__dirname, '..', 'src', 'layouts', 'default.json');
const STATIC = path.join(__dirname, '..', 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin', 'static');
const DUMP = path.join(__dirname, '..', 'docs', 'research', 'command-dump.json');

const SLOTS = 15;

/* command-dump.json reports hasIcon: true for all of these, but GET /icon returns 404 for
 * every one -- measured against the running add-in on 2026-07-28. Whether that is a gap in
 * resolve_icon() or genuinely empty resource folders is still open (see the backlog). Listed
 * here so the audit reports what the device will really draw rather than what the dump
 * claims. */
const NO_ICON_DESPITE_FLAG = new Set([
  'NewDocumentCommand', 'Coil', 'AppearanceCommand', 'PhysicalMaterialCommand',
  'ParaMeshCloseCracksCommand', 'ParaMeshBridgeCommand', 'FusionSheetMetalHemFlangeCommand',
  'FusionSheetMetalCornerCommand', 'FusionSheetMetalFilletCommand',
  'FusionSheetMetalChamferCommand'
]);
// render.js shrinks the label until it fits, stopping at 8px. Past roughly this many
// characters it is shrinking below what is readable at arm's length on a 96px key.
const LABEL_LIMIT = 13;

const layout = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
const commands = new Map(
  JSON.parse(fs.readFileSync(DUMP, 'utf8')).commands.map((c) => [c.id, c])
);

const errors = [];
const warns = [];
const notes = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const note = (m) => notes.push(m);

const pages = layout.pages;
const pageIds = Object.keys(pages);
const rulePages = layout.rules.map((r) => r.page);

/* ------------------------------------------------------- 1. what can be reached */

const linkedFrom = new Map();
for (const [id, page] of Object.entries(pages)) {
  for (const key of page.keys || []) {
    if (key.page) {
      if (!linkedFrom.has(key.page)) { linkedFrom.set(key.page, []); }
      linkedFrom.get(key.page).push(id);
    }
  }
}

for (const id of pageIds) {
  const reachable = rulePages.includes(id) || linkedFrom.has(id);
  if (!reachable) {
    err(`page "${id}" is unreachable: no rule lands on it and no key opens it`);
  }
}

/* ------------------------------------------------------- 2. what can be left */

/*
 * The dial press is bound to nav:home, which empties the stack from any depth, so no page is
 * ever a hard dead end. But a folder page reached from a context has no key of its own that
 * goes back -- if the dial is unbound or the user does not know about it, the only visible
 * exit is gone. Worth knowing, not worth failing.
 */
const dialPress = ((layout.aux || {}).dial || {}).press || {};
const dialGoesHome = JSON.stringify(dialPress).includes('"home"');
if (!dialGoesHome) {
  err('the dial press is not bound to nav:home -- sub-pages would become dead ends');
}

for (const [id, page] of Object.entries(pages)) {
  // Global pages are NOT exempt. They are opened from every context, so being unable to
  // leave one is worse there, not better -- the View page had no exit key at all while all
  // thirteen folder pages gained one.
  if (rulePages.includes(id) && !page.global) { continue; }
  const keys = page.keys || [];
  // A `page` key does NOT count: it opens something deeper, it does not leave. The exits are
  // an explicit nav, or a tab key -- picking a destination on the tab picker closes the picker
  // (see closeDoors in layout.js), which is how `home` is left.
  const hasVisibleExit = keys.some((k) => k.nav === 'back' || k.nav === 'home'
    || k.tab || k.workspace);
  if (!hasVisibleExit) {
    note(`sub-page "${id}" has no exit key of its own -- only the dial (Home) leaves it`);
  }
}

/* ------------------------------------------------------- 3. slots and the fixed region */

for (const [id, page] of Object.entries(pages)) {
  const keys = page.keys || [];
  if (keys.length > SLOTS) {
    warn(`page "${id}" holds ${keys.length} keys; the dial has to page through it, `
      + 'which silently disables the view cycle on that page');
  }
  if (rulePages.includes(id) && !page.global && keys.length !== SLOTS
      && id !== 'disconnected' && id !== 'dialog' && id !== 'dashboard') {
    err(`context page "${id}" has ${keys.length} keys, not ${SLOTS}`);
  }
}

/* Page 2 must be reachable and must come back. */
for (const id of pageIds) {
  if (!id.endsWith('.p2')) { continue; }
  const root = id.slice(0, -3);
  if (!pages[root]) {
    err(`"${id}" has no matching page 1 ("${root}")`);
    continue;
  }
  const opener = (pages[root].keys || []).some((k) => k.page === id);
  if (!opener) { err(`"${root}" has no key opening "${id}"`); }
  const back = (pages[id].keys || []).some((k) => k.nav === 'back');
  if (!back) { err(`"${id}" has no way back to page 1`); }
}

/* ------------------------------------------------------- 4. per-key checks */

const ACTIONS = ['cmd', 'page', 'tab', 'workspace', 'view', 'text', 'nav'];
const noIcon = [];
const seenLabels = new Map();

for (const [id, page] of Object.entries(pages)) {
  const withinPage = new Map();
  (page.keys || []).forEach((key, index) => {
    const where = `"${id}" slot ${index + 1} (${key.label || 'unlabelled'})`;

    const actions = ACTIONS.filter((a) => key[a] !== undefined);
    if (!actions.length && !key.disabled) {
      err(`${where} has no action`);
    }
    // tab and workspace travel together, and nav/page are the two navigation forms.
    const distinct = new Set(actions.map((a) => (a === 'workspace' ? 'tab' : a)));
    if (distinct.size > 1) {
      err(`${where} carries ${[...distinct].join(' + ')} -- only the first is honoured`);
    }

    if (key.page && !pages[key.page]) { err(`${where} opens missing page "${key.page}"`); }
    if (key.nav && !['back', 'home'].includes(key.nav)) {
      err(`${where} has unknown nav "${key.nav}"`);
    }

    for (const field of ['cmd', 'peek']) {
      const value = key[field];
      if (!value) { continue; }
      const definition = commands.get(value);
      if (!definition) {
        err(`${where} references unknown command id "${value}" (${field})`);
      } else if (!definition.hasIcon || NO_ICON_DESPITE_FLAG.has(value)) {
        noIcon.push(`${where} -> ${value}`);
      }
    }

    if (key.icon && !fs.existsSync(path.join(STATIC, key.icon + '.png'))) {
      err(`${where} names missing artwork static/${key.icon}.png`);
    }

    if (!key.disabled && !key.cmd && !key.peek && !key.icon && !key.view && !key.text
        && !key.nav) {
      warn(`${where} has no image source and will draw as a bare label`);
    }

    if (key.label && key.label.length > LABEL_LIMIT && (page.keys || []).length > 1) {
      warn(`${where} label is ${key.label.length} characters; it will shrink towards 8px`);
    }

    // The same command twice on one page is almost always a mistake.
    const signature = key.cmd || key.page || key.view || key.text;
    if (signature) {
      if (withinPage.has(signature)) {
        warn(`${where} repeats ${signature}, already on slot ${withinPage.get(signature)}`);
      } else {
        withinPage.set(signature, index + 1);
      }
    }

    if (key.label) {
      if (!seenLabels.has(key.label)) { seenLabels.set(key.label, new Set()); }
      seenLabels.get(key.label).add(key.cmd || key.page || key.tab || key.view || key.nav);
    }
  });
}

/* A label that means two different things across the device is a memory trap. */
for (const [label, targets] of seenLabels) {
  if (targets.size > 1) {
    const list = [...targets].join(', ');
    // Fillet, Trim, Mirror etc. legitimately differ per environment -- sketch Fillet is not
    // solid Fillet. Only flag it when the label is one of the navigation words.
    // 'More' and 'Back' are relative moves -- each context's More opens its own page 2, and
    // each folder's Back returns to its own parent. Tabs and View are absolute and must not
    // vary.
    if (['Tabs', 'View', 'Home'].includes(label)) {
      warn(`navigation label "${label}" maps to more than one target: ${list}`);
    } else {
      note(`label "${label}" is used for ${targets.size} different commands: ${list}`);
    }
  }
}

/* ------------------------------------------------------- 5. rules */

const seenRules = [];
layout.rules.forEach((rule, index) => {
  const when = rule.when || {};
  if (!pages[rule.page]) { err(`rule ${index + 1} targets missing page "${rule.page}"`); }

  // A rule that is a superset of an earlier one can never fire.
  for (const earlier of seenRules) {
    const fields = Object.keys(earlier.when);
    const shadowed = fields.length > 0
      && fields.every((f) => when[f] === earlier.when[f]);
    if (shadowed && Object.keys(when).length >= fields.length && !rule.whenNot) {
      err(`rule ${index + 1} ("${rule.page}") can never fire: rule `
        + `${earlier.index + 1} ("${earlier.page}") already matches everything it does`);
    }
  }
  if (Object.keys(when).length === 0 && index !== layout.rules.length - 1) {
    err(`rule ${index + 1} matches everything but is not last -- nothing after it can fire`);
  }
  seenRules.push({ when, page: rule.page, index });
});

const last = layout.rules[layout.rules.length - 1];
if (Object.keys(last.when || {}).length !== 0) {
  err('the last rule is not an unconditional fallback');
}

/* Global pages must be marked, or the per-context memory will remember them as sub-pages --
 * the bug found on hardware on 2026-07-28. Any page opened from two or more different
 * contexts is a door, not a sub-page. */
for (const [id, from] of linkedFrom) {
  const contexts = new Set(from.filter((f) => rulePages.includes(f)));
  if (contexts.size >= 2 && !pages[id].global) {
    err(`page "${id}" is opened from ${contexts.size} different contexts but is not marked `
      + '"global": true -- it will be remembered per context and reopen itself');
  }
}

/* ------------------------------------------------------- report */

console.log(`Audited ${pageIds.length} pages, `
  + `${pageIds.reduce((n, id) => n + (pages[id].keys || []).length, 0)} keys, `
  + `${layout.rules.length} rules.\n`);

const show = (title, list, mark) => {
  if (!list.length) { return; }
  console.log(`${mark} ${title} (${list.length})`);
  list.forEach((m) => console.log(`   ${m}`));
  console.log('');
};

show('ERROR', errors, 'x');
show('WARN', warns, '!');
show('NOTE', notes, '-');

if (noIcon.length) {
  console.log(`- Keys whose command has no icon in this Fusion build (${noIcon.length}) -- `
    + 'they draw as a text-only key, which render.js handles');
  noIcon.forEach((m) => console.log(`   ${m}`));
  console.log('');
}

if (!errors.length) { console.log('No errors.'); }
process.exit(errors.length ? 1 : 0);
