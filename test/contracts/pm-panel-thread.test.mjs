import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = process.cwd();
const out = `${root}/.cache/pm-panel-thread-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: `export { PmPanelProvider, ImproveLayout, PmChat } from './registry/pm-panel/pm-panel';`, resolveDir: root, loader: 'tsx' }, outfile: `${out}/panel.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent', alias: { '@': `${root}/examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${root}/packages/ui/styles/file-tree.css` } });
const assistant = content => ({ role: 'assistant', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1 });

for (const surface of ['app', 'column']) test(`${surface}: standard embedded workspace, Markdown and native question composer`, async t => {
  const window = new Window({ url: 'https://fictional.invalid/apps/coach/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { PmPanelProvider, ImproveLayout, PmChat } = await import(pathToFileURL(`${out}/panel.mjs`).href);
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries: [{ id: 1, kind: 'message', model: [assistant('Voici **deux pistes**, avec `un repère` et _une explication_.')] }], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set();
  let submits = 0, refuse = true;
  const answers = [];
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setText: text => { snapshot = { ...snapshot, draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }; for (const listener of listeners) listener(); },
    send: async () => { submits++; },
  }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const spec = { controller, chatProps: { locale: 'fr', actions: { answer: async (id, text) => {
    if (refuse) throw new Error('Fictional outage');
    answers.push([id, text]); return { kind: 'answered' };
  } } } };
  await act(async () => ui.render(surface === 'column' ? h(PmChat, { spec, page: null }) : h(PmPanelProvider, { spec, open: true, close: () => {}, locale: 'fr' }, h(ImproveLayout, null, h('main', null, 'Fictional app')))));
  const workspace = container.querySelector('[data-boring="agent-workspace"]');
  assert.equal(workspace?.dataset.layout, 'embedded', 'same existing workspace on both surfaces');
  assert.equal(workspace.querySelector('strong')?.textContent, 'deux pistes');
  assert.equal(workspace.querySelector('code')?.textContent, 'un repère');
  assert.equal(workspace.querySelector('em')?.textContent, 'une explication');
  assert.equal(container.querySelector('[data-testid="pm-grabber"]'), null, 'obsolete sheet chrome deleted');
  assert.equal(container.querySelector('[data-testid="pm-reply"]'), null, 'no PM-specific reply bubbles');

  snapshot = { ...snapshot, view: { entries: [...snapshot.view.entries, { id: 3, kind: 'message', model: [assistant([{ type: 'toolCall', id: 'q', name: 'ask_user', arguments: { question: 'Quelle piste ?', options: ['Piste A', 'Piste B'] } }])] }], docs: { 'pi.live': { run: { taskId: 7 } } } } };
  await act(async () => { for (const listener of listeners) listener(); });
  const send = () => container.querySelector('[data-testid="composer-submit"]');
  assert.equal(send()?.dataset.state, 'send', 'answer existing native question instead of queuing behind it');
  await act(async () => controller.setText('Piste B'));
  await act(async () => send().click());
  assert.equal(snapshot.draft.text, 'Piste B', 'outage preserves draft');
  assert.match(container.textContent, /Votre texte est conservé/);
  refuse = false;
  await act(async () => send().click());
  assert.equal(snapshot.draft.text, '');
  assert.deepEqual(answers, [[JSON.stringify([3, 'q']), 'Piste B']]);
  assert.equal(submits, 0, 'no duplicate submission');
});
