import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.STAGED_SOURCE_ROOT ?? root;
const out = `${root}.cache/pi-chat-staged-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: `export { PiChat } from '${source}registry/pi-chat/pi-chat'; export { readChatPlacement } from '${source}registry/pi-chat/use-remote-chat'; export { AmbientChat } from '${source}registry/pi-ambient/ambient';`, resolveDir: root, loader: 'tsx' }, outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat, AmbientChat, readChatPlacement } = await import(pathToFileURL(`${out}/chat.mjs`).href);
const assistant = (text, durationMs = 10, extra = {}) => ({ role: 'assistant', content: text === null ? [] : [{ type: 'text', text }], api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1, durationMs, ...extra });
const entry = (id, message) => ({ id, kind: 'message', byTaskId: id, model: [message] });
const question = entry(1, { role: 'user', content: 'Quelle dose pour un adulte ?', timestamp: 0 });
const stage = id => ({ id, kind: 'fictional.stage', data: { label: `Étape ${id}` } });
function controller(id, view = { entries: [question], docs: {} }) {
  let snapshot = { identity: { runtimeId: 'fictional', scopeId: id, principalId: 'fictional-reader' }, conversationId: id, connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set();
  const publish = change => { snapshot = { ...snapshot, ...change }; for (const listener of listeners) listener(); };
  return { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, publish,
    setText: text => publish({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }), setAttachments() {}, connect: async () => {}, send: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {} };
}
async function fixture(t) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const element = document.createElement('div'); document.body.append(element);
  const ui = createRoot(element);
  t.after(async () => { await act(async () => ui.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { h, act, element, render: async children => act(async () => ui.render(children)) };
}

test('two PiChat controllers isolate draft, status, placement and transcript nodes', async t => {
  const f = await fixture(t), a = controller('Questions'), b = controller('Senior');
  await f.render(f.h('main', null, f.h(PiChat, { controller: a, placement: 'docked', presentation: 'natural' }), f.h(PiChat, { controller: b, placement: 'floating', presentation: 'natural' })));
  const [first, second] = f.element.querySelectorAll('[data-boring="pi-chat"]');
  const secondRow = second.querySelector('[data-row-id]');
  await f.act(async () => { a.setText('Brouillon Questions'); b.setText('Brouillon Senior'); a.publish({ view: { entries: [question], docs: { 'pi.live': { run: { taskId: 2 } } } } }); });
  assert.equal(first.querySelector('textarea').value, 'Brouillon Questions');
  assert.equal(second.querySelector('textarea').value, 'Brouillon Senior');
  assert.ok(first.querySelector('[data-testid="preparing"]'));
  assert.equal(second.querySelector('[data-testid="preparing"]'), null);
  assert.equal(second.querySelector('[data-row-id]'), secondRow);
  assert.notEqual(first.querySelector('[data-testid="transcript-scroll"]'), second.querySelector('[data-testid="transcript-scroll"]'));
  assert.equal(readChatPlacement(a), 'docked'); assert.equal(readChatPlacement(b), 'floating');
  await f.render(f.h(PiChat, { controller: b, placement: 'floating' }));
  assert.equal(readChatPlacement(a), undefined); assert.equal(readChatPlacement(b), 'floating');
});

test('inline stage entries preserve one answer, filtered copy/actions and summed rounds including empty rounds', async t => {
  const f = await fixture(t);
  const view = { entries: [question, entry(2, assistant('Première étape.\n::meta {"offer":true}\n', 11)), stage(3), entry(4, assistant(null, 13)), stage(5), entry(6, assistant('Dernière étape.\n::meta {"hidden":true}', 17))], docs: {} };
  const original = JSON.stringify(view), c = controller('Questions', view), copies = [], replies = [];
  const props = { controller: c, hideLine: line => line.startsWith('::meta '), renderEntry: value => value.kind === 'fictional.stage' ? { inline: true, content: f.h('p', { 'data-testid': 'stage' }, value.data.label) } : undefined,
    onCopy: async text => { copies.push(text); }, messageActions: reply => { replies.push(reply); return []; }, replyFooter: reply => f.h('small', { 'data-testid': 'duration' }, reply.durationMs) };
  await f.render(f.h(PiChat, props));
  assert.equal(f.element.querySelectorAll('[data-role="assistant"]').length, 1);
  assert.equal(f.element.querySelectorAll('[data-testid="stage"]').length, 2);
  assert.equal(f.element.querySelector('[data-testid="duration"]').textContent, '41');
  assert.doesNotMatch(f.element.textContent, /::meta|hidden|offer/);
  const row = f.element.querySelector('[data-role="assistant"]');
  assert.match(row.textContent, /Première étape[\s\S]*Étape 3[\s\S]*Étape 5[\s\S]*Dernière étape/);
  await f.act(async () => row.querySelector('button[aria-label="Copy response"]').click());
  assert.equal(copies.length, 1); assert.doesNotMatch(copies[0], /::meta/); assert.equal(copies[0], replies.at(-1).text);
  assert.equal(JSON.stringify(view), original, 'native input stays unchanged');
  await f.act(async () => c.publish({ view: { entries: view.entries.slice(0, 2), docs: { 'pi.live': { run: { taskId: 8 }, generation: { message: { content: [{ type: 'text', text: 'Suite.\n::me' }] } } } } } }));
  assert.doesNotMatch(f.element.textContent, /::me/); assert.match(f.element.textContent, /Suite/);
  assert.equal(f.element.querySelector('[data-role="assistant"]'), row, 'staged streaming preserves the answer DOM node');
  await f.act(async () => c.publish({ view: { entries: view.entries.slice(0, 2), docs: { 'pi.live': { run: { taskId: 8 }, generation: { message: { content: [{ type: 'text', text: 'Suite.\n::meta {"secret":true}\n' }] } } } } } }));
  assert.doesNotMatch(f.element.textContent, /::meta|secret/);
});

test('stage entries feed the single natural status and later errors retain earlier text', async t => {
  const f = await fixture(t), c = controller('Questions', { entries: [question, entry(2, assistant('Étape un conservée.', 8)), stage(3)], docs: { 'pi.live': { run: { taskId: 4 } } } });
  await f.render(f.h(PiChat, { controller: c, presentation: 'natural', renderEntry: value => value.kind === 'fictional.stage' ? { inline: true, status: 'Validation de la note…', content: f.h('p', null, 'Étape un validée') } : undefined }));
  const statuses = [...f.element.querySelectorAll('[role="status"]')].filter(node => !node.closest('[aria-hidden="true"]'));
  assert.equal(statuses.length, 1); assert.equal(statuses[0].textContent, 'Validation de la note…');
  await f.act(async () => c.publish({ view: { ...c.getSnapshot().view, docs: {} } }));
  assert.equal(f.element.querySelector('[data-testid="preparing"]'), null, 'stage wording does not manufacture an active native run');
  await f.act(async () => c.publish({ view: { entries: [question, entry(2, assistant('Étape un conservée.', 8)), entry(4, assistant(null, 3, { stopReason: 'error', errorMessage: 'Fictional private traceback' }))], docs: {} } }));
  assert.match(f.element.textContent, /Étape un conservée/); assert.equal(f.element.querySelector('[data-testid="response-error"]').textContent, 'The response failed');
  assert.doesNotMatch(f.element.textContent, /traceback/);
});

test('historical offers are opt-in, unread is host-owned, history is filtered and the display limit deletes nothing', async t => {
  const f = await fixture(t);
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { if (target.dataset.testid === 'transcript-history') this.callback([{ target, isIntersecting: true }]); }
    unobserve() {}
    disconnect() {}
  };
  const old = [entry(10, { role: 'user', content: 'Ancienne question', timestamp: 0 }), entry(11, assistant('Ancienne note\n::meta {"offer":true}', 5))];
  const active = Array.from({ length: 32 }, (_, index) => entry(100 + index, index % 2 ? assistant(`Note ${index}`) : { role: 'user', content: `Question ${index}`, timestamp: 0 }));
  const c = controller('Questions', { entries: active, docs: {} });
  c.publish({ history: { kind: 'ready', entries: old, hasMore: false } });
  let offers = 0, seen = false;
  const props = { controller: c, displayLimit: 24, hideLine: line => line.startsWith('::meta '), historicalMessageActions: true,
    messageActions: reply => reply.text.startsWith('Ancienne') ? [{ id: 'offer', label: 'Utiliser cette note', onSelect: () => offers++ }] : [],
    unread: reply => !seen && reply.text.startsWith('Ancienne') ? f.h('span', { 'data-testid': 'unread', 'aria-label': 'Non lu' }, '●') : null };
  await f.render(f.h(PiChat, props));
  assert.equal(f.element.querySelectorAll('[data-row-id]').length, 24);
  const earlier = [...f.element.querySelectorAll('button')].find(button => /earlier/i.test(button.textContent));
  assert.ok(earlier); await f.act(async () => earlier.click());
  assert.match(f.element.textContent, /Ancienne note/); assert.doesNotMatch(f.element.textContent, /::meta/);
  assert.ok(f.element.querySelector('[data-testid="unread"]'));
  await f.act(async () => f.element.querySelector('[data-testid="reply-action-offer"]').click()); assert.equal(offers, 1);
  seen = true; await f.render(f.h(PiChat, { ...props, unread: reply => !seen ? f.h('span', null, reply.key) : null }));
  assert.equal(f.element.querySelector('[data-testid="unread"]'), null);
  await f.render(f.h(PiChat, { ...props, historicalMessageActions: false }));
  assert.equal(f.element.querySelector('[data-testid="reply-action-offer"]'), null);
  assert.equal(c.getSnapshot().view.entries.length, 32); assert.equal(c.getSnapshot().history.entries.length, 2);
});

test('PiChat and AmbientChat tailor one native error without losing duration metadata', async t => {
  const f = await fixture(t), c = controller('Questions', { entries: [question, entry(2, assistant('Note conservée.', 1600)), entry(3, assistant(null, 15, { stopReason: 'error', errorMessage: 'Private traceback' }))], docs: {} });
  for (const Surface of [PiChat, AmbientChat]) {
    let received;
    await f.render(f.h(Surface, { controller: c, state: 'expanded', presentation: 'natural', replyError: reply => { received = reply; return 'La note précédente reste disponible.'; }, unread: () => f.h('span', { 'data-testid': 'attached-unread' }, 'Non lu') }));
    const row = f.element.querySelector('[data-role="assistant"]');
    assert.equal(row.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(row.querySelector('[data-testid="response-error"]').textContent, 'La note précédente reste disponible.');
    assert.equal(received.durationMs, 1615); assert.equal(received.entryId, '3');
    assert.doesNotMatch(row.textContent, /traceback/);
    const unread = row.querySelector('[data-testid="attached-unread"]');
    assert.equal(unread.parentElement.dataset.testid, 'reply-unread');
    assert.ok(unread.parentElement.classList.contains('items-start'));
  }
});

test('AmbientChat forwards staged filtering, unread and duration seams', async t => {
  const f = await fixture(t), c = controller('Senior', { entries: [question, entry(2, assistant('Note\n::meta {}', 4)), stage(3), entry(4, assistant('Suite', 6))], docs: {} });
  await f.render(f.h(AmbientChat, { controller: c, state: 'expanded', hideLine: line => line.startsWith('::meta'), unread: () => f.h('span', { 'data-testid': 'ambient-unread' }, 'Non lu'), renderEntry: value => value.kind === 'fictional.stage' ? { inline: true, content: f.h('span', null, 'Validé') } : undefined, replyFooter: reply => f.h('span', { 'data-testid': 'ambient-duration' }, reply.durationMs) }));
  assert.doesNotMatch(f.element.textContent, /::meta/); assert.ok(f.element.querySelector('[data-testid="ambient-unread"]'));
  assert.equal(f.element.querySelector('[data-testid="ambient-duration"]').textContent, '10');
});
