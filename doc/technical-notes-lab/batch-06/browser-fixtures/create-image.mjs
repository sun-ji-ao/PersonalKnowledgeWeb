// Deterministic synthetic PNG for upload testing; no personal image data.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crc32 = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
function chunk(name, data) {
  const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
const width = 120, height = 60, header = Buffer.alloc(13), scanlines = Buffer.alloc(height * (1 + width * 3));
header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const offset = y * (1 + width * 3) + 1 + x * 3;
  const color = x < width / 2 ? [34, 105, 75] : [195, 225, 202];
  for (let c = 0; c < 3; c++) scanlines[offset + c] = color[c];
}
writeFileSync(new URL('architecture.png', import.meta.url), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]));
