// generate-icons.mjs
// ---------------------------------------------------------------------------
// Draws the Reading Block icon (a cream bookmark on a library-green rounded
// square) at the four sizes Chrome wants, with no external libraries.
//
// How it works: we render ONE big 768px master image with simple shapes, then
// shrink it down to each target size by averaging blocks of pixels. Shrinking a
// big crisp image is what gives us smooth, anti-aliased edges for free.
//
// Run it with:  node scripts/generate-icons.mjs
// ---------------------------------------------------------------------------

import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "icons");

// --- Colours (RGBA) ---------------------------------------------------------
const GREEN = [28, 107, 84, 255]; // #1c6b54 background
const CREAM = [246, 239, 225, 255]; // #f6efe1 bookmark
const CLEAR = [0, 0, 0, 0]; // transparent (outside the rounded square)

const MASTER = 768; // big canvas; divisible by 16/32/48/128
const SIZES = [16, 32, 48, 128];

// --- Geometry helpers -------------------------------------------------------

// Is point (x,y) inside a full-bleed rounded square of side `size`, radius `r`?
function inRoundedSquare(x, y, size, r) {
  const minX = r,
    maxX = size - r,
    minY = r,
    maxY = size - r;
  // The straight middle bands.
  if (x >= minX && x <= maxX) return y >= 0 && y <= size;
  if (y >= minY && y <= maxY) return x >= 0 && x <= size;
  // The four corners: must be within `r` of the corner's centre.
  const cx = x < minX ? minX : maxX;
  const cy = y < minY ? minY : maxY;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Ray-casting point-in-polygon test.
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// The bookmark outline, in master pixels.
function bookmarkPoints(size) {
  const s = (f) => f * size;
  const left = s(0.35),
    right = s(0.65),
    top = s(0.26),
    bottom = s(0.72),
    notch = s(0.61),
    mid = s(0.5);
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [mid, notch],
    [left, bottom],
  ];
}

// --- Render the master image ------------------------------------------------

function renderMaster() {
  const buf = new Uint8ClampedArray(MASTER * MASTER * 4);
  const r = MASTER * 0.22; // corner radius
  const book = bookmarkPoints(MASTER);

  for (let y = 0; y < MASTER; y++) {
    for (let x = 0; x < MASTER; x++) {
      let color = CLEAR;
      if (inRoundedSquare(x + 0.5, y + 0.5, MASTER, r)) {
        color = inPolygon(x + 0.5, y + 0.5, book) ? CREAM : GREEN;
      }
      const o = (y * MASTER + x) * 4;
      buf[o] = color[0];
      buf[o + 1] = color[1];
      buf[o + 2] = color[2];
      buf[o + 3] = color[3];
    }
  }
  return buf;
}

// Shrink the master down to `size` by averaging each block of source pixels.
// We average in "premultiplied" form so transparent edges don't darken.
function downsample(master, size) {
  const f = MASTER / size;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx;
          const sy = y * f + dy;
          const o = (sy * MASTER + sx) * 4;
          const alpha = master[o + 3] / 255;
          r += (master[o] * alpha);
          g += (master[o + 1] * alpha);
          b += (master[o + 2] * alpha);
          a += master[o + 3];
        }
      }
      const n = f * f;
      const avgA = a / n; // 0..255
      const o = (y * size + x) * 4;
      if (avgA === 0) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      } else {
        const alpha = avgA / 255;
        out[o] = r / n / alpha;
        out[o + 1] = g / n / alpha;
        out[o + 2] = b / n / alpha;
        out[o + 3] = avgA;
      }
    }
  }
  return out;
}

// --- Minimal PNG encoder ----------------------------------------------------

// CRC32 table + function, needed for PNG chunk checksums.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, size) {
  // Build the raw image data: each row starts with a filter byte (0 = none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Go ---------------------------------------------------------------------

mkdirSync(ICONS_DIR, { recursive: true });
const master = renderMaster();
for (const size of SIZES) {
  const small = downsample(master, size);
  const png = encodePNG(small, size);
  const path = join(ICONS_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}
console.log("Done.");
