/*
 * Assemble the bundle that gets uploaded to the Space marketplace.
 *
 * The store distributes ONE folder -- <UUID>.sdPlugin -- and the Stream Dock software drops it
 * into place. There is no moment during that install where an installer of ours could run, so
 * the Fusion add-in cannot be installed by the marketplace at all. It rides along inside the
 * bundle instead, next to install-fusion-addin.bat, which the user double-clicks once.
 *
 * The add-in is NOT duplicated in the repo. It lives in src/fusion-addin and is copied in here,
 * so there is exactly one copy to maintain and no chance of the two drifting apart.
 *
 * Node stdlib only. Output is left unzipped: the Space upload form's expected format has not
 * been confirmed (see docs/planning/publishing.md), and zipping a folder is one right-click.
 *
 * Usage:  node scripts/package.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_SRC = path.join(ROOT, 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin');
const ADDIN_SRC = path.join(ROOT, 'src', 'fusion-addin');
const OUT_ROOT = path.join(ROOT, 'dist');
const OUT = path.join(OUT_ROOT, 'com.fusiondock.streamdock.sdPlugin');

/* Compiled bytecode and tooling droppings must never reach a user's machine -- stale .pyc
 * beside fresh source is the hardest failure in this project to diagnose. */
const NEVER_COPY = new Set(['__pycache__', '.git', '.DS_Store', 'node_modules']);

let fileCount = 0;

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (NEVER_COPY.has(entry.name) || entry.name.endsWith('.pyc')) { continue; }
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(source, destination);
    } else {
      fs.copyFileSync(source, destination);
      fileCount += 1;
    }
  }
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PLUGIN_SRC, 'manifest.json'), 'utf8')
  );

  // Refuse to package a manifest still carrying development placeholders. Getting this wrong
  // means a store listing crediting nobody, pointing at nothing, and claiming compatibility
  // that has never been tested.
  const problems = [];
  if (!manifest.Author || /stream-dock|placeholder|todo/i.test(manifest.Author)) {
    problems.push(`Author is "${manifest.Author}"`);
  }
  if (!manifest.URL || /^https:\/\/github\.com\/?$/.test(manifest.URL)) {
    problems.push(`URL is "${manifest.URL}"`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.Version || '')) {
    problems.push(`Version "${manifest.Version}" is not semantic (x.y.z)`);
  }
  if (problems.length) {
    console.error('Not packaging -- the manifest still has placeholders:\n  '
      + problems.join('\n  '));
    process.exit(1);
  }

  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  copyTree(PLUGIN_SRC, OUT);
  copyTree(ADDIN_SRC, path.join(OUT, 'fusion-addin'));

  // The layout lives outside the .sdPlugin folder in the repo but INSIDE it once installed --
  // main.js fetches '../layouts/default.json' relative to plugin/index.html. install.js has
  // always done this; the first version of this script did not, and would have shipped a
  // bundle that installs cleanly and then does nothing at all.
  const layouts = path.join(OUT, 'layouts');
  fs.mkdirSync(layouts, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'src', 'layouts', 'default.json'),
    path.join(layouts, 'default.json')
  );
  fileCount += 1;

  // Everything the bundle cannot function without, checked against the assembled output
  // rather than against intent. Each of these has a failure mode that only shows up on
  // someone else's machine after they have downloaded it.
  const required = [
    ['install-fusion-addin.bat', 'the Fusion half would have no installer'],
    ['layouts/default.json', 'the plugin would paint nothing at all'],
    ['fusion-addin/FusionStreamDock.py', 'the add-in entry point would be missing'],
    ['plugin/index.html', 'the plugin would have no entry point'],
    ['manifest.json', 'the software would not recognise it as a plugin']
  ];
  const missing = required.filter(([file]) => !fs.existsSync(path.join(OUT, file)));
  if (missing.length) {
    console.error('Not packaging -- the bundle is incomplete:');
    missing.forEach(([file, why]) => console.error(`  ${file} is missing: ${why}`));
    process.exit(1);
  }

  console.log(`Packaged ${manifest.Name} ${manifest.Version} by ${manifest.Author}`);
  console.log(`  ${fileCount} files -> ${path.relative(ROOT, OUT)}`);
  console.log('');
  console.log('Next:');
  console.log('  1. Check dist/com.fusiondock.streamdock.sdPlugin/fusion-addin/ is present.');
  console.log('  2. Test install-fusion-addin.bat from a copy of dist/, not from src/.');
  console.log('  3. Zip the .sdPlugin folder if the upload form asks for an archive.');
  console.log('     See docs/planning/publishing.md -- the expected format is unconfirmed.');
}

main();
