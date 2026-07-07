// Generates a simple calendar-style app icon as a plain PNG, with no image
// libraries — just hand-rolled pixel drawing + a minimal PNG encoder (zlib
// handles the DEFLATE/zlib wrapper; we still need our own CRC32 + chunking).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowSize] = 0; // filter: none
    pixels.copy(raw, y * rowSize + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function setPixel(buf, w, x, y, color) {
  if (x < 0 || y < 0 || x >= w) return;
  const idx = (y * w + x) * 4;
  if (idx + 3 >= buf.length) return;
  buf[idx] = color[0];
  buf[idx + 1] = color[1];
  buf[idx + 2] = color[2];
  buf[idx + 3] = color[3];
}

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 + r && y < y0 + r) {
    const dx = x0 + r - x;
    const dy = y0 + r - y;
    return dx * dx + dy * dy <= r * r;
  }
  if (x > x1 - r - 1 && y < y0 + r) {
    const dx = x - (x1 - r - 1);
    const dy = y0 + r - y;
    return dx * dx + dy * dy <= r * r;
  }
  if (x < x0 + r && y > y1 - r - 1) {
    const dx = x0 + r - x;
    const dy = y - (y1 - r - 1);
    return dx * dx + dy * dy <= r * r;
  }
  if (x > x1 - r - 1 && y > y1 - r - 1) {
    const dx = x - (x1 - r - 1);
    const dy = y - (y1 - r - 1);
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function drawTwoToneCard(buf, w, x0, y0, x1, y1, radius, colorTop, colorBottom, splitY) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!insideRoundedRect(x, y, x0, y0, x1, y1, radius)) continue;
      setPixel(buf, w, x, y, y < splitY ? colorTop : colorBottom);
    }
  }
}

function fillRoundedRect(buf, w, x0, y0, x1, y1, radius, color) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!insideRoundedRect(x, y, x0, y0, x1, y1, radius)) continue;
      setPixel(buf, w, x, y, color);
    }
  }
}

const pixels = Buffer.alloc(SIZE * SIZE * 4, 0); // transparent background

const ACCENT = [124, 140, 255, 255]; // matches --accent
const WHITE = [255, 255, 255, 255];
const RING = [74, 78, 102, 255];

// binder rings, drawn first so the card covers their lower half
fillRoundedRect(pixels, SIZE, 76, 30, 100, 68, 8, RING);
fillRoundedRect(pixels, SIZE, 156, 30, 180, 68, 8, RING);

// card body: accent header band + white body, single rounded shape
drawTwoToneCard(pixels, SIZE, 32, 52, 224, 224, 28, ACCENT, WHITE, 104);

// a few "date grid" dots on the white body for a calendar feel
const dotColor = [190, 196, 224, 255];
const gridStartX = 60;
const gridStartY = 132;
for (let row = 0; row < 3; row += 1) {
  for (let col = 0; col < 5; col += 1) {
    const cx = gridStartX + col * 28;
    const cy = gridStartY + row * 26;
    fillRoundedRect(pixels, SIZE, cx, cy, cx + 14, cy + 14, 4, dotColor);
  }
}

const png = buildPNG(SIZE, SIZE, pixels);
const outDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('Wrote build/icon.png');
