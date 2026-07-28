/*
 * Check that our own menu icons have enough line weight to read on the device.
 *
 * Fusion draws its icons at 64px and the plugin renders them at ~62px, so its 2-4px strokes
 * arrive intact. Art drawn at 256px is scaled DOWN 4x, which can reduce a stroke to a single
 * pixel -- measured on a real N1, that was "almost non-existent".
 *
 * Line weight therefore has to be drawn in, not added afterwards. Dilating the raster was
 * tried and rejected on the device: it grows blobs rather than strokes and looks soft next to
 * Fusion's own icons. If this script fails, redraw the icon with heavier lines.
 *
 * Node stdlib only -- zlib does the PNG decode, so there is no image dependency.
 *
 * Usage:  node scripts/check-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const STATIC_DIR = path.join(
  __dirname, '..', 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin', 'static'
);

/* Icons built from line work, where thin strokes are a real risk. The two built from filled
 * shapes (create-solid, view) carry their own weight and are deliberately not listed. */
const LINE_ART = ['create-sketch', 'modify-sketch', 'constrain-sketch', 'modify-solid', 'more', 'back'];

const MIN_STROKE = 2;   // Fusion's own sketch icons measure 2-4px this way
const KEY_SIZE = 62;    // what the plugin draws into a 96px key

function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${path.basename(file)}: not a PNG`);
  }

  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const tag = buf.toString('ascii', offset + 4, offset + 8);
    if (tag === 'IHDR') { header = buf.subarray(offset + 8, offset + 8 + length); }
    else if (tag === 'IDAT') { idat.push(buf.subarray(offset + 8, offset + 8 + length)); }
    else if (tag === 'IEND') { break; }
    offset += 12 + length;
  }
  if (!header) { throw new Error(`${path.basename(file)}: no IHDR`); }

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colour = header[9];
  const interlace = header[12];
  // Everything here comes out of a canvas, which always emits 8-bit RGBA, non-interlaced.
  // Assert rather than silently misread anything else.
  if (depth !== 8 || colour !== 6 || interlace !== 0) {
    throw new Error(`${path.basename(file)}: expected 8-bit RGBA non-interlaced, `
      + `got depth=${depth} colour=${colour} interlace=${interlace}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. PNG spec section 9.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const dest = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? dest[i - 4] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= 4) ? prev[i - 4] : 0;
      let value = line[i];
      if (filter === 1) { value += a; }
      else if (filter === 2) { value += b; }
      else if (filter === 3) { value += (a + b) >> 1; }
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) {
        throw new Error(`unknown PNG filter ${filter}`);
      }
      dest[i] = value & 0xff;
    }
  }
  return { width, height, data: out };
}

/* Median run of opaque pixels along a row, sampled at the size the plugin actually draws.
 * Nearest-neighbour is deliberate: we want the stroke width, not a pretty thumbnail. */
function medianStroke(image, target) {
  const { width, data } = image;
  const runs = [];
  for (let y = 0; y < target; y += 1) {
    const sy = Math.floor(y * width / target);
    let run = 0;
    for (let x = 0; x < target; x += 1) {
      const sx = Math.floor(x * width / target);
      if (data[(sy * width + sx) * 4 + 3] > 110) { run += 1; }
      else { if (run > 0 && run < target * 0.5) { runs.push(run); } run = 0; }
    }
    if (run > 0 && run < target * 0.5) { runs.push(run); }
  }
  runs.sort((a, b) => a - b);
  return runs.length ? runs[Math.floor(runs.length / 2)] : 0;
}

let failed = false;
for (const name of LINE_ART) {
  const file = path.join(STATIC_DIR, name + '.png');
  if (!fs.existsSync(file)) {
    console.log(`  skip ${name} (not present)`);
    continue;
  }
  const stroke = medianStroke(readPng(file), KEY_SIZE);
  const ok = stroke >= MIN_STROKE;
  if (!ok) { failed = true; }
  console.log(`  ${ok ? 'OK  ' : 'THIN'} ${name}: ${stroke}px stroke at key size`);
}

if (failed) {
  console.error('\nToo thin to read on the device. Redraw with heavier line work -- do not '
    + 'dilate the raster, it grows blobs and looks soft.');
  process.exit(1);
}
