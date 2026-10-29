import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// The app panel's member thread (spec 2 §C7) through the public PmPanelProvider + ImproveLayout: no tool step, no raw tool error, the PM's
// reply drawn as Markdown, and one muted line when the run ends in error without a reply. Studio's PmChat keeps the builder view.
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.PM_SOURCE_ROOT ?? root;
const out = `${root}.cache/pm-panel-thread-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: `export { PmPanelProvider, ImproveLayout } from './registry/pm-panel/pm-panel';`, resolveDir: source, loader: 'tsx' }, outfile: `${out}/panel.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent', alias: { '@': `${root}examples/app-shell` } });

const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1, ...extra });
const user = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 0 }] });
const write = { type: 'toolCall', id: 'w', name: 'write', arguments: { path: 'docs/tasks/fictional/brief.md', content: '# D-9 — Fictif' } };
const refused = { role: 'toolResult', toolCallId: 'w', toolName: 'write', content: [{ type: 'text', text: 'Refused: docs/tasks/fictional/brief.md is outside the workspace.' }], isError: true, timestamp: 2 };

test('the app panel thread hides tool steps and raw errors, and draws the reply as Markdown', async t => {
  const window = new Window({ url: 'https://fictional.invalid/apps/coach/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { PmPanelProvider, ImproveLayout } = await import(pathToFileURL(`${out}/panel.mjs`).href);
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot;
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const render = async entries => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries, docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => ui.render(h(PmPanelProvider, { spec: { controller, chatProps: { locale: 'fr' } }, open: true, close: () => {}, appName: 'Coach', locale: 'fr' },
      h(ImproveLayout, { screen: 'Ma journée' }, h('main', null, 'Fictional page')))));
  };
  const panel = () => container.querySelector('[data-testid="pm-panel"]');

  await render([user(1, 'Ajouter un bouton fictif'), { id: 2, kind: 'message', model: [assistant([write])] }, { id: 3, kind: 'message', model: [refused] },
    { id: 4, kind: 'message', model: [assistant([{ type: 'text', text: 'Demande créée : **D-9 — Bouton fictif**. Voir `D-9` et _la liste_.' }])] }]);
  assert.ok(panel(), 'the panel is mounted');
  for (const id of ['activity', 'activity-step', 'tool-card', 'tool-details', 'tool-error', 'orphan-result'])
    assert.equal(panel().querySelectorAll(`[data-testid="${id}"]`).length, 0, `${id} is not in the member thread`);
  assert.doesNotMatch(panel().textContent, /Refused|outside the workspace|docs\/tasks|"path"/, 'no tool call or raw tool error');
  const reply = panel().querySelector('[data-testid="pm-reply"]');
  assert.equal(reply.querySelector('strong')?.textContent, 'D-9 — Bouton fictif', 'bold is drawn');
  assert.equal(reply.querySelector('code')?.textContent, 'D-9');
  assert.equal(reply.querySelector('em')?.textContent, 'la liste');
  assert.doesNotMatch(reply.textContent, /\*\*/, 'no raw asterisks');

  // A run that ends in error without a reply: one muted line, never the error text.
  await render([user(1, 'Ajouter un bouton fictif'), { id: 2, kind: 'message', model: [assistant([write])] }, { id: 3, kind: 'message', model: [refused] },
    { id: 4, kind: 'message', model: [assistant([], { stopReason: 'error', errorMessage: 'Fictional provider stack trace' })] }]);
  assert.equal(panel().querySelector('[data-testid="pm-failed"]')?.textContent, "Le chef de projet n'a pas pu terminer. Réessayez.");
  assert.equal(panel().querySelectorAll('[data-testid="response-error"]').length, 0);
  assert.doesNotMatch(panel().textContent, /stack trace|Refused/);
});
