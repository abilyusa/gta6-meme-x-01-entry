// gta6-meme-x-01 entry: "My agent got tired of waiting — so it built its own GTA 6."
// Node 22, standard library only, no network, no wall clock, no randomness.
// The program draws the meme picture (a neon Vice City street at night: the
// make.fun ghost driving a sports car under a retro sun, "SOLMAR" and
// "MAKE.FUN" neon signs, a WANTED five-star badge) into meme.png, and copies
// POST.json to the output dir, where the gate reads it. Every byte it writes
// is a pure function of the files in this repository, so two runs produce
// identical output.
//
// Run it the way the grader does:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
// It writes out/meme.png and out/POST.json and prints nothing on success.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const W = 1080;
const H = 1080;

// ---------------------------------------------------------------- CRC32 ----
// Standard CRC-32 (IEEE 802.3, polynomial 0xEDB88320), for PNG chunks.
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

// ------------------------------------------------------------ PNG decode --
// Decodes an 8-bit RGBA (colour type 6) non-interlaced PNG into raw pixels.
// Only what mark-1024.png needs: no palette, no greyscale, no interlace.
function decodePng(buf: Buffer): { width: number; height: number; data: Buffer } {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('not a PNG');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || colorType !== 6 || data[12] !== 0) {
        throw new Error(`unsupported PNG: bitDepth ${bitDepth} colorType ${colorType} interlace ${data[12]}`);
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(width * height * 4);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = raw.subarray(src, src + stride);
    src += stride;
    const dst = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? dst[i - 4] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= 4 ? prev[i - 4] : 0;
      const v = row[i];
      if (filter === 0) dst[i] = v;
      else if (filter === 1) dst[i] = (v + a) & 0xff;
      else if (filter === 2) dst[i] = (v + b) & 0xff;
      else if (filter === 3) dst[i] = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        dst[i] = (v + pr) & 0xff;
      } else throw new Error(`unknown PNG filter ${filter}`);
    }
  }
  return { width, height, data: out };
}

// ------------------------------------------------------------ PNG encode --
// Encodes RGBA pixels as an 8-bit colour-type-6 PNG (filter 0 on every row).
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ image --
// Bilinear resample of an RGBA image (premultiplied alpha), to a new size.
function resample(
  src: { width: number; height: number; data: Buffer },
  tw: number,
  th: number,
): { width: number; height: number; data: Buffer } {
  const out = Buffer.alloc(tw * th * 4);
  for (let oy = 0; oy < th; oy++) {
    const sy = (oy + 0.5) * (src.height / th) - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let ox = 0; ox < tw; ox++) {
      const sx = (ox + 0.5) * (src.width / tw) - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const o = (oy * tw + ox) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c];
        const p10 = src.data[(y0 * src.width + x1) * 4 + c];
        const p01 = src.data[(y1 * src.width + x0) * 4 + c];
        const p11 = src.data[(y1 * src.width + x1) * 4 + c];
        const v = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
        out[o + c] = Math.round(v);
      }
    }
  }
  return { width: tw, height: th, data: out };
}

// ----------------------------------------------------------------- canvas --
type RGB = [number, number, number];
const canvas = new Uint8Array(W * H * 4);

function put(x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const o = (y * W + x) * 4;
  if (a >= 255) {
    canvas[o] = r;
    canvas[o + 1] = g;
    canvas[o + 2] = b;
    canvas[o + 3] = 255;
  } else if (a > 0) {
    const ia = 255 - a;
    canvas[o] = (r * a + canvas[o] * ia) >> 8;
    canvas[o + 1] = (g * a + canvas[o + 1] * ia) >> 8;
    canvas[o + 2] = (b * a + canvas[o + 2] * ia) >> 8;
    canvas[o + 3] = 255;
  }
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) put(x, y, c[0], c[1], c[2], a);
}

// Linear interpolation between two colours.
function lerp(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

// Multi-stop vertical gradient: stops are [yFraction, colour].
function vgrad(y: number, stops: [number, RGB][]): RGB {
  const t = y / H;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return lerp(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 255): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) put(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Scanline polygon fill (even-odd), for the car body, glass and stars.
function fillPolygon(pts: [number, number][], c: RGB, a = 255): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) put(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Five-point star polygon, centred, outer radius r, inner radius r*0.45.
function starPoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return pts;
}

// ------------------------------------------------------------------- font --
// Classic 5x7 bitmap font. One entry per printable character from ' ' (0x20)
// to 'Z' (0x5A): five column bytes, bit 0 is the top row of the glyph.
const FONT: number[][] = [
  [0x00, 0x00, 0x00, 0x00, 0x00], // space
  [0x00, 0x00, 0x5f, 0x00, 0x00], // !
  [0x00, 0x07, 0x00, 0x07, 0x00], // "
  [0x14, 0x7f, 0x14, 0x7f, 0x14], // #
  [0x24, 0x2a, 0x7f, 0x2a, 0x12], // $
  [0x23, 0x13, 0x08, 0x64, 0x62], // %
  [0x36, 0x49, 0x55, 0x22, 0x50], // &
  [0x00, 0x05, 0x03, 0x00, 0x00], // '
  [0x00, 0x1c, 0x22, 0x41, 0x00], // (
  [0x00, 0x41, 0x22, 0x1c, 0x00], // )
  [0x14, 0x08, 0x3e, 0x08, 0x14], // *
  [0x08, 0x08, 0x3e, 0x08, 0x08], // +
  [0x00, 0x50, 0x30, 0x00, 0x00], // ,
  [0x08, 0x08, 0x08, 0x08, 0x08], // -
  [0x00, 0x60, 0x60, 0x00, 0x00], // .
  [0x20, 0x10, 0x08, 0x04, 0x02], // /
  [0x3e, 0x51, 0x49, 0x45, 0x3e], // 0
  [0x00, 0x42, 0x7f, 0x40, 0x00], // 1
  [0x42, 0x61, 0x51, 0x49, 0x46], // 2
  [0x21, 0x41, 0x45, 0x4b, 0x31], // 3
  [0x18, 0x14, 0x12, 0x7f, 0x10], // 4
  [0x27, 0x45, 0x45, 0x45, 0x39], // 5
  [0x3c, 0x4a, 0x49, 0x49, 0x30], // 6
  [0x01, 0x71, 0x09, 0x05, 0x03], // 7
  [0x36, 0x49, 0x49, 0x49, 0x36], // 8
  [0x06, 0x49, 0x49, 0x29, 0x1e], // 9
  [0x00, 0x36, 0x36, 0x00, 0x00], // :
  [0x00, 0x56, 0x36, 0x00, 0x00], // ;
  [0x08, 0x14, 0x22, 0x41, 0x00], // <
  [0x14, 0x14, 0x14, 0x14, 0x14], // =
  [0x00, 0x41, 0x22, 0x14, 0x08], // >
  [0x02, 0x01, 0x51, 0x09, 0x06], // ?
  [0x32, 0x49, 0x79, 0x41, 0x3e], // @
  [0x7e, 0x11, 0x11, 0x11, 0x7e], // A
  [0x7f, 0x49, 0x49, 0x49, 0x36], // B
  [0x3e, 0x41, 0x41, 0x41, 0x22], // C
  [0x7f, 0x41, 0x41, 0x22, 0x1c], // D
  [0x7f, 0x49, 0x49, 0x49, 0x41], // E
  [0x7f, 0x09, 0x09, 0x09, 0x01], // F
  [0x3e, 0x41, 0x49, 0x49, 0x7a], // G
  [0x7f, 0x08, 0x08, 0x08, 0x7f], // H
  [0x00, 0x41, 0x7f, 0x41, 0x00], // I
  [0x20, 0x40, 0x41, 0x3f, 0x01], // J
  [0x7f, 0x08, 0x14, 0x22, 0x41], // K
  [0x7f, 0x40, 0x40, 0x40, 0x40], // L
  [0x7f, 0x02, 0x0c, 0x02, 0x7f], // M
  [0x7f, 0x04, 0x08, 0x10, 0x7f], // N
  [0x3e, 0x41, 0x41, 0x41, 0x3e], // O
  [0x7f, 0x09, 0x09, 0x09, 0x06], // P
  [0x3e, 0x41, 0x51, 0x21, 0x5e], // Q
  [0x7f, 0x09, 0x19, 0x29, 0x46], // R
  [0x46, 0x49, 0x49, 0x49, 0x31], // S
  [0x01, 0x01, 0x7f, 0x01, 0x01], // T
  [0x3f, 0x40, 0x40, 0x40, 0x3f], // U
  [0x1f, 0x20, 0x40, 0x20, 0x1f], // V
  [0x3f, 0x40, 0x38, 0x40, 0x3f], // W
  [0x63, 0x14, 0x08, 0x14, 0x63], // X
  [0x07, 0x08, 0x70, 0x08, 0x07], // Y
  [0x61, 0x51, 0x49, 0x45, 0x43], // Z
];

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawTextRaw(text: string, x: number, y: number, scale: number, c: RGB, a = 255): void {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 0x20;
    if (code < 0 || code >= FONT.length) continue;
    const glyph = FONT[code];
    const gx = x + i * 6 * scale;
    for (let col = 0; col < 5; col++) {
      const bits = glyph[col];
      for (let row = 0; row < 7; row++) {
        if (bits & (1 << row)) {
          fillRect(gx + col * scale, y + row * scale, gx + col * scale + scale - 1, y + row * scale + scale - 1, c, a);
        }
      }
    }
  }
}

// Draws text with a solid outline (8 offset passes in black, then the fill).
function drawText(text: string, x: number, y: number, scale: number, c: RGB, outline = 3): void {
  const black: RGB = [0, 0, 0];
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) {
    drawTextRaw(text, x + dx * outline, y + dy * outline, scale, black);
  }
  drawTextRaw(text, x, y, scale, c);
}

function drawTextCentered(text: string, cx: number, y: number, scale: number, c: RGB, outline = 3): void {
  drawText(text, Math.round(cx - textWidth(text, scale) / 2), y, scale, c, outline);
}

// Plain text with no outline (neon signs).
function drawTextPlain(text: string, x: number, y: number, scale: number, c: RGB, a = 255): void {
  drawTextRaw(text, x, y, scale, c, a);
}

// Thick line as a chain of discs (palm trunks, fronds).
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 255): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, w / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, a);
  }
}

// ------------------------------------------------------------------- scene --
// A neon Vice City street at night: sunset sky, retro sun, skyline, street,
// palm silhouettes, the make.fun ghost driving a sports car, a WANTED badge,
// and the headline. All positions are fixed; nothing here reads the clock,
// the network or randomness, so the picture is identical on every run.

const SKY_STOPS: [number, RGB][] = [
  [0, [22, 10, 46]],
  [0.26, [61, 15, 77]],
  [0.52, [138, 26, 107]],
  [0.74, [255, 46, 136]],
];

function drawSky(): void {
  for (let y = 0; y < 800; y++) {
    const c = vgrad(y, SKY_STOPS);
    fillRect(0, y, W - 1, y, c);
  }
  fillRect(0, 800, W - 1, H - 1, [13, 10, 24]);
}

function drawStars(): void {
  for (let i = 0; i < 60; i++) {
    const x = (i * 173 + 61) % W;
    const y = (i * 97 + 23) % 260;
    const a = 110 + ((i * 37) % 110);
    const r = i % 5 === 0 ? 2 : 1;
    fillCircle(x, y, r, [255, 255, 255], a);
  }
}

// Retro sun with horizontal slits that widen toward its base.
const SUN_CX = 540;
const SUN_CY = 420;
const SUN_R = 185;
const SUN_SLITS: [number, number][] = [
  [15, 22],
  [45, 56],
  [80, 95],
  [120, 140],
  [160, 185],
];

function drawSun(): void {
  for (let y = SUN_CY - SUN_R; y <= SUN_CY + SUN_R; y++) {
    const dy = y - SUN_CY;
    if (dy > 0 && SUN_SLITS.some(([a, b]) => dy >= a && dy <= b)) continue;
    for (let x = SUN_CX - SUN_R; x <= SUN_CX + SUN_R; x++) {
      const dx = x - SUN_CX;
      if (dx * dx + dy * dy > SUN_R * SUN_R) continue;
      const t = (y - (SUN_CY - SUN_R)) / (2 * SUN_R);
      const c = t < 0.5 ? lerp([255, 226, 89], [255, 167, 81], t * 2) : lerp([255, 167, 81], [255, 46, 136], (t - 0.5) * 2);
      put(x, y, c[0], c[1], c[2]);
    }
  }
}

// Buildings: [x0, x1, topY]. Base is the street at y 800.
const BUILDINGS: [number, number, number][] = [
  [0, 80, 640],
  [80, 260, 580],
  [260, 380, 660],
  [380, 520, 610],
  [520, 640, 680],
  [640, 780, 590],
  [780, 900, 650],
  [900, 1080, 620],
];

function drawSkyline(): void {
  const wall: RGB = [20, 10, 36];
  for (const [x0, x1, top] of BUILDINGS) {
    fillRect(x0, top, x1 - 1, 799, wall);
    // Lit windows: a deterministic on/off pattern, never random.
    for (let wy = top + 14; wy < 790; wy += 16) {
      for (let wx = x0 + 8; wx < x1 - 8; wx += 14) {
        const h = (wx * 7 + wy * 11 + x0) % 4;
        if (h === 0) fillRect(wx, wy, wx + 5, wy + 7, [255, 209, 102]);
        else if ((wx * 5 + wy * 3 + x0) % 9 === 0) fillRect(wx, wy, wx + 5, wy + 7, [126, 249, 255]);
      }
    }
  }
}

// A neon sign: a soft glow pass, then the bright letters.
function drawNeonSign(text: string, x: number, y: number, scale: number, c: RGB): void {
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
    drawTextRaw(text, x + dx, y + dy, scale, c, 70);
  }
  drawTextRaw(text, x, y, scale, c);
}

function drawStreet(): void {
  for (let y = 800; y < H; y++) {
    const c = lerp([13, 10, 24], [5, 3, 8], (y - 800) / (H - 800));
    fillRect(0, y, W - 1, y, c);
  }
  // Neon reflections lying on the asphalt.
  fillRect(0, 802, W - 1, 812, [255, 46, 136], 55);
  fillRect(0, 902, W - 1, 916, [255, 46, 136], 38);
  fillRect(0, 968, W - 1, 978, [0, 229, 255], 30);
}

function drawPalm(baseX: number, topX: number, mirror: number): void {
  const dark: RGB = [10, 6, 20];
  const topY = 560;
  // Trunk: a gentle curve from the street up to the crown.
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = baseX + (topX - baseX) * t + Math.sin(t * Math.PI) * 12 * mirror;
    const y = 800 - (800 - topY) * t;
    fillCircle(x, y, 7 - t * 2, dark);
  }
  // Fronds arc out of the crown and droop at the tips: two segments each,
  // the midpoint lifted so the frond bows upward before falling.
  const crownX = topX + Math.sin(Math.PI) * 12 * mirror;
  const crownY = topY;
  const fronds: [number, number][] = [
    [crownX - 72 * mirror, crownY - 18],
    [crownX - 48 * mirror, crownY - 48],
    [crownX, crownY - 58],
    [crownX + 48 * mirror, crownY - 48],
    [crownX + 72 * mirror, crownY - 18],
    [crownX - 80 * mirror, crownY + 16],
    [crownX + 80 * mirror, crownY + 16],
  ];
  for (const [fx, fy] of fronds) {
    const mx = (crownX + fx) / 2;
    const my = (crownY + fy) / 2 - 16;
    thickLine(crownX, crownY, mx, my, 5, dark);
    thickLine(mx, my, fx, fy, 4, dark);
  }
  fillCircle(crownX, crownY, 9, dark);
}

// The make.fun ghost (press kit mark), resampled and pasted over the scene.
function drawGhost(ghost: { width: number; height: number; data: Buffer }): void {
  const small = resample(ghost, 360, 360);
  const ox = 360;
  const oy = 510;
  for (let y = 0; y < 360; y++) {
    for (let x = 0; x < 360; x++) {
      const s = (y * 360 + x) * 4;
      const a = small.data[s + 3];
      if (a === 0) continue;
      put(ox + x, oy + y, small.data[s], small.data[s + 1], small.data[s + 2], a);
    }
  }
}

function drawCar(): void {
  const body: RGB = [40, 25, 66];
  const bodyPts: [number, number][] = [
    [170, 858], [185, 838], [240, 828], [330, 822], [400, 800], [500, 794],
    [590, 798], [680, 812], [780, 822], [860, 830], [905, 842], [910, 858], [895, 868], [180, 868],
  ];
  fillPolygon(bodyPts, body);
  // Roof-line highlight.
  thickLine(400, 800, 590, 798, 3, [80, 55, 110]);
  // Glasshouse.
  fillPolygon([[415, 802], [495, 797], [575, 801], [540, 820], [440, 820]], [16, 80, 95]);
  fillPolygon([[450, 802], [480, 800], [460, 818], [440, 818]], [140, 225, 245], 170);
  // Wheels.
  for (const wx of [300, 780]) {
    fillCircle(wx, 858, 27, [5, 3, 8]);
    fillCircle(wx, 858, 12, [70, 70, 90]);
    fillCircle(wx, 858, 4, [150, 150, 170]);
  }
  // Neon underglow.
  fillRect(180, 884, 900, 892, [255, 46, 136], 70);
  fillRect(200, 888, 880, 890, [255, 46, 136], 130);
  // Headlight beam and taillight.
  fillPolygon([[905, 845], [950, 838], [950, 855], [905, 852]], [255, 240, 180], 60);
  fillCircle(902, 848, 5, [255, 240, 180]);
  fillRect(172, 842, 178, 850, [255, 60, 60]);
}

function drawWanted(): void {
  const x0 = 845;
  const y0 = 270;
  const x1 = 1040;
  const y1 = 380;
  fillRect(x0, y0, x1, y1, [16, 16, 26], 225);
  const gold: RGB = [255, 215, 0];
  fillRect(x0, y0, x1, y0 + 3, gold);
  fillRect(x0, y1 - 3, x1, y1, gold);
  fillRect(x0, y0, x0 + 3, y1, gold);
  fillRect(x1 - 3, y0, x1, y1, gold);
  drawTextCentered('WANTED', (x0 + x1) / 2, y0 + 14, 3, [255, 255, 255], 0);
  for (let i = 0; i < 5; i++) {
    const cx = 872 + i * 32;
    fillPolygon(starPoints(cx, 345, 13), gold);
  }
}

function drawHeadline(): void {
  drawTextCentered('MY AGENT GOT TIRED', W / 2, 55, 9, [255, 255, 255], 3);
  drawTextCentered('OF WAITING', W / 2, 135, 9, [255, 255, 255], 3);
  drawTextCentered('SO IT BUILT', W / 2, 915, 9, [255, 225, 77], 3);
  drawTextCentered('ITS OWN GTA 6.', W / 2, 995, 9, [255, 225, 77], 3);
}

// -------------------------------------------------------------------- main --
function main(): void {
  const ghost = decodePng(readFileSync(join(BOT_DIR, 'assets', 'mark-1024.png')));
  drawSky();
  drawStars();
  drawSun();
  drawSkyline();
  drawNeonSign('MAKE.FUN', 130, 600, 3, [255, 46, 136]);
  drawNeonSign('SOLMAR', 900, 640, 3, [0, 229, 255]);
  drawStreet();
  drawPalm(45, 60, 1);
  drawPalm(1035, 1020, -1);
  drawGhost(ghost);
  drawCar();
  drawWanted();
  drawHeadline();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'meme.png'), encodePng(W, H, canvas));
  try {
    copyFileSync(join(BOT_DIR, 'POST.json'), join(OUTPUT_DIR, 'POST.json'));
  } catch (err) {
    console.error(`POST.json could not be copied from ${BOT_DIR}: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();

