// The ambient bar remembers where it was moved under `storageKey`: in sessionStorage by default, in localStorage with `storage="local"`.
// The grip's arrow keys move the bar through the same write path as a drag, so the test needs no pointer capture.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function harness(t, view = { conversation: { id: 1 }, entries: [], docs: {} }, failure, closed = new Promise(() => {})) {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'localStorage', 'ResizeObserver', 'KeyboardEvent', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, right: 1200, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/ambient-position-test/', import.meta.url);
  mkdirSync(out, { recursive: true });
  const output = new URL('ambient.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-ambient/ambient.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { AmbientChat } = await import(output.href);
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const element = window.document.createElement('div');
  window.document.body.append(element);
  const root = createRoot(element);
  const chat = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' },
    conversation: { id: 1 }, context: { value: () => undefined, toString: () => 'fictional' }, history: false,
    source: { open: async () => { if (failure) throw failure; return ({ value: view, start() {}, closed, stop: async () => ({ kind: 'stopped' }) }); } } });
  t.after(async () => {
    await act(async () => root.unmount());
    chat.dispose();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { window, element, root, chat, act, createElement, AmbientChat };
}

/** Renders the bar with the given storage props, moves it one step up with the grip's arrow key, and returns the storage contents. */
async function moveOnce(t, props) {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const key = 'test.ambient.position';
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, ...props })));
  const grip = element.querySelector('[data-testid="ambient-grip"]');
  assert.ok(grip, 'the bar shows its grip');
  await act(async () => { grip.focus(); grip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
  const read = storage => storage.getItem(key);
  return { key, local: read(window.localStorage), session: read(window.sessionStorage) };
}

test('Ambient uses the shared below-768 phone layout and releases its media listener', async t => {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  window.happyDOM.setWindowSize({ width: 700, height: 800 });
  const original = globalThis.matchMedia;
  const listeners = new Set();
  globalThis.matchMedia = query => {
    const media = original(query);
    const add = media.addEventListener.bind(media), remove = media.removeEventListener.bind(media);
    media.addEventListener = (type, listener, ...rest) => { if (type === 'change') listeners.add(listener); add(type, listener, ...rest); };
    media.removeEventListener = (type, listener, ...rest) => { if (type === 'change') listeners.delete(listener); remove(type, listener, ...rest); };
    return media;
  };
  await act(async () => root.render(createElement(AmbientChat, { controller: chat })));
  const phone = () => element.querySelector('[data-boring=ambient-chat]').dataset.phone === 'true';
  assert.equal(phone(), true, '700px uses the phone layout');
  const composer = element.querySelector('[data-testid=composer-input]');
  for (const [width, expected] of [[767, true], [767.5, true], [768, false], [1024, false], [700, true]]) {
    await act(async () => window.happyDOM.setWindowSize({ width, height: 800 }));
    assert.equal(phone(), expected, `${width}px phone state`);
    assert.equal(element.querySelector('[data-testid=composer-input]'), composer, 'resizing preserves the composer');
  }
  assert.ok(listeners.size > 0, 'media changes are observed');
  await act(async () => root.render(null));
  assert.equal(listeners.size, 0, 'unmount releases every media listener');
});

test('ambient position remains usable when the browser denies storage access', async t => {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  for (const name of ['sessionStorage', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('fixture storage denied'); } });
  for (const storage of ['session', 'local']) {
    await act(async () => root.render(createElement(AmbientChat, { controller: chat, storage })));
    await press(window, act, element, 'ArrowUp');
    assert.ok(element.querySelector('[data-testid=composer-input]'), 'denied persistence does not disable chat');
  }
});

test('embedding a pill resets its remembered state before floating again, preserving the page composer and transcript', async t => {
  const { element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const render = embedded => act(async () => root.render(createElement(AmbientChat, { controller: chat, defaultState: 'minimized', embedded })));
  await render(false);
  assert.ok(element.querySelector('[data-testid=ambient-pill]'));
  await render(true);
  const composer = element.querySelector('[data-testid=composer-input]'), transcript = element.querySelector('[data-testid=transcript]');
  assert.ok(composer && transcript, 'the page expands the pill');
  for (const embedded of [false, true]) {
    await render(embedded);
    assert.ok(element.querySelector('[data-testid=composer-input]') === composer, 'placement keeps the exact composer');
    assert.ok(element.querySelector('[data-testid=transcript]') === transcript, 'placement keeps the exact transcript');
  }
});

test('Escape in an embedded conversation does not remember a collapsed floating state', async t => {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const changes = [];
  const render = embedded => act(async () => root.render(createElement(AmbientChat, { controller: chat, defaultState: 'expanded', embedded, onStateChange: state => changes.push(state) })));
  await render(true);
  const composer = element.querySelector('[data-testid=composer-input]'), transcript = element.querySelector('[data-testid=transcript]');
  await act(async () => composer.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.deepEqual(changes, [], 'embedded Escape does not request a hidden state change');
  await render(false);
  assert.equal(element.querySelector('[data-boring=ambient-chat]').dataset.state, 'expanded');
  assert.ok(element.querySelector('[data-testid=composer-input]') === composer);
  assert.ok(element.querySelector('[data-testid=transcript]') === transcript);
});

test('host header controls stay interactive before Dock and do not replace the conversation', async t => {
  const { element, root, chat, act, createElement: h, AmbientChat } = await harness(t);
  let opened = 0;
  const render = (embedded, tools = true) => act(async () => root.render(h(AmbientChat, {
    controller: chat, defaultState: 'expanded', embedded, onDock() {},
    headerTools: tools ? h('button', { 'data-testid': 'fixture-history', onClick: () => { opened++; } }, 'History') : undefined,
  })));
  await render(false);
  const header = element.querySelector('[data-testid=ambient-header]');
  const control = header.querySelector('[data-testid=fixture-history]');
  assert.ok(control, 'the host control renders in the floating top bar');
  assert.equal(control.nextElementSibling.dataset.testid, 'ambient-dock');
  await act(async () => control.click());
  assert.equal(opened, 1);
  const composer = element.querySelector('[data-testid=composer-input]');
  const transcript = element.querySelector('[data-testid=transcript]');
  await render(true);
  await render(false, false);
  assert.equal(element.querySelector('[data-testid=fixture-history]'), null, 'without the option there are no extra header controls');
  assert.equal(element.querySelector('[data-testid=composer-input]'), composer);
  assert.equal(element.querySelector('[data-testid=transcript]'), transcript);
});

test('Ambient pins the older revision when retried artifact calls reuse an ordinal', async t => {
  const descriptor = revision => ({ schema: 'boring.artifact', version: 1, id: 'plan', title: 'Plan', type: 'code', mediaType: 'text/plain', ordinal: 1,
    target: { resource: { providerId: 'fictional', path: 'plan.txt' }, view: { kind: 'published' } }, revision });
  const entry = (id, revision) => ({ id, model: [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'retry', name: 'present', arguments: { path: 'plan.txt' } }], stopReason: 'toolUse' },
    { role: 'toolResult', toolCallId: 'retry', toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact: descriptor(revision) }) }] },
    { role: 'user', content: `Next ${id}`, timestamp: id },
  ] });
  const view = { conversation: { id: 1 }, entries: [entry(1, 'old'), entry(2, 'new')], docs: {} };
  const { element, root, chat, act, createElement: h, AmbientChat } = await harness(t, view);
  let panel;
  await act(async () => root.render(h(AmbientChat, { controller: chat, defaultState: 'expanded', notifications: false,
    artifactPanel: (artifact, api) => { panel = { artifact, api }; return h('p', null, artifact.revision); } })));
  const cards = element.querySelectorAll('[data-testid=artifact-card][data-state=ready]');
  assert.equal(cards.length, 2);
  await act(async () => cards[0].click());
  assert.equal(panel.artifact.revision, 'old');
  assert.equal(panel.api.follow, false, 'equal ordinals do not make an old revision follow');
  assert.deepEqual(panel.api.versions.map(item => item.revision), ['new', 'old'], 'conversation order breaks ordinal ties');
  await act(async () => panel.api.select('latest'));
  assert.equal(panel.artifact.revision, 'new');
  assert.equal(panel.api.follow, true);
});

test('Ambient present waits for an observed host mount, reports its revision and refuses a failed view', async t => {
  const descriptor = { schema: 'boring.artifact', version: 1, id: 'plan', title: 'Plan', type: 'code', mediaType: 'text/plain',
    target: { resource: { providerId: 'fictional', path: 'plan.txt' }, view: { kind: 'published' } }, revision: 'observed' };
  const view = { conversation: { id: 1 }, entries: [{ id: 1, model: [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'ready', name: 'present', arguments: { path: 'plan.txt' } }], stopReason: 'toolUse' },
    { role: 'toolResult', toolCallId: 'ready', toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact: descriptor }) }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'waiting', name: 'present', arguments: { path: 'plan.txt' } }], stopReason: 'toolUse' },
  ] }], docs: { 'pi.live': { run: { id: 'fictional' } } } };
  const { element, root, chat, act, createElement: h, AmbientChat } = await harness(t, view);
  const sent = []; let panel;
  await act(async () => root.render(h(AmbientChat, { controller: chat, defaultState: 'expanded', notifications: false,
    actions: { answer: async (id, body) => { sent.push({ id, ...JSON.parse(body) }); return { kind: 'denied' }; } },
    artifactPanel: (artifact, api) => { panel = api; return h('p', null, artifact.revision); } })));
  assert.equal(element.querySelector('[data-testid=artifact-panel]'), null, 'Ambient does not auto-open');
  assert.deepEqual(sent, [], 'render alone cannot acknowledge');
  await act(async () => element.querySelector('[data-testid=artifact-card][data-state=ready]').click());
  assert.deepEqual(sent, [], 'opening a panel is not evidence of the loaded revision');
  assert.equal(typeof panel.onShown, 'function', 'the host can report a real mount');
  assert.equal(typeof panel.onFailed, 'function');
  await act(async () => panel.onShown({ path: 'plan.txt', revision: 'observed' }));
  assert.equal(sent[0].kind, 'opened');
  assert.equal(sent[0].revision, 'observed');
  assert.equal(sent[0].id, '[1,"waiting"]');
  await act(async () => panel.onFailed({ path: 'plan.txt', revision: 'observed', reason: 'fictional load failed' }));
  assert.equal(sent.at(-1).kind, 'refused');
  assert.equal(sent.at(-1).reason, 'fictional load failed');
});

test('ambient bar remembers its position in localStorage with storage="local"', async t => {
  const { key, local, session } = await moveOnce(t, { storage: 'local' });
  assert.ok(local, 'the position is written to localStorage');
  assert.deepEqual(JSON.parse(local), { right: 16, bottom: 32 });
  assert.equal(session, null, 'nothing is written to sessionStorage');
  assert.ok(key);
});

test('ambient bar keeps the sessionStorage default when storage is omitted', async t => {
  const { local, session } = await moveOnce(t, {});
  assert.ok(session, 'the position is written to sessionStorage by default');
  assert.deepEqual(JSON.parse(session), { right: 16, bottom: 32 });
  assert.equal(local, null, 'nothing is written to localStorage by default');
});

/** Presses an arrow key on the grip, the same write path a drag uses. */
async function press(window, act, element, key) {
  const grip = element.querySelector('[data-testid="ambient-grip"]');
  assert.ok(grip, 'the bar shows its grip');
  await act(async () => { grip.focus(); grip.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })); });
}

test('ambient bar restores a position saved in localStorage with storage="local"', async t => {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const key = 'test.ambient.position';
  window.localStorage.setItem(key, JSON.stringify({ right: 100, bottom: 200 }));
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, storage: 'local' })));
  // One step up from the restored corner: the write proves the restored origin (100, 200) was used.
  await press(window, act, element, 'ArrowUp');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)), { right: 100, bottom: 216 });
  assert.equal(window.sessionStorage.getItem(key), null, 'the restored position is not read from sessionStorage');
});

test('ambient bar follows a storage prop change after mount for the next move', async t => {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const key = 'test.ambient.position';
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, storage: 'local' })));
  await press(window, act, element, 'ArrowUp');
  const afterLocal = JSON.parse(window.localStorage.getItem(key));
  assert.deepEqual(afterLocal, { right: 16, bottom: 32 });
  // Switch to sessionStorage while mounted: the next move writes there and leaves localStorage as it was.
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, storage: 'session' })));
  await press(window, act, element, 'ArrowUp');
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(key)), { right: 16, bottom: 48 });
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)), afterLocal, 'localStorage is not written after the switch');
});


test('Ambient honours the host connection renderer in expanded and compact notices and reconnects', async t => {
  const failure = new Error('fictional connection failure');
  const { element, root, chat, act, createElement: h, AmbientChat } = await harness(t, undefined, failure);
  const seen = [];
  for (const state of ['expanded', 'bar']) {
    await act(async () => root.render(h(AmbientChat, { controller: chat, state, notifications: false,
      renderConnectionError: error => { seen.push(error); return h('strong', { 'data-testid': 'host-connection-error' }, 'Host recovery'); } })));
    const notice = element.querySelector('[data-testid=connection-notice]');
    assert.ok(notice?.querySelector('[data-testid=host-connection-error]'), `${state} keeps host recovery content`);
    assert.equal(seen.at(-1), failure);
    assert.ok(notice.querySelector('button'), 'reconnect remains available');
    await act(async () => notice.querySelector('button').click());
  }
});

for (const kind of ['error', 'closed']) test(`compact Ambient preserves custom ${kind} short labels`, async t => {
  let close;
  const closed = new Promise(resolve => { close = resolve; });
  const { element, root, chat, act, createElement: h, AmbientChat } = await harness(t, undefined,
    kind === 'error' ? new Error('Fictional offline') : undefined, closed);
  const render = renderConnectionError => act(async () => root.render(h(AmbientChat, { controller: chat, state: 'bar', notifications: false,
    labels: { loadFailed: 'Full failure', disconnected: 'Full disconnect', loadFailedShort: 'Brief failure', disconnectedShort: 'Brief disconnect' }, renderConnectionError })));
  await render();
  if (kind === 'closed') await act(async () => close({ kind: 'stopped' }));
  assert.equal(chat.getSnapshot().connection.kind, kind);
  const notice = () => element.querySelector('[data-testid=connection-notice]');
  assert.ok(notice()?.textContent.includes(kind === 'error' ? 'Brief failure' : 'Brief disconnect'));
  assert.doesNotMatch(notice().textContent, /Full/);
  if (kind === 'error') {
    await render(() => h('strong', null, 'Host recovery'));
    assert.match(notice().textContent, /Host recovery/);
    assert.doesNotMatch(notice().textContent, /Brief failure/);
  }
});

test('Ambient shares PiChat working, waiting, retry, compaction and natural statuses', async t => {
  const call = { type: 'toolCall', id: 'question', name: 'ask_user', arguments: { question: 'Fictional question?' } };
  const cases = [
    { name: 'working', docs: { 'pi.live': { run: { id: 'fictional' } } }, expected: 'Working' },
    { name: 'retry', docs: { 'pi.live': { run: { id: 'fictional' }, generation: { retry: { attempt: 1 } } } }, expected: 'Retrying' },
    { name: 'waiting', docs: { 'pi.live': { run: { id: 'fictional' } } }, entries: [{ id: 1, model: [{ role: 'assistant', content: [call], stopReason: 'toolUse' }] }], expected: 'Waiting' },
    { name: 'compaction', docs: { 'pi.live': { compactions: [{}] } }, expected: 'Compacting', status: null },
  ];
  for (const fixture of cases) await t.test(fixture.name, async t => {
    const view = { conversation: { id: 1 }, entries: fixture.entries ?? [], docs: fixture.docs };
    const { element, root, chat, act, createElement: h, AmbientChat } = await harness(t, view);
    const render = presentation => act(async () => root.render(h(AmbientChat, { controller: chat, defaultState: 'expanded', mode: 'developer', presentation, notifications: false,
      labels: { agentWorking: 'Working', retryPending: 'Retrying', waitingForAnswer: 'Waiting', compacting: 'Compacting' } })));
    await render();
    if (fixture.status !== null) assert.equal(element.querySelector('[data-testid=agent-status]')?.textContent, fixture.expected);
    else assert.ok([...element.querySelectorAll('[role=status]')].some(node => node.textContent === fixture.expected));
    await render('natural');
    assert.equal(element.querySelector('[data-testid=agent-status]'), null);
    assert.equal(Boolean(element.querySelector('[data-testid=preparing]')), fixture.name !== 'waiting');
  });
});
