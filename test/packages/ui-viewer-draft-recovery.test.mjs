import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { openTextDraftSqlite } from '../fixtures/text-draft-sqlite.mjs';

const identity = { principalId: 'fictional-editor', scopeId: 'fictional-project', initiatorId: 'fictional-person' };
const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

async function resources(t, text, mediaType) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-viewer-drafts-'));
  const provider = openSqliteWorkspaces({ filename: join(directory, 'resources.sqlite'), providerId: 'fictional-documents', authorize: () => true });
  const target = { resource: { providerId: 'fictional-documents', path: 'document' }, view: { kind: 'published' } };
  const controllers = [], sessions = [];
  let writes = 0;
  const client = {
    read: request => provider.read(request, identity),
    publish: request => { writes++; return provider.publication.publish(request, identity); },
    lookup: id => provider.reconciliation.lookup(id, identity),
  };
  if (text !== null) assert.equal((await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target, expected: { kind: 'absent' }, bytes: encode(text), mediaType },
  ] }, identity)).kind, 'committed');
  const read = await client.read({ target, revision: { kind: 'latest' } });
  assert.equal(read.kind, text === null ? 'missing' : 'available');
  const session = () => {
    const value = openTextDraftSqlite({ filename: join(directory, 'drafts.sqlite'), identity });
    sessions.push(value);
    return value;
  };
  const options = storage => ({ identity, instanceId: 'viewer', epoch: 'mount', source: text === null ? { kind: 'new', target } : { kind: 'saved', snapshot: read.snapshot }, client,
    drafts: { store: storage.store, signal: storage.signal, expiresAt: storage.expiresAt, retentionMs: 60000, providerInstanceId: 'fictional-instance' } });
  t.after(() => { for (const controller of controllers) controller.dispose(); for (const storage of sessions) storage.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); });
  return { client, target, options, session, closeSession: value => { value.close(); sessions.splice(sessions.indexOf(value), 1); }, track: controller => { controllers.push(controller); return controller; }, writes: () => writes };
}

for (const [name, create, mediaType] of [['Markdown', createMarkdownController, 'text/markdown'], ['HTML', createHtmlController, 'text/html']]) {
  test(`${name}: reopen a real draft database, explicitly restore exact text, then publish normally`, async t => {
    const f = await resources(t, 'saved', mediaType);
    const storage = f.session(), first = f.track(create(f.options(storage)));
    const text = '\uFEFFUnfinished fictional 🌿 text\n';
    first.actions.edit(text);
    assert.equal((await first.actions.checkpointDraft()).kind, 'stored');
    first.dispose();
    f.closeSession(storage);
    const replacement = f.track(create({ ...f.options(f.session()), epoch: 'replacement' }));
    assert.equal(replacement.getSnapshot().text, 'saved');
    const offered = await replacement.actions.checkDrafts();
    assert.equal(offered.kind, 'offered');
    assert.equal(offered.choices.length, 1);
    assert.equal((await replacement.actions.restoreDraft(offered.choices[0].selection)).kind, 'restored');
    assert.equal(replacement.getSnapshot().text, text);
    assert.equal(replacement.getSnapshot().dirty, true);
    assert.equal(f.writes(), 0);
    const saved = await replacement.flush(replacement.actions.selection());
    assert.equal(saved.kind, 'saved');
    assert.equal(f.writes(), 1);
    assert.deepEqual(await f.client.lookup(saved.receipt.operationId), { kind: 'committed', receipt: saved.receipt });
    const read = await f.client.read({ target: f.target, revision: { kind: 'latest' } });
    assert.equal(decode(read.snapshot.bytes), text);
  });
}

const cell = { ref: 'fictional/notes', kind: 'fictional/document', version: 1 };
const layout = name => ({ format: 'boring.experience', version: 1, name, source: 'fixed',
  kinds: { 'boring/stack': 1, 'boring/cell': 1, 'fictional/document': 1 }, root: 'page', elements: {
    page: { type: 'boring/stack', props: {}, children: ['notes'] },
    notes: { type: 'boring/cell', props: { ref: cell.ref }, children: [] },
  } });
const experienceOptions = { cells: [cell], canView: () => true };

test('experience recovery keeps exact fixed text and clears existing proposal and Pin authority', async t => {
  const f = await resources(t, JSON.stringify(layout('saved')), 'application/json');
  const storage = f.session(), first = f.track(createExperienceDocumentController({ ...f.options(storage), ...experienceOptions }));
  const proposal = first.actions.propose(first.actions.selection(), layout('recovered'));
  assert.equal(proposal.kind, 'proposed');
  assert.equal(first.actions.adopt(proposal.proposalId).kind, 'applied');
  const checkpoint = await first.actions.checkpointDraft();
  assert.equal(checkpoint.kind, 'stored');
  const text = JSON.stringify(layout('recovered'), null, 2) + '\n\n';
  assert.equal((await storage.store.write({ version: 1, ref: { ...checkpoint.ref, sequence: checkpoint.ref.sequence + 1 }, text, createdAt: Date.now(), expiresAt: Date.now() + 30000 })).kind, 'stored');
  first.dispose();
  const next = f.track(createExperienceDocumentController({ ...f.options(storage), ...experienceOptions, epoch: 'replacement' }));
  const stale = next.actions.propose(next.actions.selection(), layout('stale-offer'));
  assert.equal(stale.kind, 'proposed');
  const offered = await next.actions.checkDrafts();
  assert.equal(offered.kind, 'offered');
  assert.equal((await next.actions.restoreDraft(offered.choices[0].selection)).kind, 'restored');
  assert.equal(next.getSnapshot().text, text);
  assert.equal(next.getSnapshot().descriptor.name, 'recovered');
  assert.equal(next.getSnapshot().proposal, null);
  assert.equal(next.getSnapshot().pin, null);
  assert.equal(next.actions.adopt(stale.proposalId).kind, 'stale');
  assert.equal((await next.actions.pin(next.actions.selection())).kind, 'denied');
  assert.equal(f.writes(), 0);
  assert.equal((await next.flush(next.actions.selection())).kind, 'saved');
  assert.equal(decode((await f.client.read({ target: f.target, revision: { kind: 'latest' } })).snapshot.bytes), text);
});

test('experience recovery enforces current host domain validation before replacing content', async t => {
  const f = await resources(t, JSON.stringify(layout('saved')), 'application/json');
  const storage = f.session(), first = f.track(createExperienceDocumentController({ ...f.options(storage), ...experienceOptions }));
  const proposal = first.actions.propose(first.actions.selection(), layout('forbidden-by-host'));
  first.actions.adopt(proposal.proposalId);
  assert.equal((await first.actions.checkpointDraft()).kind, 'stored');
  first.dispose();
  const next = f.track(createExperienceDocumentController({ ...f.options(storage), ...experienceOptions, epoch: 'replacement',
    validateDocument: descriptor => { if (descriptor.name !== 'saved') throw new Error('Fictional domain rejects this layout'); } }));
  const before = next.getSnapshot().text;
  const offered = await next.actions.checkDrafts();
  if (offered.kind === 'offered') assert.notEqual((await next.actions.restoreDraft(offered.choices[0].selection)).kind, 'restored');
  else assert.equal(offered.kind, 'unavailable');
  assert.equal(next.getSnapshot().text, before);
  assert.equal(next.getSnapshot().dirty, false);
  assert.equal(f.writes(), 0);
});

for (const scenario of ['saved', 'new', 'reentrant']) test(`native canvas ${scenario} recovery preserves actual document records and borrowed ownership`, async t => {
  const { Window } = await import('happy-dom');
  const window = new Window(), globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' ? window[name].bind(window) : window[name] });
  }
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const { createTLStore } = await import('@tldraw/editor');
  const { PageRecordType, DocumentRecordType, TLDOCUMENT_ID, createShapeId } = await import('@tldraw/tlschema');
  const { createCanvasController, canvasMediaType } = await import('@hachej/boring-ui-kit/canvas');
  if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  const original = createTLStore(), restoredStore = createTLStore(), mounted = [];
  t.after(async () => { for (const controller of mounted) controller.dispose(); original.dispose(); restoredStore.dispose(); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const page = PageRecordType.createId('fictional'), shape = createShapeId('fictional');
  original.put([DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional canvas' }), PageRecordType.create({ id: page, name: 'Page', index: 'a1' }), original.schema.types.shape.create({ id: shape, type: 'group', parentId: page, index: 'a1', props: {} })]);
  const f = await resources(t, scenario === 'new' ? null : JSON.stringify(original.getStoreSnapshot('document')), canvasMediaType);
  const storage = f.session(), first = f.track(createCanvasController({ ...f.options(storage), store: original }));
  mounted.push(first);
  original.put([{ ...original.get(shape), x: 42 }]);
  assert.equal((await first.actions.checkpointDraft()).kind, 'stored');
  first.dispose();
  const next = f.track(createCanvasController({ ...f.options(storage), epoch: 'replacement', store: restoredStore }));
  mounted.push(next);
  const offered = await next.actions.checkDrafts();
  assert.equal(offered.kind, 'offered');
  const choice = offered.choices.find(item => JSON.parse(item.text).store[shape]?.x === 42);
  assert.ok(choice);
  let intervened = false;
  const intervene = () => {
    if (scenario === 'reentrant' && !intervened && restoredStore.get(shape)) {
      intervened = true;
      restoredStore.put([{ ...restoredStore.get(shape), x: 99 }]);
    }
  };
  const offChange = restoredStore.sideEffects.registerAfterChangeHandler('shape', intervene);
  const offCreate = restoredStore.sideEffects.registerAfterCreateHandler('shape', intervene);
  const restored = await next.actions.restoreDraft(choice.selection);
  offChange(); offCreate();
  assert.equal(restored.kind, scenario === 'reentrant' ? 'conflict' : 'restored');
  assert.equal(intervened, scenario === 'reentrant');
  const expectedX = scenario === 'reentrant' ? 99 : 42;
  assert.equal(restoredStore.get(shape).x, expectedX);
  assert.equal(next.getSnapshot().dirty, true);
  assert.equal(f.writes(), 0);
  assert.equal((await next.flush(next.actions.selection())).kind, 'saved');
  const published = await f.client.read({ target: f.target, revision: { kind: 'latest' } });
  assert.equal(JSON.parse(decode(published.snapshot.bytes)).store[shape].x, expectedX);
  next.dispose();
  restoredStore.put([{ ...restoredStore.get(shape), x: 43 }]);
  assert.equal(restoredStore.get(shape).x, 43);
});
