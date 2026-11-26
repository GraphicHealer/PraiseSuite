/**
 * Generates icon.ico — a 256x256 PNG-in-ICO, drawn programmatically so the
 * repo needs no binary assets: deep-purple rounded square with a white
 * eighth note (OpenSong's whole-thing-is-music cue).
 */
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const S = 256;
const px = new Uint8Array(S * S * 4);

const BG = [0x2d, 0x1b, 0x4e]; // deep purple
const FG = [0xf5, 0xf2, 0xfa]; // near-white
const R = 56; // corner radius

function set(x, y, [r, g, b], a = 255) {
  const i = (y * S + x) * 4;
  if (a === 255) {
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  } else { // alpha blend over existing pixel
    const t = a / 255;
    px[i] = Math.round(r * t + px[i] * (1 - t));
    px[i + 1] = Math.round(g * t + px[i + 1] * (1 - t));
    px[i + 2] = Math.round(b * t + px[i + 2] * (1 - t));
    px[i + 3] = Math.min(255, px[i + 3] + Math.round(255 * t));
  }
}

const smooth = (d, lo, hi) =>
  d < lo ? 255 : d > hi ? 0 : Math.round(255 * (1 - (d - lo) / (hi - lo)));

// Geometry ----------------------------------------------------------------
function inRoundedRect(x, y) {
  const cx = Math.min(Math.max(x, R), S - R);
  const cy = Math.min(Math.max(y, R), S - R);
  return Math.hypot(x - cx, y - cy) - R; // signed distance
}
const note = {
  hx: 96, hy: 186, rx: 40, ry: 30, tilt: -0.35, // rotated ellipse head
  sx0: 128, sx1: 146, sy0: 58, sy1: 196,        // stem
  // flag: triangle fan from stem top right edge, sweeping right+down
  flag: [[146, 58], [196, 78], [196, 118], [146, 96]],
};

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function noteDist(x, y) {
  // ellipse head (rotated)
  const c = Math.cos(note.tilt), s = Math.sin(note.tilt);
  const dx = x - note.hx, dy = y - note.hy;
  const ex = dx * c - dy * s, ey = dx * s + dy * c;
  const ed = Math.hypot(ex / note.rx, ey / note.ry) - 1; // ~signed, scaled
  const head = ed * Math.min(note.rx, note.ry);
  // stem box
  const stem = Math.max(
    Math.max(note.sx0 - x, x - note.sx1),
    Math.max(note.sy0 - y, y - note.sy1),
  );
  // flag — point-in-polygon approximated as inside/outside
  const flag = inPoly(x, y, note.flag) ? -2 : 2;
  return Math.min(head, stem, flag);
}

// Rasterize ----------------------------------------------------------------
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const bg = inRoundedRect(x + 0.5, y + 0.5);
    if (smooth(bg, -0.5, 0.5) === 0) continue;
    set(x, y, BG, smooth(bg, -0.5, 0.5));
    const fg = noteDist(x + 0.5, y + 0.5);
    const fa = smooth(fg, -0.7, 0.7);
    if (fa > 0) set(x, y, FG, fa);
  }
}

// PNG encode ---------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

// ICO container (PNG payload) ----------------------------------------------
const header = Buffer.from([0, 0, 1, 0, 1, 0]); // reserved, type=icon, count=1
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; // 256x256 (0 means 256)
entry[2] = 0; entry[3] = 0; // palette, reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12); // image offset
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icon.ico");
writeFileSync(out, Buffer.concat([header, entry, png]));
console.log(`wrote ${out} (${png.length} B png)`);
