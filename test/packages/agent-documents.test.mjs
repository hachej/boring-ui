import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Harness, MemoryStorage, ToolResultEntry, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import * as XLSX from 'xlsx';
import { documentTools, readStored, sniff } from '@hachej/boring-agent/documents';
import { admitDocumentTool } from '../fixtures/native-document.mjs';

const encode = text => new TextEncoder().encode(text);
const blob = () => Uint8Array.from([0, 255, 254, 16, 128, 0, 66]);
const png = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const zipNames = names => Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...encode(names)]);

// Fictional PDF: one text stream per page; null models a scanned page without a text layer.
function pdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((lines, i) => {
    const stream = lines ? `BT /F1 12 Tf 50 750 Td 14 TL ${lines.map(line => `(${line.replace(/[()\\]/g, '\\$&')}) Tj T*`).join(' ')} ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encode(out);
}

function workbook({ extra = 0, sheets = 2, long = false, bookType = 'xlsx' } = {}) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['article', 'quantite', 'site'], ['fictive-a', 12, 'nord'], ['fictive-b', 8, 'sud'], ...Array.from({ length: extra }, (_, i) => [`stock-${i}`, i, long ? 'x'.repeat(500) : 'fictif'])]), 'Stock');
  if (sheets > 1) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['article', 'prix'], ['fictive-a', 25], ['fictif, exemple', 19]]), 'Prix');
  for (let i = 2; i < sheets; i++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), `Fictif-${i}`);
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType }));
}

async function setup(t, { images = true, ocr } = {}) {
  const files = new Map(), reads = [];
  const readBytes = async path => {
    reads.push(path);
    if (!files.has(path)) throw new Error('No such fictional document');
    return files.get(path);
  };
  const tools = documentTools({ readBytes, images, ...(ocr ? { ocr } : {}) });
  // A host can use the helper on its own stored-file read path; the package never registers another read.
  const hostRead = defineTool({ name: 'fixture_read', description: 'Host stored-file fixture', replay: 'safe', parameters: Type.Object({ path: Type.String() }), execute: async ({ path }) => readStored(path, await readBytes(path), { images }) });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.documents', tools: [...tools, hostRead] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  harness.resume();
  const run = async (name, args) => {
    const id = await admitDocumentTool(conversation, args, name);
    const terminal = await harness.waitForTask(id, context);
    const entryId = terminal.state.outcome.result?.entryId;
    assert.ok(entryId, JSON.stringify(terminal.state.outcome));
    const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, entryId), context);
    const message = entry.model[0];
    const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('');
    let value; try { value = JSON.parse(text); } catch { value = text; }
    return { message, value, entry };
  };
  return { files, reads, tools, run };
}

test('documents sniff: bytes decide every supported type, never the upload name', () => {
  assert.equal(sniff(png(), 'renamed.txt'), 'image/png');
  assert.equal(sniff(pdf([['Fictional invoice']]), 'renamed.png'), 'application/pdf');
  assert.equal(sniff(workbook(), 'renamed.bin'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(sniff(blob(), 'renamed.csv'), 'application/octet-stream');
  assert.equal(sniff(encode('mois,montant\nmars,980'), 'stock.csv'), 'text/csv');
  assert.equal(sniff(encode('mois,montant'), 'renamed.pdf'), 'text/plain');
  assert.equal(sniff(Uint8Array.from([0xff, 0xd8, 0xff])), 'image/jpeg');
  assert.equal(sniff(encode('RIFFxxxxWEBP')), 'image/webp');
  for (const header of ['GIF87a', 'GIF89a']) assert.equal(sniff(encode(header)), 'image/gif');
  assert.equal(sniff(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), 'application/vnd.ms-excel');
  assert.equal(sniff(zipNames('word/document.xml')), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(sniff(zipNames('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')), 'application/vnd.oasis.opendocument.spreadsheet');
  assert.equal(sniff(zipNames('unknown')), 'application/octet-stream');
  assert.equal(sniff(Uint8Array.of(0xc3, 0x28)), 'application/octet-stream');
});

test('documents host bytes retain the image signature and UTF-8 without decoding binaries', async t => {
  const { files, run, reads } = await setup(t);
  const image = png(); files.set('capture.txt', image); files.set('notes.txt', encode('é fictif'));
  assert.equal((await run('fixture_read', { path: 'notes.txt' })).value.content, 'é fictif');
  const shown = await run('fixture_read', { path: 'capture.txt' });
  assert.deepEqual(shown.message.content[1], { type: 'image', data: Buffer.from(image).toString('base64'), mimeType: 'image/png' });
  assert.deepEqual([...image], [...png()], 'the helper leaves the host byte buffer intact');
  assert.deepEqual(reads, ['notes.txt', 'capture.txt']);
});

test('documents readStored: text and CSV content, images, and typed binary refusals with reader pointers', async t => {
  const { files, run } = await setup(t);
  files.set('stock.csv', encode('article,quantite\nfictif,980')); files.set('capture.png', png());
  files.set('invoice.pdf', pdf([['Total fictif 1622,00']])); files.set('stock.xlsx', workbook()); files.set('blob.bin', blob());
  assert.match((await run('fixture_read', { path: 'stock.csv' })).value.content, /fictif,980/);
  const image = await run('fixture_read', { path: 'capture.png' });
  assert.equal(image.message.content.length, 2);
  assert.deepEqual(image.value, { path: 'capture.png', type: 'image/png', size: png().length });
  assert.deepEqual(image.message.details, image.value);
  const refused = (await run('fixture_read', { path: 'invoice.pdf' })).value;
  assert.equal(refused.type, 'application/pdf'); assert.match(refused.error, /read_pdf/); assert.equal(refused.content, undefined);
  assert.equal((await run('fixture_read', { path: 'invoice.pdf' })).message.isError, false, 'typed refusals remain ordinary results');
  assert.match((await run('fixture_read', { path: 'stock.xlsx' })).value.error, /read_spreadsheet/);
  const binary = (await run('fixture_read', { path: 'blob.bin' })).value;
  assert.deepEqual({ path: binary.path, type: binary.type, size: binary.size }, { path: 'blob.bin', type: 'application/octet-stream', size: blob().length });
  assert.match(binary.error, /Binary file/);
});

test('documents readStored refuses a blind model, a 5 MB image, and docx with name, type and size', async t => {
  const blind = await setup(t, { images: false }); blind.files.set('capture.png', png());
  const refused = await blind.run('fixture_read', { path: 'capture.png' });
  assert.equal(refused.message.content.length, 1); assert.match(refused.value.error, /does not read images/);
  const seeing = await setup(t), big = new Uint8Array(5 * 1024 * 1024); big.set(png());
  seeing.files.set('large.png', big); const docx = zipNames('word/document.xml'); seeing.files.set('draft.docx', docx);
  const tooBig = await seeing.run('fixture_read', { path: 'large.png' });
  assert.equal(tooBig.message.content.length, 1); assert.match(tooBig.value.error, /4 MB/);
  assert.deepEqual([tooBig.value.path, tooBig.value.type, tooBig.value.size], ['large.png', 'image/png', big.length]);
  const office = (await seeing.run('fixture_read', { path: 'draft.docx' })).value;
  assert.deepEqual([office.path, office.type, office.size], ['draft.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx.length]);
  assert.match(office.error, /Binary file/);
});

test('documents read_pdf returns each text page, requested pages and clear non-PDF/damaged refusals', async t => {
  const { files, run } = await setup(t);
  files.set('invoice.pdf', pdf([['Fictional FX-001', '20 % | 1000,00 | 200,00', '5,5 % | 400,00 | 22,00'], ['Total TTC 1622,00']]));
  files.set('blob.bin', blob()); files.set('broken.pdf', encode('%PDF-1.4\ndamaged'));
  const all = (await run('read_pdf', { path: 'invoice.pdf' })).value;
  assert.equal(all.totalPages, 2); assert.deepEqual(all.pages.map(page => page.n), [1, 2]);
  assert.match(all.pages[0].text, /20 % \| 1000,00 \| 200,00/); assert.match(all.pages[0].text, /5,5 % \| 400,00 \| 22,00/);
  assert.match(all.pages[1].text, /Total TTC 1622,00/); assert.equal(all.untrusted, true); assert.ok(all.pages.every(page => page.ocr === undefined));
  assert.deepEqual((await run('read_pdf', { path: 'invoice.pdf', pages: '2' })).value.pages.map(page => page.n), [2]);
  assert.deepEqual((await run('read_pdf', { path: 'blob.bin' })).value, { path: 'blob.bin', type: 'application/octet-stream', size: blob().length, error: 'Not a PDF' });
  assert.match((await run('read_pdf', { path: 'broken.pdf' })).value.error, /damaged or protected/);
});

test('documents read_pdf sends only selected scan page numbers to host OCR and marks recovered text', async t => {
  const scan = pdf([['Fictional invoice FX-002'], null, ['Fictional annex']]), seen = [];
  const ocr = async (bytes, pages) => {
    seen.push({ bytes: [...bytes], pages: [...pages] });
    return { provider: 'fictional-ocr', pages: [{ n: 1, text: 'ignored' }, { n: 2, text: ' Total TTC 480,00 (OCR) ' }] };
  };
  const { files, run } = await setup(t, { ocr }); files.set('invoice-fictive.pdf', scan);
  const read = (await run('read_pdf', { path: 'invoice-fictive.pdf', pages: '1-2' })).value;
  assert.equal(read.totalPages, 3); assert.deepEqual(read.pages.map(page => page.n), [1, 2]);
  assert.match(read.pages[0].text, /FX-002/); assert.equal(read.pages[0].ocr, undefined);
  assert.deepEqual(read.pages[1], { n: 2, text: 'Total TTC 480,00 (OCR)', ocr: true });
  assert.match(read.note, /OCR \(fictional-ocr\)/); assert.deepEqual(seen, [{ bytes: [...scan], pages: [2] }]);
  await run('read_pdf', { path: 'invoice-fictive.pdf', pages: '1,3' }); assert.equal(seen.length, 1);
});

test('documents host OCR is optional; missing and failed OCR stay explicit rather than inventing text', async t => {
  const scan = pdf([['Fictional invoice'], null, ['Fictional annex']]);
  const none = await setup(t); none.files.set('invoice-fictive.pdf', scan);
  const unread = (await none.run('read_pdf', { path: 'invoice-fictive.pdf', pages: '1-2' })).value;
  assert.equal(unread.pages[1].text, ''); assert.match(unread.note, /OCR is not available here/);
  const failing = await setup(t, { ocr: async () => { throw new Error('fictional quota'); } }); failing.files.set('scan.pdf', scan);
  const failed = (await failing.run('read_pdf', { path: 'scan.pdf' })).value;
  assert.equal(failed.pages[1].text, ''); assert.match(failed.note, /OCR failed: fictional quota/);
});

test('documents PDF page lists deduplicate, sort, reject malformed input and cap default/explicit pages and page text', async t => {
  const { files, run } = await setup(t);
  files.set('pages.pdf', pdf(Array.from({ length: 35 }, (_, i) => [`Fictional page ${i + 1}`])));
  const read = pages => run('read_pdf', { path: 'pages.pdf', ...(pages === undefined ? {} : { pages }) }).then(result => result.value);
  assert.deepEqual((await read('4, 1,2-3')).pages.map(page => page.n), [1, 2, 3, 4]);
  assert.deepEqual((await read('33-40')).pages.map(page => page.n), [33, 34, 35]);
  for (const pages of ['0', '3-1', 'a']) assert.match((await read(pages)).error, /pages is a list/);
  assert.match((await read('99')).error, /35 pages/);
  assert.equal((await read()).pages.length, 30); assert.equal((await read()).next, 'pages: "31-35"');
  assert.equal((await read('1-35')).pages.length, 30);
  const large = await setup(t, { ocr: async () => ({ pages: [{ n: 1, text: 'f'.repeat(20_001) }] }) }); large.files.set('long.pdf', pdf([null]));
  const page = (await large.run('read_pdf', { path: 'long.pdf' })).value.pages[0];
  assert.equal(page.text.length, 20_000); assert.equal(page.truncated, true);
});

test('documents read_spreadsheet returns names, row counts, CSV, one sheet, range and default/range row caps', async t => {
  const { files, run } = await setup(t); files.set('stock.xlsx', workbook()); files.set('long.xlsx', workbook({ extra: 1500 }));
  files.set('stock.csv', encode('article,quantite\nfictif,980\nexemple,1010')); files.set('blob.bin', blob());
  const all = (await run('read_spreadsheet', { path: 'stock.xlsx' })).value;
  assert.deepEqual(all.sheetNames, ['Stock', 'Prix']);
  assert.deepEqual(all.sheets.map(sheet => [sheet.name, sheet.rows, sheet.columns]), [['Stock', 3, 3], ['Prix', 3, 2]]);
  assert.equal(all.sheets[0].csv, 'article,quantite,site\nfictive-a,12,nord\nfictive-b,8,sud');
  assert.equal(all.sheets[0].truncated, undefined); assert.equal(all.untrusted, true);
  const prix = (await run('read_spreadsheet', { path: 'stock.xlsx', sheet: 'Prix' })).value;
  assert.deepEqual(prix.sheets.map(sheet => sheet.name), ['Prix']); assert.match(prix.sheets[0].csv, /"fictif, exemple"/);
  const ranged = (await run('read_spreadsheet', { path: 'stock.xlsx', sheet: 'Stock', range: 'A2:B3' })).value.sheets[0];
  assert.equal(ranged.csv, 'fictive-a,12\nfictive-b,8'); assert.equal(ranged.rows, 3);
  assert.match((await run('read_spreadsheet', { path: 'stock.xlsx', sheet: 'Absent' })).value.error, /No sheet named/);
  assert.match((await run('read_spreadsheet', { path: 'stock.xlsx', range: 'everything' })).value.error, /range is cells/);
  const long = (await run('read_spreadsheet', { path: 'long.xlsx', sheet: 'Stock' })).value.sheets[0];
  assert.equal(long.rows, 1503); assert.equal(long.shown, 200); assert.equal(long.truncated, true); assert.equal(long.csv.split('\n').length, 200);
  const cap = (await run('read_spreadsheet', { path: 'long.xlsx', sheet: 'Stock', range: 'A1:C1500' })).value.sheets[0];
  assert.equal(cap.shown, 1000); assert.equal(cap.truncated, true); assert.equal(cap.csv.split('\n').length, 1000);
  assert.equal((await run('read_spreadsheet', { path: 'stock.csv' })).value.sheets[0].rows, 3);
  assert.deepEqual((await run('read_spreadsheet', { path: 'blob.bin' })).value, { path: 'blob.bin', type: 'application/octet-stream', size: blob().length, error: 'Not a spreadsheet' });
});

test('documents spreadsheet sheet/CSV limits, empty sheets, xls and ods use the same reader', async t => {
  const { files, run } = await setup(t); files.set('many.xlsx', workbook({ sheets: 22 })); files.set('wide.xlsx', workbook({ extra: 200, long: true }));
  const many = (await run('read_spreadsheet', { path: 'many.xlsx' })).value;
  assert.equal(many.sheetNames.length, 20); assert.equal(many.sheets.length, 20); assert.equal(many.moreSheets, 2);
  assert.deepEqual(many.sheets[2], { name: 'Fictif-2', rows: 0, columns: 0, shown: 0, csv: '' });
  const wide = await run('read_spreadsheet', { path: 'wide.xlsx', sheet: 'Stock' });
  assert.equal(typeof wide.value, 'object', 'native output must remain valid JSON above 50 KiB');
  assert.deepEqual(wide.entry.data.diagnostics, [], 'native output limits retain the complete JSON above 50 KiB');
  const clipped = wide.value.sheets[0];
  assert.equal(clipped.csv.length, 60_000); assert.equal(clipped.truncated, true);
  for (const bookType of ['xls', 'ods']) {
    files.set(`stock.${bookType}`, workbook({ bookType }));
    assert.deepEqual((await run('read_spreadsheet', { path: `stock.${bookType}` })).value.sheetNames, ['Stock', 'Prix']);
  }
});

test('documents tools describe their results, are native replay-safe registrations and respect host read refusals', async t => {
  const { tools, run } = await setup(t);
  assert.deepEqual(tools.map(tool => tool.name), ['read_pdf', 'read_spreadsheet']);
  assert.ok(tools.every(tool => tool.replay === 'safe'));
  assert.match(tools[0].description, /ocr: true/); assert.match(tools[1].description, /CSV/);
  assert.ok(tools.every(tool => /untrusted/.test(tool.description)));
  for (const name of ['read_pdf', 'read_spreadsheet']) {
    const denied = await run(name, { path: 'missing.bin' });
    assert.equal(denied.message.isError, true); assert.match(JSON.stringify(denied.value), /No such fictional document/);
    const invalid = await run(name, { path: 12 }); assert.equal(invalid.message.isError, true);
  }
});

test('documents imports, registration, sniff and readStored never load either reader dependency', () => {
  const directory = mkdtempSync(join(tmpdir(), 'documents-lazy-'));
  try {
    const loader = join(directory, 'loader.mjs'), register = join(directory, 'register.mjs');
    writeFileSync(loader, `export function resolve(specifier, context, next) { if (specifier === 'unpdf' || specifier === 'xlsx') throw new Error('eager document dependency: ' + specifier); return next(specifier, context); }`);
    writeFileSync(register, `import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(loader).href)});`);
    const result = spawnSync(process.execPath, ['--import', register, '--input-type=module', '-e', `
      import { documentTools, sniff, readStored } from '@hachej/boring-agent/documents';
      const bytes = new TextEncoder().encode('fictional');
      if (sniff(bytes) !== 'text/plain') throw new Error('sniff');
      readStored('notes.txt', bytes, { images: false });
      if (documentTools({ readBytes: async () => bytes }).length !== 2) throw new Error('tools');
    `], { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.error, undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
