import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// CRC32 implementation for PNG chunks (RFC-2083)
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function generatePng(size) {
  const width = size;
  const height = size;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk (13 bytes)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth: 8
  ihdr[9] = 6;  // color type: RGBA (6)
  ihdr[10] = 0; // compression: deflate (0)
  ihdr[11] = 0; // filter: standard (0)
  ihdr[12] = 0; // interlace: none (0)
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Scanlines with filter byte 0
  const scanlineLength = width * 4 + 1;
  const raw = Buffer.alloc(scanlineLength * height);

  const center = size / 2;
  const cornerR = size * 0.22;

  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLength;
    raw[offset] = 0; // Filter 0 (None)

    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 4;

      // Rounded squircle distance
      const dx = Math.abs(x - center + 0.5);
      const dy = Math.abs(y - center + 0.5);
      const inBox =
        dx <= center - cornerR ||
        dy <= center - cornerR ||
        Math.hypot(dx - (center - cornerR), dy - (center - cornerR)) <= cornerR;

      if (!inBox) {
        // Transparent outside squircle
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      // Obsidian background #0A0907
      let r = 10, g = 9, b = 7, a = 255;

      // Brain glyph: dual cerebral hemispheres
      const nx = (x - center) / (size * 0.35);
      const ny = (y - center) / (size * 0.35);
      const distLeftLobe = Math.hypot(nx + 0.35, ny);
      const distRightLobe = Math.hypot(nx - 0.35, ny);

      // Cream #FFE9B4 for outer lobes
      if (
        (distLeftLobe < 0.62 && distLeftLobe > 0.15 && Math.abs(nx) > 0.08) ||
        (distRightLobe < 0.62 && distRightLobe > 0.15 && Math.abs(nx) > 0.08)
      ) {
        r = 255; g = 233; b = 180;
      } else if (distLeftLobe <= 0.15 || distRightLobe <= 0.15) {
        // Inner lobe core: Fresh Mind Green #79D056
        r = 121; g = 208; b = 86;
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }

  const idatChunk = makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

export function generateAllIcons(targetDirs) {
  const sizes = [16, 32, 48, 128];
  for (const dir of targetDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    for (const size of sizes) {
      const filePath = path.join(dir, `icon${size}.png`);
      const buffer = generatePng(size);
      fs.writeFileSync(filePath, buffer);
      console.log(`Generated icon: ${filePath} (${size}x${size}, ${buffer.length} bytes)`);
    }
  }
}

// Execute when invoked directly
const iconDirs = [
  path.join(rootDir, 'icons'),
  path.join(rootDir, 'dist', 'icons'),
];
generateAllIcons(iconDirs);
