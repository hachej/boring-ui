// The page side of the view-open acknowledgement (registry/pi-chat/artifact.ts: `pendingPresents`, `createPresentAcks`;
// registry/pi-app/artifact-panel.tsx: the mount report). The real bookkeeping is exercised with a fake chat answer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/present-ack-test`;
mkdirSync(out, { recursive: true });
async function load(name, entry) {
  await build({ entryPoints: [`${root}registry/${entry}`], outfile: `${out}/${name}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(`${out}/${name}.mjs`).href);
}

const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const assistant = content => ({ role: 'assistant', content });
const result = toolCallId => ({ role: 'toolResult', toolCallId, content: [{ type: 'text', text: '{}' }] });
const view = (messages, live = true) => ({ entries: [{ id: 3, model: messages }, { id: 5, model: [assistant([call('c2', 'present', { path: 'b.md' })])] }],
  docs: live ? { 'pi.live': { run: { id: 'fictional' } } } : {} });
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const context = (overrides = {}) => ({ closedThisTurn: false, unsaved: false, narrow: false, autoOpen: true, showing: () => false, ...overrides });
const pendingCall = (id, path) => ({ id, callId: id, path });

test('pendingPresents lists the present calls with no result, while the run is live, with the answer ID the server binds', async () => {
  const { pendingPresents } = await load('artifact', 'pi-chat/artifact.ts');
  const messages = [assistant([call('c1', 'present', { path: './a.md' }), call('c9', 'read', { path: 'x' })])];
  assert.deepEqual(pendingPresents(view(messages)), [{ id: '[3,"c1"]', callId: 'c1', path: 'a.md' }, { id: '[5,"c2"]', callId: 'c2', path: 'b.md' }]);
  assert.deepEqual(pendingPresents(view(messages, false)), [], 'nothing waits once the run is not live');
  assert.deepEqual(pendingPresents(view([...messages, result('c1')])).map(item => item.callId), ['c2'], 'a call with a result is no longer pending');
  assert.deepEqual(pendingPresents(view([assistant([call('c3', 'present', { path: 7 })])])).map(item => item.callId), ['c2'], 'a non-text path is ignored');
  assert.deepEqual(pendingPresents(undefined), []);
});

/** A fake chat answer that records what the page sent; `verdict(id, body)` returns the server's kind. */
async function fakeChat(verdict = () => ({ kind: 'answered' })) {
  const sent = [];
  const answer = async (id, body) => { const parsed = JSON.parse(body); sent.push({ id, ...parsed }); return verdict(id, parsed); };
  const { createPresentAcks } = await load('artifact', 'pi-chat/artifact.ts');
  const make = (extra = {}) => createPresentAcks({ answer, open: () => true, instanceId: 'tab-1', wait: async () => {}, ...extra });
  return { sent, make };
}

test('createPresentAcks refuses on purpose: closed this turn, unsaved edits, a phone, and a file that will not open', async () => {
  const { sent, make } = await fakeChat();
  const acks = make({ open: () => false });
  acks.consider([pendingCall('c1', 'a.md')], context({ closedThisTurn: true }));
  acks.consider([pendingCall('c2', 'a.md')], context({ unsaved: true }));
  acks.consider([pendingCall('c3', 'a.md')], context({ narrow: true }));
  acks.consider([pendingCall('c4', 'a.md')], context());
  await flush();
  assert.deepEqual(sent, [
    { id: 'c1', kind: 'refused', reason: 'closed by user' },
    { id: 'c2', kind: 'refused', reason: 'unsaved changes' },
    { id: 'c3', kind: 'refused', reason: 'narrow screen' },
    { id: 'c4', kind: 'refused', reason: 'unsaved changes' },
  ]);
  assert.deepEqual(acks.waiting(), []);
});

test('createPresentAcks with autoOpen off does not open the panel; the call waits for a manual open and is confirmed by its mount', async t => {
  const { sent, make } = await fakeChat();
  let opened = 0;
  const acks = make({ open: () => { opened += 1; return true; } });
  acks.consider([pendingCall('c1', 'a.md')], context({ autoOpen: false }));
  await flush();
  assert.equal(opened, 0, 'no opener call when autoOpen is off');
  assert.deepEqual(sent, [], 'nothing is answered before a viewer mounts it');
  assert.deepEqual(acks.waiting(), ['c1']);
  acks.shown({ path: 'other.md', revision: 'r0' });
  await flush();
  assert.deepEqual(sent, [], 'another file mounting does not confirm it');
  acks.shown({ path: 'a.md', revision: 'r1' });
  await flush();
  assert.deepEqual(sent, [{ id: 'c1', kind: 'opened', instanceId: 'tab-1', path: 'a.md', revision: 'r1' }]);
  assert.deepEqual(acks.waiting(), []);
  t.diagnostic('manual open confirmed by the mount report');
});

test('createPresentAcks: a stale-revision shortcut that the server denies keeps the call waiting, and the next mount of the new revision confirms it', async () => {
  // The panel shows revision A; the agent writes B and presents it before the viewer reloads. The server accepts only B.
  const { sent, make } = await fakeChat((id, body) => body.revision === 'B' ? { kind: 'answered' } : { kind: 'denied', reason: 'another revision' });
  const acks = make();
  acks.shown({ path: 'a.md', revision: 'A' });
  acks.consider([pendingCall('c1', 'a.md')], context({ showing: () => true }));
  await flush();
  assert.deepEqual(sent.map(item => item.revision), ['A'], 'the shortcut sends the shown revision A');
  assert.deepEqual(acks.waiting(), ['c1'], 'a denial keeps the call waiting');
  acks.shown({ path: 'a.md', revision: 'B' });
  await flush();
  assert.deepEqual(sent.map(item => [item.kind, item.revision]), [['opened', 'A'], ['opened', 'B']]);
  assert.deepEqual(acks.waiting(), [], 'answered once B is mounted');
});

test('createPresentAcks decides each call once, however often the view reports it', async () => {
  const { sent, make } = await fakeChat();
  const acks = make();
  const calls = [pendingCall('c1', 'a.md')];
  acks.consider(calls, context({ closedThisTurn: true }));
  acks.consider(calls, context({ closedThisTurn: true }));
  await flush();
  assert.equal(sent.length, 1);
});

test('createPresentAcks retries an answer the server has not recorded yet, and stops at its bound (the real retry)', async () => {
  // Unknown until the third try: the record is written late, as it is when the page sees the call first.
  let tries = 0;
  const { sent, make } = await fakeChat(() => { tries += 1; return tries < 3 ? { kind: 'unknown-question' } : { kind: 'answered' }; });
  make().consider([pendingCall('c1', 'a.md')], context({ closedThisTurn: true }));
  await flush();
  assert.equal(tries, 3, 'retried until recorded');
  assert.equal(sent.length, 3);

  // Never recorded: the clock bound stops the retries (each try advances the fake clock by one second).
  let clock = 0, never = 0;
  const { make: makeNever } = await fakeChat(() => { never += 1; return { kind: 'unknown-question' }; });
  makeNever({ now: () => { clock += 1000; return clock; } }).consider([pendingCall('c2', 'a.md')], context({ closedThisTurn: true }));
  await flush();
  assert.ok(never >= 2 && never <= 5, `bounded retries, got ${never}`);
});

test('useReportShown reports the revision once its viewer has mounted it, and not for an unknown revision', async () => {
  const { useReportShown } = await load('artifact-panel', 'pi-app/artifact-panel.tsx');
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const window = new Window({ url: 'https://fictional.invalid/' });
  globalThis.window = window; globalThis.document = window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const reports = [];
  const onShown = shown => reports.push(shown);
  const Probe = ({ revision }) => { useReportShown(onShown, 'a.md', revision); return null; };
  const root = createRoot(container);
  await act(async () => { root.render(createElement(Probe, { revision: undefined })); });
  assert.deepEqual(reports, [], 'nothing is reported while the viewer has no revision');
  await act(async () => { root.render(createElement(Probe, { revision: 'rev-1' })); });
  assert.deepEqual(reports, [{ path: 'a.md', revision: 'rev-1' }]);
  await act(async () => { root.render(createElement(Probe, { revision: 'rev-1' })); });
  assert.equal(reports.length, 1, 'the same revision is not reported again');
  await act(async () => { root.unmount(); });
  delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test('the artifact panel reports a mount for a built-in viewer, and never for a host viewer or the canvas', async () => {
  const { ArtifactPanel } = await load('artifact-panel', 'pi-app/artifact-panel.tsx');
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const window = new Window({ url: 'https://fictional.invalid/' });
  globalThis.window = window; globalThis.document = window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const bytes = new TextEncoder().encode('const x = 1;\n');
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-code', providerId: 'fictional', path: 'a.js' } } }),
    saves: async () => [], search: async () => [] };
  const descriptor = (type, path = 'a.js') => ({ schema: 'boring.artifact', version: 1, title: path, type, mediaType: 'text/plain', language: 'javascript',
    target: { resource: { providerId: 'fictional', path }, view: { kind: 'published' } }, revision: 'rev-code' });
  async function mount(artifact, viewers) {
    const reports = [];
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = createRoot(container);
    const options = { client, identity: { runtimeId: 'fictional' }, viewers, onShown: shown => reports.push(shown) };
    await act(async () => { root.render(createElement(ArtifactPanel, { active: { descriptor: artifact, follow: true }, versions: [artifact], options, onSelect: () => {}, onClose: () => {} })); });
    for (let i = 0; i < 10; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    await act(async () => { root.unmount(); });
    return reports;
  }
  try {
    assert.deepEqual(await mount(descriptor('code')), [{ path: 'a.js', revision: 'rev-code' }], 'the built-in code viewer reports the revision it shows');
    const hostCode = { code: () => createElement('div', null, 'host') };
    assert.deepEqual(await mount(descriptor('code'), hostCode), [], 'a host viewer never reports a mount');
    assert.deepEqual(await mount(descriptor('canvas', 'board.tldraw')), [], 'the canvas "no viewer" note never reports a mount');
  } finally {
    delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
