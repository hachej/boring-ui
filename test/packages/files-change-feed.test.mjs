// Ruling 2 (2026-10-10): agent writes are observed, never receipted, and every file view invalidates from one change feed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { blobRevision, createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { connectRevisionProvider, RevisionError } from '@hachej/boring-files/revision';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';

const access = { principalId: 'fictional-person', scopeId: 'fictional-scope', initiatorId: 'fictional-person' };
const encoder = new TextEncoder();
const target = path => ({ resource: { providerId: 'files', path }, view: { kind: 'published' } });
const create = (operationId, path, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
const revisionOf = text => blobRevision(encoder.encode(text));
const within = (promise, ms, what) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
};
const changesOnly = events => events.filter(event => event.kind === 'change').map(({ path, revision, source }) => ({ path, revision, source }));

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-change-feed-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const provider = createWorkspaceProvider({ fs, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' }, watchLingerMs: 10, ...options });
  const receipts = () => Number(db.get('SELECT (SELECT count(*) FROM boring_operations) + (SELECT count(*) FROM boring_intents) AS count').count);
  const write = async (path, text) => assert.equal((await fs.writeFile(`/workspace/${path}`, text, BACKGROUND_CONTEXT)).ok, true);
  let released = 0, resolves = 0, authorized = true, revoke = new AbortController();
  const handler = createRevisionHandler({ heartbeatMs: 20, resolve: async () => {
    resolves++;
    return authorized ? { provider, access: { ...access, signal: revoke.signal }, release: () => { released++; } } : null;
  } });
  t.after(() => { revoke.abort(); db.close(); rmSync(directory, { force: true, recursive: true }); });
  return {
    provider, fs, db, receipts, write, handler, released: () => released, resolves: () => resolves,
    deny: () => { authorized = false; }, revoke: () => { revoke.abort(); revoke = new AbortController(); },
    publish: request => provider.publication.publish(request, access),
  };
}

/** Read the feed until `done(events)` holds, then stop it. */
async function until(feed, done, ms = 3000) {
  const events = [];
  await within((async () => { for await (const event of feed) { events.push(event); if (done(events)) return; } })(), ms, 'waiting for change events');
  return events;
}

test('record: an agent write gets a history entry with source agent and a change event, never a journal receipt', async t => {
  const { provider, receipts, write } = fixture(t);
  const start = provider.changeHead();
  await write('notes.md', 'draft\n');
  await write('notes.md', 'edited by the agent\n');
  const before = encoder.encode('draft\n'), after = await revisionOf('edited by the agent\n'), replaced = await blobRevision(before);
  await provider.queue.run(() => provider.record({ path: 'notes.md', before: { revision: replaced, bytes: before }, after, source: 'agent', conversationId: '7' }, access));
  assert.deepEqual(provider.saves('notes.md').map(save => [save.revision, save.source]), [[after, 'agent'], [await blobRevision(before), 'observed']]);
  assert.deepEqual((await provider.catalog.history('notes.md', access)).map(save => save.source), ['agent', 'observed']);
  assert.equal(receipts(), 0, 'no operation, receipt or intent row');
  const preimage = await provider.read({ target: target('notes.md'), revision: { kind: 'exact', value: await blobRevision(before) } }, access);
  assert.equal(new TextDecoder().decode(preimage.snapshot.bytes), 'draft\n', 'the replaced version is readable from history');
  const abort = new AbortController();
  const events = await until(provider.changes({ since: start, signal: abort.signal }, access), list => list.length === 1);
  abort.abort();
  assert.equal(events[0].kind, 'change');
  assert.deepEqual({ ...events[0], seq: undefined, at: undefined }, { kind: 'change', path: 'notes.md', revision: after, source: 'agent', conversationId: '7', seq: undefined, at: undefined });
  // A pre-image whose bytes are not the named revision is not kept; when the file moved on (a shell in between) only the event is recorded.
  await write('notes.md', 'shell wrote this\n');
  await provider.record({ path: 'notes.md', before: { revision: after, bytes: encoder.encode('forged') }, after: await revisionOf('what the agent thought'), source: 'agent' }, access);
  assert.equal(provider.saves('notes.md').length, 2);
  await assert.rejects(provider.record({ path: 'notes.md', after, source: 'publish' }, access), TypeError);
});

test('record never re-enters the provider queue: called from queued work (the file guard) it finishes and the queue keeps running', async t => {
  const { provider, write } = fixture(t);
  await write('a.md', 'agent\n');
  const after = await revisionOf('agent\n');
  await within(provider.queue.run(() => provider.record({ path: 'a.md', after, source: 'agent' }, access)), 2000, 'record inside the queue');
  assert.equal(await within(provider.queue.run(async () => 'next'), 1000, 'the next queued piece'), 'next');
  assert.deepEqual(provider.saves('a.md').map(save => save.source), ['agent']);
});

test('a direct file system write found by poll is a change event and no history; the full poll reports new and removed files after its baseline', async t => {
  const { provider, write, fs, publish } = fixture(t);
  const start = provider.changeHead();
  assert.equal((await publish(create('seed', 'a.md', 'one'))).kind, 'committed');
  await write('a.md', 'shell\n');
  assert.deepEqual(await provider.poll(['a.md']), [{ path: 'a.md', revision: await revisionOf('shell\n'), source: 'poll' }]);
  assert.deepEqual(provider.saves('a.md').map(save => [save.revision, save.source]), [[await revisionOf('one'), 'publish']], 'polling adds no history');
  assert.deepEqual(await provider.poll(), [], 'the first full poll takes the baseline');
  await write('b.md', 'new\n');
  assert.equal((await fs.remove('/workspace/a.md', {}, BACKGROUND_CONTEXT)).ok, true);
  assert.deepEqual(await provider.poll(), [{ path: 'b.md', revision: await revisionOf('new\n'), source: 'poll' }, { path: 'a.md', revision: null, source: 'poll' }]);
  assert.deepEqual(await provider.poll(), []);
  const abort = new AbortController();
  const events = await until(provider.changes({ since: start, signal: abort.signal }, access), list => list.length === 4);
  abort.abort();
  assert.deepEqual(changesOnly(events).map(event => `${event.source}:${event.path}`), ['publish:a.md', 'poll:a.md', 'poll:b.md', 'poll:a.md']);
  assert.ok(events.every((event, index) => index === 0 || event.seq > events[index - 1].seq), 'seq increases');
});

test('the feed replays from since, and a cursor outside the retained window, from another lifetime or a lagging listener reads as resnapshot', async t => {
  const { provider, publish } = fixture(t, { changeBuffer: 2 });
  const start = provider.changeHead();
  for (const name of ['a', 'b', 'c', 'd']) assert.equal((await publish(create(name, `${name}.md`, name))).kind, 'committed');
  const head = provider.changeHead();
  assert.equal(head, start + 4);
  const first = async since => { const abort = new AbortController(); const [event] = await until(provider.changes({ since, signal: abort.signal }, access), () => true); abort.abort(); return event; };
  const evicted = await first(start);
  assert.deepEqual([evicted.kind, evicted.seq], ['resnapshot', head], 'events after start were evicted: reload, then continue from the head');
  assert.equal((await first(5)).kind, 'resnapshot', 'a cursor from another provider lifetime');
  assert.equal((await first(head + 10)).kind, 'resnapshot', 'a cursor ahead of this lifetime');
  const replay = new AbortController();
  const retained = await until(provider.changes({ since: head - 2, signal: replay.signal }, access), list => list.length === 2);
  replay.abort();
  assert.deepEqual(retained.map(event => event.path), ['c.md', 'd.md']);
  // A listener that falls behind while subscribed gets a resnapshot, then what is still retained.
  const lagging = new AbortController();
  const iterator = provider.changes({ since: head, signal: lagging.signal }, access)[Symbol.asyncIterator]();
  const pending = iterator.next();
  assert.equal((await publish(create('e', 'e.md', 'e'))).kind, 'committed');
  const seen = [(await within(pending, 1000, 'e')).value];
  for (const name of ['f', 'g', 'h']) assert.equal((await publish(create(name, `${name}.md`, name))).kind, 'committed');
  for (let index = 0; index < 3; index++) seen.push((await within(iterator.next(), 1000, 'the lagging listener')).value);
  lagging.abort();
  await iterator.return?.();
  assert.deepEqual(seen.map(event => event.kind === 'change' ? event.path : event.kind), ['e.md', 'resnapshot', 'g.md', 'h.md']);
  assert.equal(seen[1].seq, seen[2].seq - 1, 'the resnapshot continues right before the oldest retained event');
});

test('the SQLite file system notifies its watchers of its own writes at once, and the provider feed carries them as watch events', async t => {
  const { provider, fs, write } = fixture(t);
  const reported = [];
  let wake;
  const watcher = await fs.watch([{ path: '/workspace', recursive: true }], change => { reported.push(change); wake?.(); }, BACKGROUND_CONTEXT);
  assert.equal(watcher.ok, true);
  t.after(() => watcher.value.close(BACKGROUND_CONTEXT));
  const started = Date.now();
  const arrived = new Promise(resolve => { wake = resolve; });
  await write('pushed.md', 'now');
  await within(arrived, 500, 'the push notification (the polling interval is one second)');
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(reported, [{ paths: ['/workspace/pushed.md'] }]);
  // Through the provider: a write by the SQLite file system (bash in the virtual workspace writes this way) reaches the feed.
  const abort = new AbortController();
  const iterator = provider.changes({ signal: abort.signal }, access)[Symbol.asyncIterator]();
  const next = iterator.next();
  await new Promise(resolve => setTimeout(resolve, 20));
  await write('from-bash.md', 'bash');
  const { value } = await within(next, 500, 'the watch event');
  abort.abort();
  await iterator.return?.();
  assert.deepEqual({ path: value.path, revision: value.revision, source: value.source }, { path: 'from-bash.md', revision: await revisionOf('bash'), source: 'watch' });
});

// ---- HTTP: GET ?op=changes ------------------------------------------------------------------------------------------------------

const connect = handler => connectRevisionProvider({ endpoint: 'https://fictional.invalid/files', fetch: handler });
const bindingOf = async handler => encodeURIComponent(JSON.stringify(await (await handler(new Request('https://fictional.invalid/files'))).json()));
const changeRequest = (binding, query, signal) => new Request(`https://fictional.invalid/files?op=changes${query}`, { headers: binding ? { 'x-boring-workspace': binding } : {}, ...(signal ? { signal } : {}) });

test('SSE: the client replays from since and then follows live events; the stream is event-stream framed with heartbeats', async t => {
  const f = fixture(t);
  const client = await connect(f.handler);
  const since = f.provider.changeHead();
  assert.equal((await client.publish({ ...create('one', 'one.md', '1'), changes: [{ ...create('one', 'one.md', '1').changes[0], target: client.locate('one.md') }] })).kind, 'committed');
  assert.equal((await client.publish({ ...create('two', 'two.md', '2'), changes: [{ ...create('two', 'two.md', '2').changes[0], target: client.locate('two.md') }] })).kind, 'committed');
  const abort = new AbortController();
  const iterator = client.changes({ since, signal: abort.signal })[Symbol.asyncIterator]();
  const replayed = [(await within(iterator.next(), 2000, 'replay')).value, (await within(iterator.next(), 2000, 'replay')).value];
  assert.deepEqual(replayed.map(event => [event.path, event.source]), [['one.md', 'publish'], ['two.md', 'publish']]);
  assert.equal(replayed[1].seq, since + 2);
  const live = iterator.next();
  await f.provider.queue.run(async () => { await f.write('three.md', '3'); await f.provider.record({ path: 'three.md', after: await revisionOf('3'), source: 'agent' }, access); });
  const event = await within(live, 2000, 'the live event');
  assert.equal(event.value.path, 'three.md');
  abort.abort();
  await iterator.return?.();
  // The wire format.
  const raw = new AbortController();
  const response = await f.handler(changeRequest(await bindingOf(f.handler), `&since=${since}`, raw.signal));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  let text = '';
  while (!/: heartbeat/.test(text) || !/event: change/.test(text)) text += new TextDecoder().decode((await within(reader.read(), 2000, 'stream bytes')).value);
  raw.abort();
  await reader.cancel();
  assert.match(text, /^event: ready\ndata: \{"seq":\d+\}\n\n/);
  assert.match(text, new RegExp(`id: ${since + 1}\nevent: change\ndata: \\{"kind":"change","path":"one.md"`));
});

test('SSE: an unauthorized or mismatched consumer gets no events, revocation ends the stream, and every lease is released on disconnect', async t => {
  const f = fixture(t);
  const binding = await bindingOf(f.handler);
  const client = await connect(f.handler);
  // No binding header, another identity, a bad cursor.
  assert.equal((await f.handler(changeRequest(undefined, ''))).status, 403);
  const other = JSON.parse(decodeURIComponent(binding)); other.identity.principalId = 'someone-else';
  assert.equal((await f.handler(changeRequest(encodeURIComponent(JSON.stringify(other)), ''))).status, 409);
  assert.equal((await f.handler(changeRequest(binding, '&since=-1'))).status, 400);
  assert.equal((await f.handler(new Request('https://fictional.invalid/files?op=other', { headers: { 'x-boring-workspace': binding } }))).status, 400);
  assert.equal(f.released(), f.resolves(), 'refused requests released their lease');
  // A disconnect releases the lease the stream held.
  const disconnect = new AbortController();
  const open = await f.handler(changeRequest(binding, '', disconnect.signal));
  assert.equal(open.status, 200);
  const reader = open.body.getReader();
  await within(reader.read(), 1000, 'the ready event');
  assert.equal(f.released(), f.resolves() - 1, 'the open stream holds its lease');
  disconnect.abort();
  await reader.cancel();
  await within((async () => { while (f.released() !== f.resolves()) await new Promise(resolve => setTimeout(resolve, 5)); })(), 1000, 'the lease release');
  // Revoked access ends the stream: nothing written afterwards is delivered.
  const revoked = await f.handler(changeRequest(binding, ''));
  const body = revoked.body.getReader();
  await within(body.read(), 1000, 'the ready event');
  f.revoke();
  await f.write('after-revocation.md', 'secret');
  let rest = '';
  for (;;) { const { done, value } = await within(body.read(), 1000, 'the end of the revoked stream'); if (done) break; rest += new TextDecoder().decode(value); }
  assert.doesNotMatch(rest, /after-revocation/);
  await within((async () => { while (f.released() !== f.resolves()) await new Promise(resolve => setTimeout(resolve, 5)); })(), 1000, 'the lease release after revocation');
  // A consumer the host refuses gets a RevisionError and no events.
  f.deny();
  const denied = [];
  await assert.rejects((async () => { for await (const event of client.changes({})) denied.push(event); })(), error => error instanceof RevisionError && error.kind === 'denied');
  assert.deepEqual(denied, []);
});
