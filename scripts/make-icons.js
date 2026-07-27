/*
 * Generate the plugin's static PNG assets.
 *
 * Node stdlib only. These are the plugin's OWN branding -- the icon the Stream Dock
 * software shows in its action list. Fusion's command icons are a different thing
 * entirely: they are read from the user's local install at runtime and never bundled.
 *
 * Usage:  node scripts/make-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUTPUT_DIR = path.join(
  __dirname, '..', 'src', 'streamdock-plugin',
  'com.fusiondock.streamdock.sdPlugin', 'static'
);

const ACCENT = [255, 141, 43];      // Fusion's brand orange
const BACKGROUND = [28, 28, 30];    // near-black, matching the key background

function chunk(tag, data) {
  const payload = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(payload) >>> 0, 0);
  return Buffer.concat([length, payload, crc]);
}

function writePng(filePath, size, pixelFn) {
  // One filter byte (0 = None) per scanline, then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixelFn(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 2;   // colour type: truecolour RGB
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlace

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(filePath, png);
  return png.length;
}

/* An isometric cube outline: readable at 40px, still clean at 128px. */
function cubeIcon(size) {
  const centre = size / 2;
  const radius = size * 0.34;
  const thickness = Math.max(1.5, size * 0.055);

  const COS30 = 0.866;
  const TAN30 = 0.5774;

  return function pixel(x, y) {
    const dx = x - centre + 0.5;
    const dy = y - centre + 0.5;

    // Pointy-top hexagon: vertices at top, bottom and the four 30-degree diagonals.
    // The near corner of the cube projects to the centre, and its three edges run to
    // alternating vertices -- bottom, upper-left, upper-right.
    const hexDistance = Math.max(
      Math.abs(dx) * 1.1547,
      Math.abs(dy) * COS30 + Math.abs(dx) * 0.5
    );
    if (hexDistance > radius + thickness) {
      return BACKGROUND;
    }

    let onEdge = Math.abs(hexDistance - radius) < thickness * 0.6;
    // Spine from the centre straight down to the bottom vertex.
    if (Math.abs(dx) < thickness * 0.5 && dy >= 0 && dy <= radius) {
      onEdge = true;
    }
    // Upper-left edge: dy = +TAN30 * dx for dx <= 0 (screen y grows downward).
    if (Math.abs(dy - dx * TAN30) < thickness * 0.5 && dx >= -radius * COS30 && dx <= 0) {
      onEdge = true;
    }
    // Upper-right edge: dy = -TAN30 * dx for dx >= 0.
    if (Math.abs(dy + dx * TAN30) < thickness * 0.5 && dx >= 0 && dx <= radius * COS30) {
      onEdge = true;
    }
    return onEdge ? ACCENT : BACKGROUND;
  };
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  // Sizes the SDK asks for: plugin icon 128, category icon 48, action-list icon 40.
  // default.png (96) is the placeholder shown before the plugin paints a real key.
  const targets = [
    ['plugin.png', 128],
    ['category.png', 48],
    ['action.png', 40],
    ['default.png', 96]
  ];
  targets.forEach(([name, size]) => {
    const filePath = path.join(OUTPUT_DIR, name);
    const bytes = writePng(filePath, size, cubeIcon(size));
    console.log(`wrote ${name} (${size}x${size}, ${bytes} bytes)`);
  });
}

main();
