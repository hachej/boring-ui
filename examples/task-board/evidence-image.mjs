import { crc32, deflateSync } from 'node:zlib';

/** Fictional route diagram, encoded as PNG fixture bytes (no browser capture or external assets). */
export function evidenceImage() {
  const width = 640, height = 360;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const river = Math.abs(x - (420 + Math.sin(y / 75) * 55)) < 48;
    const route = Math.abs(x - (220 + Math.sin(y / 75) * 55)) < 9;
    const gate = x > 130 && x < 310 && y > 290 && y < 315;
    const colour = gate ? [64, 75, 66] : route ? [238, 192, 83] : river ? [114, 177, 207] : [214, 232, 206];
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    raw.set(colour, offset);
  }
  const chunk = (type, bytes) => { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([length, name, bytes, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
