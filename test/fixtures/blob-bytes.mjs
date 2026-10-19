/** Fictional byte fixtures for media sniffing and blob pointers, generated so no binary file is committed. */
import { crc32, deflateSync } from 'node:zlib';

/** A fictional PNG: a soft harbour-blue gradient with a sand band, `width` × `height`, RGB. */
export function fictionalPng(width, height) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const sand = y > height * 0.72;
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      rows[at] = sand ? 222 : 70 + Math.round(60 * y / height);
      rows[at + 1] = sand ? 196 : 130 + Math.round(50 * x / width);
      rows[at + 2] = sand ? 150 : 190 + Math.round(40 * (1 - y / height));
    }
  }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

/** An ISO-BMFF head: a `ftyp` box with a major brand and compatible brands, then the start of a `meta` box. */
export function ftypHead(major, compatible = []) {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size + 8);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(`ftyp${major}`), 4);
  compatible.forEach((brand, index) => bytes.set(new TextEncoder().encode(brand), 16 + index * 4));
  bytes.set(new TextEncoder().encode('\0\0\0\x08meta'), size);
  return bytes;
}

/**
 * A zip's local file headers, as an archiver writes them: each entry `{ name, data, method }`; method 8 (deflate) entries carry
 * fictional bytes standing for compressed data (a sniffer must not inflate them). No central directory: only the head matters.
 */
export function zipHead(entries) {
  const parts = [];
  for (const { name, data, method = 8 } of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, method, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, body.length, true);
    view.setUint16(26, nameBytes.length, true);
    parts.push(header, nameBytes, body);
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Fictional deflated bytes: binary noise with NUL bytes, as compressed XML looks to a sniffer. */
export const deflated = length => Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);

export const xlsxHead = () => zipHead([
  { name: '[Content_Types].xml', data: deflated(380) },
  { name: '_rels/.rels', data: deflated(240) },
  { name: 'xl/workbook.xml', data: deflated(600) },
]);
export const docxHead = () => zipHead([
  { name: '[Content_Types].xml', data: deflated(410) },
  { name: '_rels/.rels', data: deflated(230) },
  { name: 'word/document.xml', data: deflated(900) },
]);
/** A docx whose `[Content_Types].xml` is stored uncompressed: its main part type names it. */
export const storedDocxHead = () => zipHead([
  { name: '[Content_Types].xml', method: 0, data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
]);
/** A zip that is not a document: a fictional archive of notes. */
export const plainZipHead = () => zipHead([{ name: 'notes/today.txt', data: deflated(120) }, { name: 'notes/later.txt', data: deflated(90) }]);

/** A valid pointer to a fictional blob. */
export const pointer = (fields = {}) => ({ 'boring:blob': 1, id: 'blob/fictional-cat 01', sha256: 'a'.repeat(64), size: 3_456_789, type: 'image/heic', name: 'cat.heic', ...fields });
export const pointerBytes = fields => new TextEncoder().encode(JSON.stringify(pointer(fields)));
