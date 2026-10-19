import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HIDDEN_NAMES, MEDIA_TYPES, SNIFF_BYTES, delimitedTextType, extensionOf, isBinaryKind, isTemporary, mediaTypeOf, sniffMediaType, temporaryFileName, uploadPath, viewerKindOf, workspacePath,
} from '@hachej/boring-files/file-types';
import { SNIFF_BYTES as AGENT_SNIFF_BYTES, fileKind, mediaTypeFor, nativeImageType } from '@hachej/boring-agent/file-types';
import { deflated, docxHead, ftypHead, plainZipHead, storedDocxHead, xlsxHead, zipHead } from '../fixtures/blob-bytes.mjs';

const UUID = '0b8d2f1e-3c4a-4d5e-8f60-7a8b9c0d1e2f';

test('one media-type table: names resolve case-insensitively and anything unknown is octet-stream', () => {
  assert.equal(mediaTypeOf('notes/a.md'), 'text/markdown');
  assert.equal(mediaTypeOf('Shot.PNG'), 'image/png');
  assert.equal(mediaTypeOf('deck.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(mediaTypeOf('a.unknownext'), 'application/octet-stream');
  // A name with no extension is not its own extension: a file called `md` is not markdown.
  assert.equal(mediaTypeOf('md'), 'application/octet-stream');
  assert.equal(mediaTypeOf('dir.md/readme'), 'application/octet-stream');
  assert.equal(extensionOf('dir.v2/readme'), '');
  assert.equal(extensionOf('.env'), 'env');
  assert.ok(MEDIA_TYPES.svg === 'image/svg+xml' && MEDIA_TYPES.tldraw === 'application/vnd.tldraw+json');
});

test('viewer kinds: svg is an image, tldraw a canvas, unlisted names text; binary viewers never decode', () => {
  assert.equal(viewerKindOf('a.svg'), 'image');
  assert.equal(viewerKindOf('board.tldraw'), 'canvas');
  assert.equal(viewerKindOf('a.ts'), 'text');
  assert.equal(isBinaryKind('a.png'), true);
  assert.equal(isBinaryKind('a.pdf'), true);
  assert.equal(isBinaryKind('a.svg'), false);
  assert.equal(isBinaryKind('a.md'), false);
});

test('temporary files: one name rule, produced and recognised by the same module', () => {
  assert.equal(isTemporary(`docs/${temporaryFileName(UUID)}`), true);
  assert.equal(isTemporary(temporaryFileName(UUID)), true);
  assert.equal(isTemporary('docs/.boring-notauuid.tmp'), false);
  assert.equal(isTemporary('docs/report.tmp'), false);
});

test('hidden names: the presentation default set includes VCS, build and the provider folder', () => {
  for (const name of ['.git', '.boring', 'node_modules', 'dist', '__pycache__']) assert.ok(HIDDEN_NAMES.has(name), name);
  assert.equal(HIDDEN_NAMES.has('src'), false);
});

test('workspace paths: leading ./ (repeated) is removed; a leading / stays so the provider refuses it, never aliases it', () => {
  assert.equal(workspacePath('./a/b.md'), 'a/b.md');
  assert.equal(workspacePath('././a/b.md'), 'a/b.md');
  assert.equal(workspacePath('/a/b.md'), '/a/b.md');
  assert.equal(workspacePath('/workspace/report.md'), '/workspace/report.md');
  assert.equal(workspacePath('/../x'), '/../x');
  assert.equal(workspacePath('//a'), '//a');
  assert.equal(workspacePath('a/./b'), 'a/./b');
  assert.equal(workspacePath('.hidden'), '.hidden');
});

test('lookups are own properties: an inherited name is neither a media type nor a viewer', () => {
  for (const path of ['a.constructor', 'a.__proto__']) {
    assert.equal(mediaTypeOf(path), 'application/octet-stream', path);
    assert.equal(viewerKindOf(path), 'text', path);
    assert.equal(isBinaryKind(path), false, path);
  }
});

test('upload names: a random suffix beside the stem, whitespace as underscore', () => {
  assert.equal(uploadPath('my file.png', 'abcd1234'), 'uploads/my_file-abcd1234.png');
  assert.equal(uploadPath('image.png', '00000000'), 'uploads/image-00000000.png');
  assert.equal(uploadPath('README', 'abcd1234'), 'uploads/README-abcd1234');
  assert.equal(uploadPath('.env', 'abcd1234'), 'uploads/.env-abcd1234');
});

test('magic numbers: a signature names its media type whatever the name says', () => {
  assert.equal(sniffMediaType(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), 'application/pdf');
  assert.equal(sniffMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png');
  assert.equal(sniffMediaType(Uint8Array.from([0x00, 0x01])), undefined);
  assert.equal(mediaTypeFor('report.txt', 'pdf', 'text/plain', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])), 'application/pdf');
});

test('agent kinds stay separate from viewer kinds and read the shared table', () => {
  assert.equal(fileKind('a.svg'), 'text', 'the agent reads an SVG as text');
  assert.equal(viewerKindOf('a.svg'), 'image', 'the viewer shows it as an image');
  assert.equal(fileKind('scan.pdf', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])), 'pdf');
  assert.equal(fileKind('notes.txt', Uint8Array.from([0x00])), 'binary');
  assert.equal(nativeImageType('a.jpeg'), 'image/jpeg');
  assert.equal(nativeImageType('a.tif'), undefined, 'a TIFF is an image a host converts, not a native part');
  for (const path of ['a.constructor', 'a.__proto__']) {
    assert.equal(nativeImageType(path), undefined, path);
    assert.equal(mediaTypeFor(path, 'image', undefined), 'application/octet-stream', path);
  }
  assert.equal(mediaTypeFor('deck.pptx', 'office', undefined), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(mediaTypeFor('legacy.txt', 'office', undefined), 'application/octet-stream', 'an OLE file under a text name keeps the generic type');
});

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test('HEIC and HEIF by their ftyp brands; AVIF is not claimed', () => {
  assert.equal(sniffMediaType(ftypHead('heic', ['mif1', 'heic'])), 'image/heic');
  assert.equal(sniffMediaType(ftypHead('heix', ['mif1'])), 'image/heic');
  assert.equal(sniffMediaType(ftypHead('mif1', ['mif1', 'heic'])), 'image/heic', 'a generic brand with a HEVC compatible brand');
  assert.equal(sniffMediaType(ftypHead('msf1', ['msf1'])), 'image/heif');
  assert.equal(sniffMediaType(ftypHead('mif1', ['mif1', 'avif'])), undefined, 'AVIF is not HEIF here');
  assert.equal(sniffMediaType(ftypHead('isom', ['isom', 'mp41'])), 'video/mp4', 'an MP4 is not an image');
  assert.equal(mediaTypeOf('IMG_0001.HEIC'), 'image/heic');
});

test('video extensions and cheap container signatures use the shared table', () => {
  for (const [extension, type] of [['mp4', 'video/mp4'], ['webm', 'video/webm'], ['mov', 'video/quicktime'], ['m4v', 'video/x-m4v'], ['ogg', 'video/ogg'], ['ogv', 'video/ogg']]) {
    assert.equal(mediaTypeOf(`fictional.${extension.toUpperCase()}`), type);
    assert.equal(viewerKindOf(`fictional.${extension}`), 'video');
    assert.equal(isBinaryKind(`fictional.${extension}`), true);
  }
  for (const brand of ['isom', 'iso2', 'mp41', 'mp42', 'avc1']) assert.equal(sniffMediaType(ftypHead(brand)), 'video/mp4', brand);
  assert.equal(sniffMediaType(ftypHead('qt  ')), 'video/quicktime');
  assert.equal(sniffMediaType(ftypHead('M4V ')), 'video/x-m4v');
  assert.equal(sniffMediaType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), 'video/webm');
  assert.equal(sniffMediaType(ftypHead('avif', ['mif1'])), undefined, 'an image container never becomes video');
  assert.equal(sniffMediaType(ftypHead('zzzz')), undefined, 'an unknown ftyp brand is not claimed');
  assert.equal(sniffMediaType(ftypHead('mp42').subarray(0, 10)), undefined, 'a truncated brand is not claimed');
});

test('zip-based office documents from their entries in the head, without inflating; a plain zip is not claimed', () => {
  assert.equal(sniffMediaType(xlsxHead()), XLSX);
  assert.equal(sniffMediaType(docxHead()), DOCX);
  assert.equal(sniffMediaType(storedDocxHead()), DOCX, 'a stored [Content_Types].xml names its main part');
  assert.equal(sniffMediaType(zipHead([{ name: 'mimetype', method: 0, data: 'application/vnd.oasis.opendocument.text' }, { name: 'content.xml', data: deflated(50) }])), 'application/vnd.oasis.opendocument.text');
  assert.equal(sniffMediaType(plainZipHead()), undefined);
  assert.equal(sniffMediaType(zipHead([{ name: 'xl/workbook.xml', data: deflated(40) }])), undefined, 'an office folder without [Content_Types].xml is any zip');
  assert.equal(sniffMediaType(xlsxHead().subarray(0, 40)), undefined, 'a head cut inside the first entry says nothing');
  assert.equal(fileKind('upload.bin', xlsxHead()), 'office', 'the agent routes a sniffed office document to the converter');
  assert.equal(mediaTypeFor('upload.bin', 'office', 'application/octet-stream', docxHead()), DOCX);
  assert.equal(fileKind('notes.zip', plainZipHead()), 'archive');
});

test('text: valid UTF-8 without NUL is text/plain; binary is never text', () => {
  assert.equal(sniffMediaType(new TextEncoder().encode('Fictional notes: café, 東京, 🌱\n')), 'text/plain');
  const cut = new TextEncoder().encode(`a${'é'.repeat(SNIFF_BYTES)}`);
  assert.equal(sniffMediaType(cut), 'text/plain', 'a character cut at the end of the head is still text');
  assert.equal(sniffMediaType(Uint8Array.from([0x48, 0x69, 0x00, 0x21])), undefined, 'a NUL byte');
  assert.equal(sniffMediaType(Uint8Array.from([0x48, 0xc3, 0x28, 0x21])), undefined, 'invalid UTF-8');
  assert.equal(sniffMediaType(deflated(512)), undefined, 'binary noise');
  assert.equal(sniffMediaType(new Uint8Array()), undefined, 'an empty head says nothing');
  assert.equal(mediaTypeFor('notes.md', 'text', 'text/markdown', new TextEncoder().encode('# Notes')), 'text/markdown', 'sniffed text never overrides a name');
  assert.equal(AGENT_SNIFF_BYTES, SNIFF_BYTES, 'the agent reads the table\'s head size');
});

test('CSV and TSV: the name says which, the bytes must be text', () => {
  const rows = new TextEncoder().encode('city,count\nLyon,3\n');
  assert.equal(delimitedTextType('data/cities.csv', rows), 'text/csv');
  assert.equal(delimitedTextType('data/cities.TSV', rows), 'text/tab-separated-values');
  assert.equal(delimitedTextType('data/cities.txt', rows), undefined);
  assert.equal(delimitedTextType('data/cities.csv', deflated(64)), undefined, 'binary under a CSV name is not CSV');
  assert.equal(mediaTypeOf('a.tsv'), 'text/tab-separated-values');
});
