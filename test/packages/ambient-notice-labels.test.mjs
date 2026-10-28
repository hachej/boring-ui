// The ambient run notices (`watchConversation`, registry/pi-ambient) take their words from the surface's labels: the default English,
// or the French table a French app passes. Fictional conversation and approval only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/ambient-notice-labels-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.ts'), `export { frenchNotificationLabels, watchConversation } from '${root}registry/pi-ambient/notifications.tsx';`);
await build({ entryPoints: [join(out, 'entry.ts')], outfile: join(out, 'notifications.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { frenchNotificationLabels, watchConversation } = await import(pathToFileURL(join(out, 'notifications.mjs')).href);

const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'toolUse', timestamp: 1, ...extra });
const user = { id: 1, kind: 'message', model: [{ role: 'user', content: 'Fictional request', timestamp: 0 }] };
const gated = { type: 'toolCall', id: 'g', name: 'delete_all', arguments: { path: 'fictional/x' } };
const working = { 'pi.live': { run: { taskId: 1 }, tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Delete fictional files?' } } }] } };

// A fake controller: the test sets the snapshot and fires the subscribers, as the real controller does.
function fakeController(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { snapshot = next; for (const listener of listeners) listener(); },
  };
}
const idle = { view: { entries: [user], docs: {} }, connection: { kind: 'connected' } };
function run(options) {
  const pushed = [];
  const controller = fakeController(idle);
  const stop = watchConversation(controller, { push: item => pushed.push(item), dismiss() {} }, { conversationId: 'c1', title: 'Fictional chat', ...options });
  return { pushed, controller, stop };
}

test('a waiting approval is worded in the surface labels (French table)', () => {
  const { pushed, controller, stop } = run({ labels: frenchNotificationLabels });
  controller.set({ view: { entries: [user, { id: 2, kind: 'message', byTaskId: 1, model: [assistant([gated])] }], docs: working }, connection: { kind: 'connected' } });
  stop();
  const input = pushed.find(item => item.kind === 'input');
  assert.equal(input?.summary, 'Approbation requise : Delete fictional files?');
});

test('a failed run is worded in the surface labels (French table)', () => {
  const { pushed, controller, stop } = run({ labels: frenchNotificationLabels });
  controller.set({ view: { entries: [user], docs: working }, connection: { kind: 'connected' } });
  controller.set({ view: { entries: [user, { id: 2, kind: 'message', byTaskId: 1, model: [assistant([], { stopReason: 'error' })] }], docs: {} }, connection: { kind: 'connected' } });
  stop();
  const done = pushed.find(item => item.kind === 'error');
  assert.equal(done?.summary, 'L’exécution a échoué');
});

test('without labels the same failed run keeps the English words', () => {
  const { pushed, controller, stop } = run({});
  controller.set({ view: { entries: [user], docs: working }, connection: { kind: 'connected' } });
  controller.set({ view: { entries: [user, { id: 2, kind: 'message', byTaskId: 1, model: [assistant([], { stopReason: 'error' })] }], docs: {} }, connection: { kind: 'connected' } });
  stop();
  const done = pushed.find(item => item.kind === 'error');
  assert.equal(done?.summary, 'The run failed');
});
