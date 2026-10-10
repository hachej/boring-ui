import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { ToolResultEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { createConvertingRead, workersAiMarkdown } from '@hachej/boring-agent/file-convert';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { fileKind } from '@hachej/boring-agent/file-types';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { admitDocumentTool } from '../fixtures/native-document.mjs';

const encoder = new TextEncoder();
const access = { principalId: 'editor', initiatorId: 'alice', scopeId: 'fictional-project' };
const PDF = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';

/** Pi's native read, wrapped by the converting read, then the guard, over a real directory. Results carry content text and diagnostics. */
async function fixture(t, { convert, cache, maxBytes, read, guard = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-convert-'));
  const workspace = join(directory, 'workspace'), elsewhere = join(directory, 'elsewhere');
  mkdirSync(workspace); mkdirSync(elsewhere);
  const env = new NodeExecutionEnv({ cwd: workspace });
  const journal = createWorkspaceJournal(openNodeConnection(join(directory, 'journal.sqlite')));
  const base = createWorkspaceProvider({ identity: { providerId: 'files', instanceId: 'one', incarnation: 'one', viewId: 'published' }, fs: env, journal });
  const files = read ? Object.create(base, { read: { value: read } }) : base;
  const binding = { files, root: workspace, access };
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.files', tools: [createReadTool(), createWriteTool(), createEditTool()] }));
  registry.install(createConvertingRead({ workspace: binding, convert, cache, maxBytes }));
  if (guard) registry.install(createFileGuard({ workspace: binding }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models: createModels(), env: () => env }, context);
  t.after(async () => { await harness.close(context); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.root(context);
  const run = async (args, name = 'read') => {
    const terminal = await harness.waitForTask(await admitDocumentTool(conversation, args, name), context);
    const entryId = terminal.state.outcome.result?.entryId;
    if (entryId === undefined) throw new Error(JSON.stringify(terminal.state.outcome));
    const message = (await conversation.commit(tx => tx.entry(ToolResultEntry, entryId), context)).model[0];
    // The harness appends diagnostics to the text as <harness>[severity] message</harness>.
    const whole = message.content.filter(item => item.type === 'text').map(item => item.text).join('');
    const at = whole.indexOf('<harness>');
    return { isError: message.isError === true, all: whole, text: at < 0 ? whole : whole.slice(0, at), notes: at < 0 ? '' : whole.slice(at) };
  };
  const put = (path, content) => writeFileSync(join(workspace, path), content);
  return { workspace, elsewhere, run, put };
}

test('text goes to Pi\'s native read untouched; the converter is never called', async t => {
  let calls = 0;
  const f = await fixture(t, { convert: async () => { calls++; return { text: 'converted' }; } });
  f.put('notes.md', '# notes\nline two\n');
  f.put('data.unknownext', 'plain text under an unknown extension\n');
  assert.equal((await f.run({ path: 'notes.md' })).text, '# notes\nline two\n');
  assert.equal((await f.run({ path: 'data.unknownext' })).text, 'plain text under an unknown extension\n');
  assert.equal(calls, 0);
});

test('a PDF, an office file and an image are converted once per saved revision, and the text is cached', async t => {
  let calls = 0;
  const cache = new Map();
  const f = await fixture(t, { cache, convert: async ({ name, mediaType }) => { calls++; return { text: `text of ${name} (${mediaType})` }; } });
  f.put('report.pdf', PDF);
  const first = await f.run({ path: 'report.pdf' });
  const second = await f.run({ path: 'report.pdf' });
  assert.equal(first.isError, false);
  assert.match(first.text, /^text of report\.pdf \(application\/pdf\)$/);
  assert.equal(second.text, first.text);
  assert.equal(calls, 1, 'one revision converts once');
  assert.equal(cache.size, 1);
  f.put('report.pdf', `${PDF}% new revision\n`);
  await f.run({ path: 'report.pdf' });
  assert.equal(calls, 2, 'a new saved revision converts again');
  f.put('deck.pptx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('zip body')]));
  assert.match((await f.run({ path: 'deck.pptx' })).text, /^text of deck\.pptx/);
  f.put('scan.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  assert.match((await f.run({ path: 'scan.png' })).text, /^text of scan\.png/);
});

test('a PDF is detected by its magic number under a text-looking name and reaches convert as application/pdf', async t => {
  const seen = [];
  const f = await fixture(t, { convert: async ({ name, mediaType }) => { seen.push(mediaType); return { text: `converted ${name}` }; } });
  f.put('actually-a-pdf.txt', PDF);
  f.put('photo.jpg', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  assert.equal((await f.run({ path: 'actually-a-pdf.txt' })).text, 'converted actually-a-pdf.txt');
  assert.equal((await f.run({ path: 'photo.jpg' })).text, 'converted photo.jpg');
  assert.deepEqual(seen, ['application/pdf', 'image/png'], 'the signature names the media type, not the extension');
  assert.equal(fileKind('x.pdf'), 'pdf');
  assert.equal(fileKind('x.bin', encoder.encode('%PDF-1.7')), 'pdf');
  assert.equal(fileKind('x.docx', Buffer.from([0x50, 0x4b, 3, 4])), 'office');
  assert.equal(fileKind('x.dat', Buffer.from([0x50, 0x4b, 3, 4])), 'archive');
  assert.equal(fileKind('notes.md', encoder.encode('# hi')), 'text');
});

test('archives and NUL binaries answer unsupported and are never sent to convert', async t => {
  let calls = 0;
  const f = await fixture(t, { convert: async () => { calls++; return { text: 'x' }; } });
  f.put('bundle.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('zip body')]));
  f.put('blob.bin', Buffer.from([1, 2, 0, 3, 4]));
  for (const path of ['bundle.zip', 'blob.bin']) {
    const result = await f.run({ path });
    assert.equal(result.isError, true, path);
    assert.match(result.text, /unsupported/, path);
  }
  assert.equal(calls, 0);
});

test('the type is sniffed on the provider\'s bytes after its access check: a refused text file is not read natively', async t => {
  const f = await fixture(t, { guard: false, read: async () => ({ kind: 'denied', reason: 'no access' }) });
  f.put('notes.md', 'PRIVATE NOTES\n');
  const result = await f.run({ path: 'notes.md' });
  assert.equal(result.isError, true);
  assert.match(result.text, /^Refused: notes\.md cannot be read here \(no access\)/);
  assert.doesNotMatch(result.all, /PRIVATE NOTES/);
});

test('a converted line longer than 50 KB loses nothing: it is split into segments, reported, and the offset continues inside it', async t => {
  const line = 'x'.repeat(60_000);
  const f = await fixture(t, { convert: async () => ({ text: `head\n${line}\ntail` }) });
  f.put('wide.pdf', PDF);
  const first = await f.run({ path: 'wide.pdf' });
  assert.equal(first.text, 'head', 'the next line does not fit beside it');
  const second = await f.run({ path: 'wide.pdf', offset: 2 });
  assert.equal(second.text.length, 51_200);
  assert.match(second.notes, /longer than 50KB \(original line 2\).*split into segments/);
  assert.match(second.notes, /Use offset=3 to continue/);
  const third = await f.run({ path: 'wide.pdf', offset: 3, limit: 1 });
  assert.equal(third.text.length, 60_000 - 51_200);
  assert.equal(second.text + third.text, line, 'every byte of the line is reachable');
  assert.equal((await f.run({ path: 'wide.pdf', offset: 4 })).text, 'tail');
});

test('a long multi-byte line is split on character boundaries', async t => {
  const line = '\u00e9\u{1F600}'.repeat(10_000); // 60 000 bytes
  const f = await fixture(t, { convert: async () => ({ text: line }) });
  f.put('accents.pdf', PDF);
  const parts = [];
  for (let offset = 1; ; offset++) {
    const result = await f.run({ path: 'accents.pdf', offset });
    if (result.isError) break;
    assert.ok(Buffer.byteLength(result.text) <= 51_200);
    assert.doesNotMatch(result.text, /\uFFFD/);
    parts.push(result.text);
  }
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), line);
});

test('many short lines stop at the 50 KB byte limit with the offset of the next line', async t => {
  const body = Array.from({ length: 1000 }, (_, i) => `${String(i + 1).padStart(4, '0')}${'y'.repeat(95)}`).join('\n'); // 100 bytes per line
  const f = await fixture(t, { convert: async () => ({ text: body }) });
  f.put('rows.pdf', PDF);
  const first = await f.run({ path: 'rows.pdf' });
  const shown = first.text.split('\n').length;
  assert.ok(Buffer.byteLength(first.text) <= 51_200);
  assert.match(first.notes, new RegExp(`Showing lines 1-${shown} of 1000 \\(50KB limit\\)\\. Use offset=${shown + 1} to continue\\.`));
  assert.ok((await f.run({ path: 'rows.pdf', offset: shown + 1 })).text.startsWith(String(shown + 1).padStart(4, '0')));
});

test('pages like Pi\'s read: offset is a 1-based line, limit a line count, and the note names the offset to continue from', async t => {
  const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const f = await fixture(t, { convert: async () => ({ text: body }) });
  f.put('deck.pdf', PDF);
  const one = await f.run({ path: 'deck.pdf', limit: 10 });
  assert.equal(one.text, body.split('\n').slice(0, 10).join('\n'));
  assert.match(one.notes, /20 more lines in file\. Use offset=11 to continue\./);
  const two = await f.run({ path: 'deck.pdf', offset: 11, limit: 10 });
  assert.equal(two.text, body.split('\n').slice(10, 20).join('\n'));
  const last = await f.run({ path: 'deck.pdf', offset: 21 });
  assert.equal(last.text, body.split('\n').slice(20).join('\n'));
  assert.equal(last.notes, '');
  const beyond = await f.run({ path: 'deck.pdf', offset: 99 });
  assert.equal(beyond.isError, true);
  assert.match(beyond.all, /Offset 99 is beyond end of file \(30 lines total\)/);
});

test('a long converted text is cut at 2000 lines like Pi\'s read, with the offset to continue', async t => {
  const body = Array.from({ length: 2500 }, (_, i) => `l${i + 1}`).join('\n');
  const f = await fixture(t, { convert: async () => ({ text: body }) });
  f.put('long.pdf', PDF);
  const first = await f.run({ path: 'long.pdf' });
  assert.equal(first.text.split('\n').length, 2000);
  assert.match(first.notes, /Showing lines 1-2000 of 2500\. Use offset=2001 to continue\./);
  assert.equal((await f.run({ path: 'long.pdf', offset: 2001 })).text.split('\n').length, 500);
});

test('without convert, an image uses Pi\'s native read and any other binary file answers unsupported', async t => {
  const f = await fixture(t);
  f.put('scan.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]));
  f.put('report.pdf', PDF);
  f.put('notes.md', '# notes\n');
  const image = await f.run({ path: 'scan.png' });
  assert.equal(image.isError, true);
  assert.doesNotMatch(image.text, /unsupported/);
  const pdf = await f.run({ path: 'report.pdf' });
  assert.equal(pdf.isError, true);
  assert.match(pdf.text, /pdf file.*no converter.*unsupported/);
  assert.equal((await f.run({ path: 'notes.md' })).text, '# notes\n');
});

test('a refused provider read never converts, a missing file keeps Pi\'s own error, and too-large files are not converted', async t => {
  let calls = 0;
  const convert = async () => { calls++; return { text: 'x' }; };
  const denied = await fixture(t, { convert, read: async () => ({ kind: 'denied', reason: 'no access' }) });
  denied.put('secret.pdf', PDF);
  const refused = await denied.run({ path: 'secret.pdf' });
  assert.equal(refused.isError, true);
  assert.equal(calls, 0);
  const f = await fixture(t, { convert, maxBytes: 8 });
  f.put('big.pdf', PDF);
  const big = await f.run({ path: 'big.pdf' });
  assert.equal(big.isError, true);
  assert.match(big.text, /larger than 8 bytes/);
  assert.equal(calls, 0);
  const missing = await f.run({ path: 'nope.pdf' });
  assert.equal(missing.isError, true);
  assert.match(missing.all, /nope\.pdf/);
});

test('a conversion error is returned and not cached', async t => {
  const cache = new Map();
  let fail = true;
  const f = await fixture(t, { cache, convert: async () => fail ? { error: 'corrupt' } : { text: 'ok' } });
  f.put('broken.pdf', PDF);
  const broken = await f.run({ path: 'broken.pdf' });
  assert.equal(broken.isError, true);
  assert.match(broken.text, /corrupt/);
  assert.equal(cache.size, 0);
  fail = false;
  assert.equal((await f.run({ path: 'broken.pdf' })).text, 'ok');
});

test('the guard stays outermost: a symlinked PDF that leads outside the workspace is refused and never converted', async t => {
  let calls = 0;
  const f = await fixture(t, { convert: async () => { calls++; return { text: 'LEAK' }; } });
  writeFileSync(join(f.elsewhere, 'secret.pdf'), PDF);
  symlinkSync(join(f.elsewhere, 'secret.pdf'), join(f.workspace, 'link.pdf'));
  const result = await f.run({ path: 'link.pdf' });
  assert.equal(result.isError, true);
  assert.match(result.text, /outside the workspace/);
  assert.equal(calls, 0);
});

test('workersAiMarkdown adapts toMarkdown results to converter results', async () => {
  const seen = [];
  const ai = { toMarkdown: async input => { seen.push(input); return input.name === 'bad.pdf' ? { format: 'error', error: 'nope' } : { format: 'markdown', data: '# Title' }; } };
  const convert = workersAiMarkdown(ai);
  assert.deepEqual(await convert({ name: 'doc.pdf', mediaType: 'application/pdf', bytes: encoder.encode('x') }), { text: '# Title' });
  assert.deepEqual(await convert({ name: 'bad.pdf', mediaType: 'application/pdf', bytes: encoder.encode('x') }), { error: 'nope' });
  assert.equal(seen[0].blob.type, 'application/pdf');
});
