/*
 * Thicken the line work in our own menu icons so they survive being scaled down to key size.
 *
 * Why this exists: Fusion's icons are drawn at 64px and the plugin renders them at ~62px, so
 * their 2-5px strokes arrive intact. Ours are 256px, scaled DOWN 4x, which reduced every
 * stroke to a single pixel -- measured on the real device they were "almost non-existent".
 *
 * Rather than redraw approved artwork, this dilates the alpha channel: each pass grows opaque
 * regions by one pixel, carrying the colour of the strongest neighbour outward. Run enough
 * passes and a hairline becomes a stroke, with the composition untouched.
 *
 * Node stdlib only -- zlib does the PNG decode and encode, so there is no image dependency and
 * no browser in the loop.
 *
 * Usage:  node scripts/thicken-icons.js [--check]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const STATIC_DIR = path.join(
  __dirname, '..', 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin', 'static'
);

/*
 * Dilation passes per icon, tuned against Fusion's own icons measured at render size:
 * a median stroke of 2-5px. The two icons built from filled shapes rather than line work
 * already carry that weight, so they are deliberately absent.
 */
const PLAN = {
  'create-sketch': 4,
  'modify-sketch': 4,
  'constrain-sketch': 4,
  'modify-solid': 3
};

/* ------------------------------------------------------------------ PNG decode */

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
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (tag === 'IHDR') { header = data; }
    else if (tag === 'IDAT') { idat.push(data); }
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
  // Assert rather than silently mangle anything else.
  if (depth !== 8 || colour !== 6 || interlace !== 0) {
    throw new Error(`${path.basename(file)}: expected 8-bit RGBA non-interlaced, `
      + `got depth=${depth} colour=${colour} interlace=${interlace}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. See PNG spec section 9.
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

/* ------------------------------------------------------------------ PNG encode */

function chunk(tag, data) {
  const payload = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(payload) >>> 0, 0);
  return Buffer.concat([length, payload, crc]);
}

function writePng(file, image) {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;                      // filter: None
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // bit depth
  header[9] = 6;   // colour type: RGBA
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]));
}

/* ------------------------------------------------------------------ the work */

/*
 * Flatten the alpha channel to fully on or fully off before dilating.
 *
 * The art arrives anti-aliased, so every stroke has a fringe of partly-transparent, partly
 * darkened pixels. Dilating that directly drags the fringe outward and compounds it -- the
 * first attempt turned a clean circle into hatching. Snapping alpha to binary first, and
 * pulling each edge pixel's colour from a definitely-solid neighbour, keeps strokes flat.
 */
const ALPHA_FLOOR = 24;   // faint anti-aliased strokes are real line work, not noise
function flatten(image) {
  const { width, height, data } = image;
  const src = Buffer.from(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (src[i + 3] <= ALPHA_FLOOR) { data[i + 3] = 0; continue; }
      data[i + 3] = 255;
      if (src[i + 3] >= 250) { continue; }
      // Semi-transparent edge pixel: adopt the colour of the most opaque neighbour rather
      // than keeping its own, which has been blended toward the background.
      let best = [src[i], src[i + 1], src[i + 2], src[i + 3]];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
          const j = (ny * width + nx) * 4;
          if (src[j + 3] > best[3]) { best = [src[j], src[j + 1], src[j + 2], src[j + 3]]; }
        }
      }
      data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2];
    }
  }
  return image;
}

/* One pass grows every opaque region by a pixel, taking the colour of its strongest neighbour
 * so the stroke keeps its own colour rather than smearing toward the background. */
function dilateOnce(image) {
  const { width, height, data } = image;
  const src = Buffer.from(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (src[i + 3] > 200) { continue; }
      let best = [0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
          const j = (ny * width + nx) * 4;
          if (src[j + 3] > best[3]) { best = [src[j], src[j + 1], src[j + 2], src[j + 3]]; }
        }
      }
      if (best[3] > src[i + 3]) {
        data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2]; data[i + 3] = best[3];
      }
    }
  }
  return image;
}

/* Median run of opaque pixels along a row, sampled at the size the plugin actually draws.
 * Nearest-neighbour is fine here: we want the stroke width, not a pretty thumbnail. */
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

const checkOnly = process.argv.includes('--check');
let failed = false;

for (const [name, passes] of Object.entries(PLAN)) {
  const file = path.join(STATIC_DIR, name + '.png');
  if (!fs.existsSync(file)) { console.log(`  skip ${name} (not present)`); continue; }

  const image = readPng(file);
  const before = medianStroke(image, 62);
  if (checkOnly) {
    // Fusion's own sketch icons sit at 2-5px measured this way.
    const ok = before >= 2;
    if (!ok) { failed = true; }
    console.log(`  ${ok ? 'OK  ' : 'THIN'} ${name}: ${before}px stroke at key size`);
    continue;
  }

  flatten(image);
  for (let i = 0; i < passes; i += 1) { dilateOnce(image); }
  writePng(file, image);
  console.log(`  ${name}: ${before}px -> ${medianStroke(image, 62)}px `
    + `at key size (${passes} passes)`);
}

if (checkOnly && failed) {
  console.error('\nSome icons are too thin to read on the device. Run without --check.');
  process.exit(1);
}
