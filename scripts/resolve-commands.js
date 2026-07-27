/*
 * Reconcile the layout's command ids against the ones Fusion actually has.
 *
 * The ids in src/layouts/default.json are BEST GUESSES -- they were written without a
 * Fusion install to check against. This script asks the running add-in for the real list
 * and reports every id that does not exist, using each key's "match" (its display name in
 * Fusion's UI) to suggest the correct one.
 *
 *   node scripts/resolve-commands.js              report only
 *   node scripts/resolve-commands.js --write      apply confident suggestions to the layout
 *   node scripts/resolve-commands.js --dump out.json   save the full command inventory
 *
 * Fusion must be running with the add-in loaded.
 *
 * IMPORTANT: Fusion creates command definitions lazily. Before running this, click through
 * every workspace and tab you care about (Solid, Surface, Mesh, Sheet Metal, and open a
 * sketch) or commands you have not visited will be missing from the dump.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAYOUT_PATH = path.join(ROOT, 'src', 'layouts', 'default.json');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const dumpIndex = argv.indexOf('--dump');
const DUMP_PATH = dumpIndex !== -1 ? argv[dumpIndex + 1] : null;

function port() {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'src', 'fusion-addin', 'config.json'), 'utf8')
    );
    return config.port || 8731;
  } catch (error) {
    return 8731;
  }
}

function normalise(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* Collect every key in the layout that names a Fusion command. */
function layoutKeys(layout) {
  const keys = [];
  // The aux controls (side buttons and dial) carry real command ids too -- Undo and Redo
  // live on the dial. They are nested, so walk the block rather than listing paths.
  (function walkAux(node, where) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) {
      node.forEach((item) => walkAux(item, where));
      return;
    }
    if (node.cmd) { keys.push({ entry: node, where }); }
    if (node.peek) { keys.push({ entry: node, where, field: 'peek' }); }
    for (const [name, value] of Object.entries(node)) {
      if (value && typeof value === 'object') { walkAux(value, where + '.' + name); }
    }
  }(layout.aux, 'aux'));
  for (const [pageId, page] of Object.entries(layout.pages || {})) {
    for (const entry of page.keys || []) {
      if (entry.cmd) { keys.push({ entry, where: pageId }); }
      // A folder key's "peek" is only used to borrow an icon, but a wrong one shows a
      // blank key, so it is worth checking too.
      if (entry.peek) { keys.push({ entry, where: pageId, field: 'peek' }); }
    }
  }
  return keys;
}

function suggest(commands, entry) {
  const wanted = normalise(entry.match || entry.label);
  if (!wanted) { return []; }

  const exact = commands.filter((command) => normalise(command.name) === wanted);
  if (exact.length) { return exact; }

  return commands
    .filter((command) => {
      const name = normalise(command.name);
      return name.includes(wanted) || wanted.includes(name);
    })
    .slice(0, 5);
}

async function main() {
  const base = `http://127.0.0.1:${port()}`;

  let commands;
  try {
    const response = await fetch(`${base}/commands`);
    if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
    commands = (await response.json()).commands || [];
  } catch (error) {
    console.error(`Could not reach the add-in at ${base}`);
    console.error(`  ${error.message}`);
    console.error('');
    console.error('Start Fusion 360 and check the add-in is running under');
    console.error('Utilities > Scripts and Add-Ins > Add-Ins.');
    process.exitCode = 1;
    return;
  }

  console.log(`Fusion reports ${commands.length} command definitions.`);
  if (commands.length < 200) {
    console.log('That looks low. Fusion creates definitions lazily -- visit every');
    console.log('workspace and tab, open a sketch, then run this again.');
  }
  console.log('');

  if (DUMP_PATH) {
    fs.writeFileSync(DUMP_PATH, JSON.stringify({ commands }, null, 2));
    console.log(`Wrote the full inventory to ${DUMP_PATH}\n`);
  }

  const known = new Set(commands.map((command) => command.id));
  const layout = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'));
  const keys = layoutKeys(layout);

  const good = [];
  const broken = [];

  for (const record of keys) {
    const field = record.field || 'cmd';
    const id = record.entry[field];
    if (known.has(id)) {
      good.push(record);
    } else {
      broken.push({ ...record, field, id, suggestions: suggest(commands, record.entry) });
    }
  }

  console.log(`${good.length} of ${keys.length} layout commands resolve correctly.`);
  console.log('');

  if (!broken.length) {
    console.log('Every command id in the layout exists in this Fusion build.');
    return;
  }

  console.log(`${broken.length} need attention:\n`);
  let applied = 0;

  for (const item of broken) {
    console.log(`  ${item.where} / ${item.entry.label}`);
    console.log(`    ${item.field}: ${item.id}  (not found)`);
    if (!item.suggestions.length) {
      console.log('    no suggestion -- find it by hand in the dump');
    } else {
      for (const suggestion of item.suggestions) {
        console.log(`    -> ${suggestion.id}   "${suggestion.name}"`);
      }
      // Only auto-apply when there is exactly one candidate and it matched by exact name;
      // anything looser is a guess and a wrong key is worse than an obviously dead one.
      if (WRITE && item.suggestions.length === 1
          && normalise(item.suggestions[0].name) === normalise(item.entry.match || item.entry.label)) {
        item.entry[item.field] = item.suggestions[0].id;
        applied += 1;
        console.log('    APPLIED');
      }
    }
    console.log('');
  }

  if (WRITE) {
    if (applied) {
      fs.writeFileSync(LAYOUT_PATH, JSON.stringify(layout, null, 2) + '\n');
      console.log(`Applied ${applied} confident fix(es) to ${LAYOUT_PATH}`);
      console.log('Re-run scripts/install.js to push the updated layout to the plugin.');
    } else {
      console.log('No change written -- no suggestion was confident enough to apply.');
    }
  } else {
    console.log('Re-run with --write to apply the confident suggestions.');
  }
}

main();
