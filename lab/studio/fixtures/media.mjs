// Small invented media for the studio workspace, generated in code so no binary is committed: a moon badge PNG with a
// transparent background (so the image viewer's checkerboard shows), an SVG diagram, and a one-page PDF. All fictional.
import { crc32, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, sum]);
}

/** A 96x96 RGBA moon: a pale disc with three craters on a transparent background. */
export function moonBadgePng() {
  const size = 96, rows = [];
  const craters = [[34, 38, 10], [60, 30, 6], [56, 62, 12]];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = x - 47.5, dy = y - 47.5, distance = Math.hypot(dx, dy);
      const at = 1 + x * 4;
      if (distance > 44) { row.set([0, 0, 0, 0], at); continue; }
      const crater = craters.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r);
      const shade = Math.round(235 - distance * 0.9 - (crater ? 38 : 0));
      row.set([shade, shade - 8, shade - 40, distance > 43 ? 140 : 255], at);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header.set([8, 6, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
}

export const ORBIT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200" role="img" aria-label="A fictional orbit diagram">
  <rect width="320" height="200" fill="#10162b"/>
  <ellipse cx="160" cy="100" rx="120" ry="60" fill="none" stroke="#6f7bb5" stroke-dasharray="4 4"/>
  <circle cx="160" cy="100" r="22" fill="#3d6fd0"/>
  <circle cx="276" cy="82" r="9" fill="#f1e6b8"/>
  <text x="160" y="104" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#fff">Placeholder</text>
  <text x="160" y="186" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#c8cff0">Fictional orbit, not to scale</text>
</svg>
`;

/** A one-page PDF 1.4 in the standard Helvetica font. The cross-reference table is computed, so any text can be set. */
export function briefPdf() {
  const lines = [['F1', 22, 'Moon picnic brief'], ['F2', 12, 'A fictional one-page document for the studio.'], ['F2', 12, 'Meet at the placeholder pier at dusk.'], ['F2', 12, 'Bring a thermos, a star map and two blankets.']];
  const text = lines.map(([font, points, line], index) => `BT /${font} ${points} Tf 72 ${720 - index * (index === 0 ? 34 : 22)} Td (${line.replace(/[\\()]/g, '\\$&')}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => { const at = Buffer.byteLength(out); out += `${index + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** A solid-colour PNG of `size` pixels, built in code so a scenario needs no image file. */
export function solidPng(size, [r, g, b]) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
