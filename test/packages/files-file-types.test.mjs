import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HIDDEN_NAMES, MEDIA_TYPES, extensionOf, isBinaryKind, isTemporary, mediaTypeOf, sniffMediaType, temporaryFileName, uploadPath, viewerKindOf, workspacePath,
} from '@hachej/boring-files/file-types';
import { fileKind, mediaTypeFor, nativeImageType } from '@hachej/boring-agent/file-types';

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
