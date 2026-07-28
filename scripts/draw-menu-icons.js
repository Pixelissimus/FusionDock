/*
 * Draw the plugin's own menu icons -- the keys that open a page rather than run a command,
 * so Fusion has no artwork to lend.
 *
 * Why code and not an image generator. Two things were learned the hard way (see the backlog):
 * a generator will not produce real transparency, and it will not hit a stroke weight you ask
 * for -- the first set came back at 1px at key size and was "almost non-existent" on the
 * device. Both problems disappear when the stroke width and the palette are literals.
 *
 * The palette is MEASURED, not chosen. Fusion's ten constraint icons were decoded and their
 * pixels counted on 2026-07-28: 70.1% #F07878, 29.7% #D8D8D8 -- two colours, no blue at all.
 * The solid/sketch icons use sky blue #7FC9F2 with pale grey. Ours match whichever family the
 * key belongs to.
 *
 * Node stdlib only -- zlib writes the PNG, so no image dependency and no browser.
 *
 * Usage:  node scripts/draw-menu-icons.js [--out <dir>]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// Drawn at 256 and rendered into a 62px key: a 13px stroke arrives as ~3px, inside Fusion's
// own measured 2-4px. scripts/check-icons.js fails the build if that ever drifts under 2.
const STROKE = 13;
const BOLD = 16;
const THIN = 10;

const CONSTRAINT_RED = [0xF0, 0x78, 0x78];
const CONSTRAINT_GREY = [0xD8, 0xD8, 0xD8];
const SKY = [0x7F, 0xC9, 0xF2];
const LINE_GREY = [0xC8, 0xC8, 0xC8];

/* ------------------------------------------------------------------ raster */

function canvas() {
  return { data: new Float64Array(SIZE * SIZE * 4) };
}

/* Coverage-weighted "over" compositing. Alpha comes from a signed distance field, which is
 * what keeps a 13px stroke a clean 13px instead of an anti-aliased smear. */
function blend(c, x, y, colour, alpha) {
  if (alpha <= 0) { return; }
  const i = (y * SIZE + x) * 4;
  const a = Math.min(1, alpha);
  const dst = c.data[i + 3];
  const out = a + dst * (1 - a);
  if (out <= 0) { return; }
  for (let k = 0; k < 3; k += 1) {
    c.data[i + k] = (colour[k] * a + c.data[i + k] * dst * (1 - a)) / out;
  }
  c.data[i + 3] = out;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/* Round-capped stroke. Caps are round because Fusion's own line art is, and because a square
 * cap on a diagonal reads as a notch at 62px. */
function stroke(c, points, width, colour, close) {
  const half = width / 2;
  const segs = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    segs.push([points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]]);
  }
  if (close && points.length > 2) {
    const a = points[points.length - 1];
    const b = points[0];
    segs.push([a[0], a[1], b[0], b[1]]);
  }

  // Bounding box so a short segment does not cost a full-canvas scan.
  let minX = SIZE, minY = SIZE, maxX = 0, maxY = 0;
  for (const [x1, y1, x2, y2] of segs) {
    minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
  }
  const pad = Math.ceil(half) + 2;
  for (let y = Math.max(0, Math.floor(minY - pad)); y < Math.min(SIZE, Math.ceil(maxY + pad)); y += 1) {
    for (let x = Math.max(0, Math.floor(minX - pad)); x < Math.min(SIZE, Math.ceil(maxX + pad)); x += 1) {
      let d = Infinity;
      for (const s of segs) {
        d = Math.min(d, distToSegment(x + 0.5, y + 0.5, s[0], s[1], s[2], s[3]));
        if (d <= half - 1) { break; }
      }
      blend(c, x, y, colour, half + 0.5 - d);
    }
  }
}

function fillRect(c, x1, y1, x2, y2, colour) {
  for (let y = Math.max(0, Math.floor(y1)); y < Math.min(SIZE, Math.ceil(y2)); y += 1) {
    for (let x = Math.max(0, Math.floor(x1)); x < Math.min(SIZE, Math.ceil(x2)); x += 1) {
      const cover = Math.max(0, Math.min(x + 1, x2) - Math.max(x, x1))
        * Math.max(0, Math.min(y + 1, y2) - Math.max(y, y1));
      blend(c, x, y, colour, cover);
    }
  }
}

/* ------------------------------------------------------------------ PNG out */

function chunkOf(tag, data) {
  const payload = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(payload) >>> 0, 0);
  return Buffer.concat([length, payload, crc]);
}

function writePng(file, c) {
  const stride = SIZE * 4;
  const raw = Buffer.alloc(SIZE * (1 + stride));
  let o = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      raw[o] = Math.round(c.data[i]);
      raw[o + 1] = Math.round(c.data[i + 1]);
      raw[o + 2] = Math.round(c.data[i + 2]);
      raw[o + 3] = Math.round(c.data[i + 3] * 255);
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha -- what check-icons.js expects
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkOf('IHDR', ihdr),
    chunkOf('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunkOf('IEND', Buffer.alloc(0))
  ]));
}

/* ------------------------------------------------------------------ the icons */

/*
 * Tabs -- the fixed slot-13 key, the door to every workspace.
 *
 * A chooser grid: six cells, the first one active. The key opens the page listing every
 * workspace, so what it has to say is "pick a section" -- and it must not depict any one
 * section, which is the rule the Modify icons were rebuilt around.
 *
 * The ribbon metaphor was tried twice and rejected on the device both times. Three tabs on a
 * rule merged into a blob at 4x reduction; two chunky tabs read as two panels rather than
 * tabs. A grid has no such ambiguity at 62px and is the only icon in the set built from
 * repeated cells, so it is distinguishable from the isometric solids at a glance.
 *
 * Cells are FILLED, not outlined. A 13px stroke eats 6.5px either side of its path, so
 * outlined cells this small close up into solid blocks.
 */
function tabsIcon() {
  const c = canvas();
  const cells = [[16, 46], [98, 46], [180, 46], [16, 148], [98, 148], [180, 148]];
  cells.forEach(([x, y], i) => {
    fillRect(c, x, y, x + 60, y + 62, i === 0 ? SKY : LINE_GREY);
  });
  return c;
}

/*
 * More -- the fixed slot-15 key, page 2 of wherever you are.
 *
 * A double chevron. Deliberately not three dots: dots mean "a menu of options" everywhere
 * else on this device, and this is movement, not a menu. Drawn a stroke heavier than the
 * rest because it carries no other detail to read.
 */
function moreIcon() {
  const c = canvas();
  stroke(c, [[70, 56], [142, 128], [70, 200]], BOLD, SKY);
  stroke(c, [[142, 56], [214, 128], [142, 200]], BOLD, SKY);
  return c;
}

/*
 * Constrain -- opens the sketch constraint page.
 *
 * Redrawn on 2026-07-28 in Fusion's own constraint palette, measured from its ten constraint
 * icons: coral #F07878 for the constraint marks, pale grey #D8D8D8 for the geometry they act
 * on. The previous version was sky blue, which is the colour Fusion uses for sketch handles
 * and solid faces -- so it read as "sketch" or "solid", not "constraint".
 *
 * Two marks, not one: perpendicular and parallel together say "the constraints", where either
 * alone would name a command that lives inside the page this key opens.
 */
function constrainIcon() {
  const c = canvas();
  stroke(c, [[26, 190], [230, 190]], THIN, CONSTRAINT_GREY);
  stroke(c, [[26, 226], [230, 226]], THIN, CONSTRAINT_GREY);
  // perpendicular
  stroke(c, [[76, 38], [76, 148]], STROKE, CONSTRAINT_RED);
  stroke(c, [[28, 148], [124, 148]], STROKE, CONSTRAINT_RED);
  // parallel
  stroke(c, [[150, 148], [184, 42]], STROKE, CONSTRAINT_RED);
  stroke(c, [[196, 148], [230, 42]], STROKE, CONSTRAINT_RED);
  return c;
}

/*
 * Back -- leaves a folder page.
 *
 * The mirror of More, and deliberately so: they are the same gesture in opposite directions,
 * and a folder page shows one where a context page shows the other, in the same corner.
 */
function backIcon() {
  const c = canvas();
  stroke(c, [[186, 56], [114, 128], [186, 200]], BOLD, SKY);
  stroke(c, [[114, 56], [42, 128], [114, 200]], BOLD, SKY);
  return c;
}

const ICONS = {
  tabs: tabsIcon,
  more: moreIcon,
  back: backIcon,
  'constrain-sketch': constrainIcon
};

function main() {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex !== -1 && argv[outIndex + 1]
    ? argv[outIndex + 1]
    : path.join(__dirname, '..', 'src', 'streamdock-plugin',
      'com.fusiondock.streamdock.sdPlugin', 'static');

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, draw] of Object.entries(ICONS)) {
    const file = path.join(outDir, name + '.png');
    writePng(file, draw());
    console.log(`  wrote ${path.relative(process.cwd(), file)}`);
  }
  console.log('\nNow run: node scripts/check-icons.js');
}

if (require.main === module) {
  main();
} else {
  // Exported so alternative designs can be trialled without duplicating the raster code.
  module.exports = { canvas, stroke, fillRect, writePng, SIZE, STROKE, BOLD, THIN,
    CONSTRAINT_RED, CONSTRAINT_GREY, SKY, LINE_GREY };
}
