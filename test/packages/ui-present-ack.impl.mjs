// The page side of the view-open acknowledgement (registry/pi-chat/artifact.ts: `pendingPresents`, `createPresentAcks`;
// registry/pi-app/artifact-panel.tsx: the mount report). The real bookkeeping is exercised with a fake chat answer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

function installDom(window) {
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  return () => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } };
}

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
  const restore = installDom(window);
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
  restore(); await window.happyDOM.close();
});

/** The ArtifactPanel fixture: a fictional workspace file `a.js` at revision `rev-code`, read through a fake resource client. */
function panelFixture() {
  const bytes = new TextEncoder().encode('const x = 1;\n');
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-code', providerId: 'fictional', path: 'a.js' } } }),
    saves: async () => [], search: async () => [] };
  const descriptor = (type, path = 'a.js') => ({ schema: 'boring.artifact', version: 1, title: path, type, mediaType: 'text/plain', language: 'javascript',
    target: { resource: { providerId: 'fictional', path }, view: { kind: 'published' } }, revision: 'rev-code' });
  return { client, descriptor };
}

test('the artifact panel reports a mount for a built-in viewer, and never for a host viewer or the canvas', async () => {
  const { ArtifactPanel } = await load('artifact-panel', 'pi-app/artifact-panel.tsx');
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const restore = installDom(window);
  const { client, descriptor } = panelFixture();
  async function mount(artifact, viewers) {
    const reports = [];
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = createRoot(container);
    const options = { client, identity: { runtimeId: 'fictional' }, viewers, onShown: shown => reports.push(shown) };
    try {
      await act(async () => { root.render(createElement(ArtifactPanel, { active: { descriptor: artifact, follow: true }, versions: [artifact], options, onSelect: () => {}, onClose: () => {} })); });
      for (let i = 0; i < 10; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    } finally {
      await act(async () => { root.unmount(); });
    }
    return reports;
  }
  try {
    assert.deepEqual(await mount(descriptor('code')), [{ path: 'a.js', revision: 'rev-code' }, { path: 'a.js', revision: 'rev-code', hidden: true }],
      'the built-in code viewer reports the revision it shows, and that it stopped showing it when it unmounts');
    const hostCode = { code: () => createElement('div', null, 'host') };
    assert.deepEqual(await mount(descriptor('code'), hostCode), [], 'a host viewer never reports a mount');
    assert.deepEqual(await mount(descriptor('canvas', 'board.tldraw')), [], 'the canvas "no viewer" note never reports a mount');
  } finally {
    restore(); await window.happyDOM.close();
  }
});

test('an answer in flight keeps its call waiting, so a mount during the flight still confirms it', async () => {
  // The page shows A, its answer is held; then B mounts while A is in flight. The server accepts B.
  const sent = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const answer = async (id, body) => { const parsed = JSON.parse(body); sent.push(parsed.revision); return parsed.revision === 'A' ? held : { kind: 'answered' }; };
  const { createPresentAcks } = await load('artifact', 'pi-chat/artifact.ts');
  const acks = createPresentAcks({ answer, open: () => true, instanceId: 'tab-1', wait: async () => {} });
  acks.consider([pendingCall('c1', 'a.md')], context({ autoOpen: false }));
  acks.shown({ path: 'a.md', revision: 'A' });
  acks.shown({ path: 'a.md', revision: 'B' });
  await flush();
  assert.deepEqual(sent, ['A', 'B'], 'the mount of B is answered while A is still in flight');
  assert.deepEqual(acks.waiting(), [], 'B is accepted, so the call is done');
  release({ kind: 'denied', reason: 'another revision' });
  await flush();
  assert.deepEqual(sent, ['A', 'B'], 'the late denial of A sends nothing more');
});

test('createPresentAcks forgets decided calls and waits that are no longer live', async () => {
  const { sent, make } = await fakeChat();
  const acks = make();
  acks.consider([pendingCall('c1', 'a.md')], context({ autoOpen: false }));
  assert.deepEqual(acks.waiting(), ['c1']);
  acks.consider([], context({ autoOpen: false }));
  assert.deepEqual(acks.waiting(), [], 'a call that is no longer pending is not waited for');
  acks.consider([pendingCall('c1', 'a.md')], context({ closedThisTurn: true }));
  await flush();
  assert.equal(sent.length, 1, 'a call that left the view and came back is decided again');
});

test('a built-in viewer that a custom viewer replaces on the same path takes its mount with it: a presented call is not confirmed', async () => {
  const { ArtifactPanel } = await load('artifact-panel', 'pi-app/artifact-panel.tsx');
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const restore = installDom(window);
  const { client, descriptor } = panelFixture();
  let root;
  try {
    const { sent, make } = await fakeChat();
    const acks = make({ open: () => true });
    const reports = [];
    const onShown = shown => { reports.push(shown); if (shown.hidden) acks.hidden(shown); else acks.shown(shown); };
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    root = createRoot(container);
    const render = async viewers => {
      const options = { client, identity: { runtimeId: 'fictional' }, viewers, onShown };
      await act(async () => { root.render(createElement(ArtifactPanel, { active: { descriptor: descriptor('code'), follow: true }, versions: [descriptor('code')], options, onSelect: () => {}, onClose: () => {} })); });
      for (let i = 0; i < 10; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    };
    await render(undefined);
    assert.deepEqual(reports, [{ path: 'a.js', revision: 'rev-code' }], 'the built-in code viewer mounted a.js@rev-code');
    // The built-in code viewer mounted a.js@rev-code. The same path now goes to a custom viewer that renders nothing.
    await render({ code: () => null });
    acks.consider([pendingCall('c1', 'a.js')], context({ showing: () => true }));
    await flush();
    assert.deepEqual(sent, [], 'the old built-in mount of a.js does not confirm the call');
    assert.deepEqual(acks.waiting(), ['c1'], 'the call waits for a real mount');
  } finally {
    await act(async () => { root?.unmount(); });
    restore(); await window.happyDOM.close();
  }
});

test('a request that fails in transport keeps its call waiting, so a later mount of the revision still confirms it', async () => {
  // A's request rejects before any answer; B mounts afterwards and the server accepts it.
  const sent = [];
  const answer = async (id, body) => {
    const parsed = JSON.parse(body); sent.push(parsed.revision);
    if (parsed.revision === 'A') throw new Error('network down');
    return { kind: 'answered' };
  };
  const { createPresentAcks } = await load('artifact', 'pi-chat/artifact.ts');
  const acks = createPresentAcks({ answer, open: () => true, instanceId: 'tab-1', wait: async () => {} });
  acks.consider([pendingCall('c1', 'a.md')], context({ autoOpen: false }));
  acks.shown({ path: 'a.md', revision: 'A' });
  await flush();
  assert.deepEqual(acks.waiting(), ['c1'], 'a failed request does not end the call');
  acks.shown({ path: 'a.md', revision: 'B' });
  await flush();
  assert.deepEqual(sent, ['A', 'B'], 'the later mount of B is answered');
  assert.deepEqual(acks.waiting(), [], 'B is accepted, so the call is done');
});

test('an app kind that waits for ready (a dashboard) reports its mount only after onReady, and onFailed or a throw is reported as a failure', async () => {
  const { ArtifactPanel } = await load('artifact-panel', 'pi-app/artifact-panel.tsx');
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const restore = installDom(window);
  const { client, descriptor } = panelFixture();
  const dashboard = descriptor('code', 'sales.dashboard.json');
  const errors = console.error; console.error = () => {};
  /** Mounts the dashboard with a kind whose renderer is `draw(props)`; `step(props)` runs once it rendered. */
  async function mount(draw, step = async () => {}) {
    const reports = [], failures = [];
    let props;
    const kind = { match: target => target.resource.path.endsWith('.dashboard.json'), label: 'Dashboard', waitsForReady: true,
      renderer: value => { props = value; return draw(value); } };
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = createRoot(container);
    const options = { client, identity: { runtimeId: 'fictional' }, kinds: [kind], onShown: shown => reports.push(shown), onFailed: failed => failures.push(failed) };
    try {
      await act(async () => { root.render(createElement(ArtifactPanel, { active: { descriptor: dashboard, follow: true }, versions: [dashboard], options, onSelect: () => {}, onClose: () => {} })); });
      for (let i = 0; i < 10; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      await step(props, reports, act);
    } finally {
      await act(async () => { root.unmount(); });
    }
    return { reports, failures };
  }
  try {
    const ready = await mount(() => createElement('div', null, 'chart'), async (props, reports, act) => {
      assert.deepEqual(reports, [], 'nothing is reported while the dashboard has not called onReady');
      await act(async () => { props.onReady(); });
    });
    assert.deepEqual(ready.reports, [{ path: 'sales.dashboard.json', revision: 'rev-code' }, { path: 'sales.dashboard.json', revision: 'rev-code', hidden: true }]);
    assert.deepEqual(ready.failures, []);

    const failed = await mount(() => createElement('div', null, 'chart'), async (props, _reports, act) => { await act(async () => { props.onFailed('the sales query failed'); }); });
    assert.deepEqual(failed.reports, [], 'a failed dashboard never reports a mount');
    assert.deepEqual(failed.failures, [{ path: 'sales.dashboard.json', revision: 'rev-code', reason: 'the sales query failed' }]);

    const thrown = await mount(() => { throw new Error('fictional render bug'); });
    assert.deepEqual(thrown.reports, [], 'a renderer that throws never reports a mount');
    assert.deepEqual(thrown.failures, [{ path: 'sales.dashboard.json', revision: 'rev-code', reason: 'the view failed to render' }]);

    const never = await mount(() => createElement('div', null, 'loading'));
    assert.deepEqual(never, { reports: [], failures: [] }, 'a dashboard that never calls onReady reports nothing: the present ends unconfirmed');
  } finally {
    console.error = errors;
    restore(); await window.happyDOM.close();
  }
});

test('createPresentAcks refuses the calls waiting for a file whose view failed, with the reason', async () => {
  const { sent, make } = await fakeChat();
  const acks = make();
  acks.consider([pendingCall('c1', 'sales.dashboard.json'), pendingCall('c2', 'other.md')], context({ autoOpen: false }));
  acks.failed({ path: 'sales.dashboard.json', reason: 'the sales query failed' });
  await flush();
  assert.deepEqual(sent, [{ id: 'c1', kind: 'refused', reason: 'the sales query failed' }]);
  assert.deepEqual(acks.waiting(), ['c2'], 'only the failed file is refused');
  acks.consider([pendingCall('c2', 'other.md'), pendingCall('c3', 'sales.dashboard.json')], context({ autoOpen: false }));
  acks.failed({ path: 'sales.dashboard.json', reason: 'x'.repeat(500) });
  await flush();
  assert.equal(sent.at(-1).reason.length, 200, 'the reason is bounded to what the server accepts');
});
