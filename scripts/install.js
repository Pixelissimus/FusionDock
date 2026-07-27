/*
 * Install the add-in into Fusion and the plugin into the Stream Dock software.
 *
 *   node scripts/install.js --dry-run     show what would happen, change nothing
 *   node scripts/install.js               install (refuses to clobber an existing copy)
 *   node scripts/install.js --force       overwrite an existing installation
 *
 * Paths (both confirmed from vendor documentation):
 *   Fusion add-ins  %APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\<Name>\
 *   Stream Dock     %APPDATA%\HotSpot\StreamDock\plugins\<uuid>.sdPlugin\
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ADDIN_NAME = 'FusionStreamDock';
const PLUGIN_FOLDER = 'com.fusiondock.streamdock.sdPlugin';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

const TARGETS = [
  {
    what: 'Fusion 360 add-in',
    from: path.join(ROOT, 'src', 'fusion-addin'),
    to: path.join(appData, 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns', ADDIN_NAME),
    // config.json holds the user's chosen port; never stomp it on reinstall.
    preserve: ['config.json', 'command_overrides.json']
  },
  {
    what: 'Stream Dock plugin',
    from: path.join(ROOT, 'src', 'streamdock-plugin', PLUGIN_FOLDER),
    to: path.join(appData, 'HotSpot', 'StreamDock', 'plugins', PLUGIN_FOLDER),
    preserve: []
  }
];

function copyTree(from, to, preserve, prefix = '') {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      copyTree(source, destination, preserve, relative);
      continue;
    }
    if (preserve.includes(relative) && fs.existsSync(destination)) {
      console.log(`    kept   ${relative}  (existing settings preserved)`);
      continue;
    }
    fs.copyFileSync(source, destination);
    console.log(`    copied ${relative}`);
  }
}

function main() {
  console.log(DRY_RUN ? 'DRY RUN -- nothing will be written\n' : 'Installing\n');

  let blocked = false;
  for (const target of TARGETS) {
    console.log(`${target.what}`);
    console.log(`  from ${target.from}`);
    console.log(`  to   ${target.to}`);

    if (!fs.existsSync(target.from)) {
      console.log('  ERROR: source folder missing\n');
      blocked = true;
      continue;
    }
    const exists = fs.existsSync(target.to);
    if (exists && !FORCE && !DRY_RUN) {
      console.log('  ALREADY INSTALLED -- re-run with --force to overwrite\n');
      blocked = true;
      continue;
    }
    // The Stream Dock host only reads the plugin's parent folder, so the layout has to
    // live inside the .sdPlugin bundle. Staging it here keeps one source of truth in src/.
    if (!DRY_RUN) {
      copyTree(target.from, target.to, target.preserve);
      if (target.what.startsWith('Stream Dock')) {
        const layoutsDir = path.join(target.to, 'layouts');
        fs.mkdirSync(layoutsDir, { recursive: true });
        fs.copyFileSync(
          path.join(ROOT, 'src', 'layouts', 'default.json'),
          path.join(layoutsDir, 'default.json')
        );
        console.log('    copied layouts/default.json');
      }
    }
    console.log('');
  }

  if (DRY_RUN) {
    console.log('Nothing was written. Re-run without --dry-run to install.');
    return;
  }
  if (blocked) {
    console.log('One or more targets were skipped. Nothing else to do.');
    process.exitCode = 1;
    return;
  }

  console.log('Done. Now:');
  console.log('  1. Restart the Stream Dock / VSD Craft software (fully quit it first).');
  console.log('  2. Start Fusion 360. The add-in auto-starts (runOnStartup is true).');
  console.log('     Check it under Utilities > Scripts and Add-Ins > Add-Ins.');
  console.log('  3. Drag the "Fusion Key" action onto all 15 keys, both side buttons');
  console.log('     and the dial.');
  console.log('  4. Verify the link: node scripts/resolve-commands.js');
}

main();
