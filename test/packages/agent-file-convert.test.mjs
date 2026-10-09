import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createConvertedTextTool, workersAiMarkdown } from '@hachej/boring-agent/file-convert';

const encoder = new TextEncoder();
const access = { scopeId: 'fictional-team', principalId: 'fictional-member', initiatorId: 'fictional-requester' };
const target = path => ({ resource: { providerId: 'files', path }, view: { kind: 'published' } });
const ROOT = '/workspace';

async function fixture(t, options = {}) {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'files', authorize: options.authorize ?? (() => true) });
  t.after(() => provider.close());
  let sequence = 0;
  const publish = async (path, bytes, mediaType = 'application/octet-stream') => {
    const outcome = await provider.publication.publish({ operationId: `seed-${++sequence}`, atomicity: 'all-or-nothing',
      changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: typeof bytes === 'string' ? encoder.encode(bytes) : bytes, mediaType }] }, access);
    assert.equal(outcome.kind, 'committed');
    return outcome.receipt.changes[0].after;
  };
  const replace = async (ref, bytes) => {
    const outcome = await provider.publication.publish({ operationId: `replace-${++sequence}`, atomicity: 'all-or-nothing',
      changes: [{ kind: 'replace', target: ref, bytes: typeof bytes === 'string' ? encoder.encode(bytes) : bytes, mediaType: 'application/pdf' }] }, access);
    assert.equal(outcome.kind, 'committed');
    return outcome.receipt.changes[0].after;
  };
  const binding = { files: provider, root: ROOT, access };
  const api = { conversationId: 'fictional-conversation', agent: async () => ({}) };
  const call = (tool, args) => tool.execute(args, api, {});
  const parse = result => JSON.parse(result.content[0].text);
  return { provider, publish, replace, binding, call, parse };
}

test('a non-text file is converted once per saved revision, and the converted text is cached', async t => {
  const f = await fixture(t);
  await f.publish('report.pdf', 'fake pdf bytes', 'application/pdf');
  let calls = 0;
  const cache = new Map();
  const tool = createConvertedTextTool({ workspace: f.binding, cache, convert: async ({ name }) => { calls++; return { text: `text of ${name}` }; } });
  const first = f.parse(await f.call(tool, { path: 'report.pdf' }));
  const second = f.parse(await f.call(tool, { path: 'report.pdf' }));
  assert.equal(first.kind, 'available');
  assert.equal(first.text, 'text of report.pdf');
  assert.equal(first.cached, undefined);
  assert.equal(second.cached, true);
  assert.equal(calls, 1, 'one revision converts once');
  assert.equal(cache.size, 1);
});

test('a new saved revision of the file converts again', async t => {
  const f = await fixture(t);
  const ref = await f.publish('scan.pdf', 'first version', 'application/pdf');
  let calls = 0;
  const tool = createConvertedTextTool({ workspace: f.binding, cache: new Map(), convert: async ({ bytes }) => { calls++; return { text: new TextDecoder().decode(bytes) }; } });
  assert.equal(f.parse(await f.call(tool, { path: 'scan.pdf' })).text, 'first version');
  await f.replace(ref, 'second version');
  assert.equal(f.parse(await f.call(tool, { path: 'scan.pdf' })).text, 'second version');
  assert.equal(calls, 2);
});

test('pages: the first page, then next, then the last page without next', async t => {
  const f = await fixture(t);
  await f.publish('deck.pptx', 'x');
  const body = 'abcdefghij'.repeat(3);
  const tool = createConvertedTextTool({ workspace: f.binding, pageSize: 10, convert: async () => ({ text: body }) });
  const one = f.parse(await f.call(tool, { path: 'deck.pptx' }));
  assert.deepEqual([one.characters, one.offset, one.next, one.text], [30, 0, 10, body.slice(0, 10)]);
  const two = f.parse(await f.call(tool, { path: 'deck.pptx', offset: one.next }));
  assert.deepEqual([two.offset, two.next, two.text], [10, 20, body.slice(10, 20)]);
  const three = f.parse(await f.call(tool, { path: 'deck.pptx', offset: two.next }));
  assert.equal(three.next, undefined);
  assert.equal(three.text, body.slice(20));
  assert.equal(f.parse(await f.call(tool, { path: 'deck.pptx', offset: 31 })).kind, 'denied');
});

test('a page never splits a surrogate pair', async t => {
  const f = await fixture(t);
  await f.publish('emoji.pdf', 'x');
  const tool = createConvertedTextTool({ workspace: f.binding, pageSize: 3, convert: async () => ({ text: 'ab\u{1F600}cd' }) });
  const first = f.parse(await f.call(tool, { path: 'emoji.pdf' }));
  assert.equal(first.text, 'ab');
  assert.equal(first.next, 2);
  const second = f.parse(await f.call(tool, { path: 'emoji.pdf', offset: first.next }));
  assert.equal(second.text, '\u{1F600}c');
});

test('without convert, a non-text file answers unsupported and a text file is refused', async t => {
  const f = await fixture(t);
  await f.publish('image.png', 'png bytes', 'image/png');
  await f.publish('notes.md', '# notes');
  const tool = createConvertedTextTool({ workspace: f.binding });
  assert.equal(f.parse(await f.call(tool, { path: 'image.png' })).kind, 'unsupported');
  assert.equal(f.parse(await f.call(tool, { path: 'notes.md' })).kind, 'denied');
});

test('a file that is not in the workspace is missing, and a refused read is denied without convert', async t => {
  const f = await fixture(t, { authorize: (action) => action !== 'read' });
  await f.publish('secret.pdf', 'pdf');
  let calls = 0;
  const tool = createConvertedTextTool({ workspace: f.binding, convert: async () => { calls++; return { text: 'x' }; } });
  assert.equal(f.parse(await f.call(tool, { path: 'secret.pdf' })).kind, 'denied');
  assert.equal(calls, 0, 'a refused read never converts');
  const open = await fixture(t);
  const openTool = createConvertedTextTool({ workspace: open.binding, convert: async () => ({ text: 'x' }) });
  assert.equal(open.parse(await open.call(openTool, { path: 'nope.pdf' })).kind, 'missing');
});

test('a conversion error is returned and not cached', async t => {
  const f = await fixture(t);
  await f.publish('broken.pdf', 'pdf');
  const cache = new Map();
  let fail = true;
  const tool = createConvertedTextTool({ workspace: f.binding, cache, convert: async () => fail ? { error: 'corrupt' } : { text: 'ok' } });
  assert.deepEqual(f.parse(await f.call(tool, { path: 'broken.pdf' })), { kind: 'unavailable', reason: 'corrupt' });
  assert.equal(cache.size, 0);
  fail = false;
  assert.equal(f.parse(await f.call(tool, { path: 'broken.pdf' })).text, 'ok');
});

test('workersAiMarkdown adapts toMarkdown results to converter results', async () => {
  const seen = [];
  const ai = { toMarkdown: async input => { seen.push(input); return input.name === 'bad.pdf' ? { format: 'error', error: 'nope' } : { format: 'markdown', data: '# Title' }; } };
  const convert = workersAiMarkdown(ai);
  assert.deepEqual(await convert({ name: 'doc.pdf', mediaType: 'application/pdf', bytes: encoder.encode('x') }), { text: '# Title' });
  assert.deepEqual(await convert({ name: 'bad.pdf', mediaType: 'application/pdf', bytes: encoder.encode('x') }), { error: 'nope' });
  assert.equal(seen[0].blob.type, 'application/pdf');
});
