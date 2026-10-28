// Exercise the installed registry adapter and the kit's public API, with fictional native views.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createNotificationStore as kitStore, watchConversation as kitWatch, useRunNotifications } from '@hachej/boring-ui-kit/chat-react';
const out = new URL('../../.cache/run-notifications-test/', import.meta.url);
mkdirSync(out, { recursive: true });
await build({ entryPoints: [new URL('../../registry/pi-ambient/notifications.tsx', import.meta.url).pathname], outfile: new URL('notifications.mjs', out).pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { watchConversation, createNotificationStore, frenchNotificationLabels } = await import(new URL('notifications.mjs', out));
const call = { type: 'toolCall', id: 'ask-1', name: 'ask_user', arguments: { question: 'Which fictional harbour?' } };
const message = { id: 1, kind: 'message', byTaskId: 1, model: [{ role: 'assistant', content: [call], stopReason: 'toolUse', timestamp: 1 }] };
function source() {
  let snapshot = { connection: { kind: 'connected' }, view: { entries: [], docs: {} } };
  const listeners = new Set();
  return { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    set(entries, docs = {}, connected = true) { snapshot = { connection: { kind: connected ? 'connected' : 'disconnected' }, view: { entries, docs } }; for (const listener of [...listeners]) listener(); },
    get listeners() { return listeners.size; } };
}

test('watchConversation notifies a question with no active run and dismisses its answered card', () => {
  const controller = source(), store = createNotificationStore();
  const stop = watchConversation(controller, store, { conversationId: 'harbour', title: 'Fictional harbour' });
  controller.set([message]);
  assert.equal(store.getSnapshot()[0]?.kind, 'input');
  assert.equal(store.getSnapshot()[0]?.summary, 'Which fictional harbour?');
  controller.set([message, { id: 2, kind: 'message', model: [{ role: 'toolResult', toolCallId: call.id, toolName: 'ask_user', content: [], isError: false, timestamp: 2 }] }]);
  assert.equal(store.getSnapshot().length, 0);
  stop();
  assert.equal(controller.listeners, 0);
});

test('watchConversation observes doc-only approval decisions and reconnects without losing a finish', () => {
  const controller = source(), store = createNotificationStore();
  const stop = watchConversation(controller, store, { conversationId: 'harbour', title: 'Fictional harbour', labels: frenchNotificationLabels });
  const approval = { ...message, model: [{ ...message.model[0], content: [{ ...call, name: 'delete_all' }] }] };
  const details = decision => ({ 'pi.live': { run: { taskId: 1 }, tools: [{ callId: call.id, details: { 'boring.approval': { summary: 'Delete fictional files?', ...(decision ? { decision } : {}) } } }] } });
  controller.set([approval], details());
  assert.equal(store.getSnapshot()[0]?.summary, 'Approbation requise : Delete fictional files?');
  controller.set([approval], details('approved'));
  assert.equal(store.getSnapshot().length, 0, 'a decision changes docs, not the entry count or run flag');
  const failed = { ...message, model: [{ ...message.model[0], content: [], stopReason: 'error' }] };
  controller.set([failed], {}, false);
  assert.equal(store.getSnapshot().length, 0, 'loss of contact is not completion');
  controller.set([failed]);
  assert.equal(store.getSnapshot()[0]?.summary, 'L’exécution a échoué');
  stop();
});

test('public hook and watcher deliver identical transitions; suppression, replacement and teardown only affect their own viewer', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  const { createElement: h, act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.createElement('div'));
  const foreground = kitStore(), background = kitStore();
  let controller = source(), suppress = false, enabled = true;
  const outcomes = [];
  const options = { conversationId: 'harbour', title: () => 'Fictional harbour', question: call => call.arguments.question, text: { approve: text => `Autoriser : ${text}`, finished: 'Terminé', runFailed: 'Échec' } };
  const stop = kitWatch(controller, background, options);
  function Viewer({ controller, enabled, suppress }) { useRunNotifications(controller, foreground, { ...options, enabled, suppress: () => suppress, onOutcome: value => outcomes.push(value) }); return null; }
  const render = () => act(async () => root.render(h(StrictMode, null, h(Viewer, { controller, enabled, suppress }))));
  t.after(async () => { stop(); await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, value] of saved) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  const comparable = store => store.getSnapshot().map(({ createdAt, ...item }) => item);
  const emit = async (...args) => { await act(async () => controller.set(...args)); assert.deepEqual(comparable(foreground), comparable(background)); };
  await render();
  await emit([message], {}, false);
  assert.equal(foreground.getSnapshot().length, 0, 'a disconnected question is not fresh');
  await emit([message]);
  assert.equal(foreground.getSnapshot()[0].kind, 'input', 'both notify with no run');
  const original = foreground.getSnapshot();
  await emit([message]);
  assert.equal(foreground.getSnapshot(), original, 'repeated observation never pushes twice');
  await emit([]);
  await emit([], { 'pi.live': { run: { taskId: 1 } } });
  await emit([{ ...message, model: [{ ...message.model[0], content: [], stopReason: 'error' }] }], {}, false);
  assert.equal(foreground.getSnapshot().length, 0);
  await emit([{ ...message, model: [{ ...message.model[0], content: [], stopReason: 'error' }] }]);
  assert.equal(foreground.getSnapshot()[0].summary, 'Échec');
  await emit([], { 'pi.live': { run: { taskId: 2 } } });
  await emit([{ ...message, model: [{ ...message.model[0], content: [], stopReason: 'aborted' }] }]);
  assert.equal(foreground.getSnapshot().length, 0, 'confirmed stop is not success');
  assert.deepEqual(outcomes, [null, 'error', null]);
  suppress = true;
  await render();
  await act(async () => controller.set([message]));
  assert.equal(foreground.getSnapshot().length, 0, 'visible expanded chat suppresses a push');
  suppress = false;
  await render();
  await act(async () => controller.set([message]));
  assert.equal(foreground.getSnapshot().length, 0, 'suppressed transitions are not replayed');
  enabled = false;
  await render();
  await act(async () => { controller.set([]); controller.set([message]); });
  assert.equal(foreground.getSnapshot().length, 0, 'disabled notifications do not push');
  const old = controller;
  controller = source(); enabled = true;
  await render();
  assert.equal(old.listeners, 1, 'switch releases only the hook, not the background watcher');
  await act(async () => old.set([]));
  assert.equal(foreground.getSnapshot().length, 0);
  await act(async () => controller.set([message]));
  assert.equal(foreground.getSnapshot()[0].kind, 'input');
  await act(async () => root.unmount());
  assert.equal(controller.listeners, 0);
});

test('public notification store is shared by legacy re-export and handles keyed replacement and dismissals', () => {
  assert.equal(createNotificationStore, kitStore);
  const store = kitStore(); let changes = 0;
  const stop = store.subscribe(() => changes++);
  const id = store.push({ kind: 'done', title: 'Fictional', conversationId: 'a' });
  store.push({ id, kind: 'error', title: 'Replaced', conversationId: 'a' });
  assert.equal(store.getSnapshot().length, 1);
  assert.equal(store.getSnapshot()[0].kind, 'error');
  store.push({ kind: 'input', title: 'Other', conversationId: 'b' });
  store.dismissConversation('a', 'done');
  assert.equal(store.getSnapshot().length, 2);
  store.dismissConversation('a', 'error');
  assert.equal(store.getSnapshot().length, 1);
  store.clear(); store.dismiss('missing'); store.clear();
  assert.equal(changes, 5);
  stop(); store.push({ kind: 'done', title: 'After unsubscribe' });
  assert.equal(changes, 5);
});
