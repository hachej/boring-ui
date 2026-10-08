import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createElement, act } from 'react';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { useSaved } from '../../registry/pi-app/use-saved.ts';

const target = { resource: { providerId: 'fictional', path: 'notes.md' }, view: { kind: 'published' } };
const snapshot = revision => ({ ref: { ...target, revision }, bytes: new TextEncoder().encode(`# ${revision}\n`), mediaType: 'text/markdown' });

test('Studio delayed remote refresh preserves edits and saves begun during its read (DOM, not browser qualification)', async t => {
  const window = new Window();
  const globals = new Map();
  for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  for (const action of ['edit', 'save', 'clean']) await t.test(action, async t => {
    let poll, state;
    t.mock.method(globalThis, 'setInterval', callback => { poll = callback; return 1; });
    t.mock.method(globalThis, 'clearInterval', () => {});
    const reads = [], publication = Promise.withResolvers();
    const client = { read: () => { const request = Promise.withResolvers(); reads.push(request); return request.promise; }, publish: () => publication.promise };
    const create = initial => createMarkdownController({ identity: { scopeId: 'fictional', principalId: 'person', initiatorId: 'person' }, source: { kind: 'saved', snapshot: initial }, instanceId: 'editor', epoch: 'page', client });
    function Probe() { state = useSaved({ client, target, create }); return createElement('span', null, state.kind === 'open' ? state.controller.getSnapshot().text : state.kind); }
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Probe)));
      await act(async () => reads[0].resolve({ kind: 'available', snapshot: snapshot('one') }));
      const controller = state.controller;
      let polling;
      await act(async () => { polling = poll(); });
      await act(async () => { await poll(); });
      assert.equal(reads.length, 2, 'polls do not overlap');
      if (action !== 'clean') controller.actions.edit('# Human draft\n');
      const saving = action === 'save' ? controller.flush(controller.actions.selection()) : undefined;
      await act(async () => { reads[1].resolve({ kind: 'available', snapshot: snapshot('two') }); await polling; });
      if (action === 'clean') {
        assert.notEqual(state.controller, controller);
        assert.equal(state.controller.getSnapshot().text, '# two\n');
        return;
      }
      assert.equal(state.controller, controller, 'the live editor must not be replaced');
      assert.equal(controller.getSnapshot().text, '# Human draft\n');
      assert.equal(controller.getSnapshot().dirty, true);
      if (saving) { publication.resolve({ kind: 'unavailable', reason: 'Fictional offline publisher' }); await saving; }
    } finally { publication.resolve({ kind: 'unavailable', reason: 'cleanup' }); await act(async () => root.unmount()); container.remove(); }
  });
});
