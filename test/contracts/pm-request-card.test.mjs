import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// The C7 request card must not disappear (decided 2026-10-29, Julien's test): the one line's task source (`useHostTasks`) behind the public
// PmPanelProvider + ImproveLayout. A 403 is « unavailable for now », read again on the next turn; the card is drawn from the `tasks_create`
// result even when the list never answers. Fictional records only. PM_SOURCE_ROOT runs it against another checkout (the pre-fix code).
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.PM_SOURCE_ROOT ?? root;
const out = `${root}.cache/pm-request-card-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: `export { PmPanelProvider, ImproveLayout } from './registry/pm-panel/pm-panel'; export { useHostTasks } from './registry/pm-panel/pm-task-source'; export { pmTextFr } from './registry/pm-panel/pm-text';`, resolveDir: source, loader: 'tsx' },
  outfile: `${out}/panel.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent', alias: { '@': `${root}examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${root}packages/ui/styles/file-tree.css` } });

const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1, ...extra });
const user = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 0 }] });
const TASK = '0b8e2c7e-1111-4222-8333-944455556666';
const created = { created: true, task: { id: TASK, number: 'D-207', title: 'Protéines avant les calories', state: 'waiting', status: 'À confirmer', updated_at: '2026-10-29T08:00:00Z' } };
const turn = [user(1, 'Mettre les protéines en avant'), { id: 2, kind: 'message', model: [assistant([{ type: 'toolCall', id: 't', name: 'tasks_create', arguments: { title: 'Protéines avant les calories' } }], { stopReason: 'toolUse' })] },
  { id: 3, kind: 'message', model: [{ role: 'toolResult', toolCallId: 't', toolName: 'tasks_create', content: [{ type: 'text', text: JSON.stringify(created) }], isError: false, timestamp: 2 }] },
  { id: 4, kind: 'message', model: [assistant([{ type: 'text', text: 'C’est noté.' }])] }];
const listed = { tasks: [{ id: TASK, ref: 'D-207', title: 'Protéines avant les calories', state: 'waiting', waiting_on_you: true, is_requester: true, question: 'Confirmez-vous ?' },
  { id: 'b1c2d3e4-1111-4222-8333-944455556666', ref: 'D-202', title: 'Plan du jour : photo du déjeuner', state: 'open', waiting_on_you: false, is_requester: true }], cursor: '2' };

async function mount(t, fetchTasks) {
  const window = new Window({ url: 'https://fictional.invalid/apps/coach/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'fetch' ? fetchTasks : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) && name !== 'fetch' ? value.bind(window) : value });
  }
  const { PmPanelProvider, ImproveLayout, useHostTasks, pmTextFr } = await import(pathToFileURL(`${out}/panel.mjs`).href);
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot;
  const listeners = new Set();
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } }, { get: (target, key) => key in target ? target[key] : async () => {} });
  function App() {
    const tasks = useHostTasks('https://fictional.invalid/apps/coach/_tasks/api', 'alice', controller, pmTextFr);
    return h(PmPanelProvider, { spec: { controller, ...(tasks ? { tasks } : {}), chatProps: { locale: 'fr' } }, open: true, close: () => {}, appName: 'Coach', locale: 'fr' },
      h(ImproveLayout, { screen: 'Ma journée' }, h('main', null, 'Fictional page')));
  }
  const show = async entries => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries, docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => { for (const listener of listeners) listener(); ui.render(h(App)); });
  };
  // The task source reads 300 ms after a change.
  const wait = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  const card = () => container.querySelector('[data-testid="transcript"] [data-task-card]');
  return { show, wait, card, container, act };
}

test('the list answers 403 once, then 200 on the next turn: the card appears, then takes the list\'s record', async t => {
  const calls = [];
  const app = await mount(t, async url => { calls.push(String(url)); return calls.length === 1 ? new Response(null, { status: 403 }) : Response.json(listed); });
  await app.show(turn);
  await app.wait();
  assert.equal(calls.length, 1, 'read once');
  const reply = () => app.container.querySelector('[data-testid="transcript"]');
  assert.ok(app.card(), 'the card is drawn from the tasks_create result after a 403');
  assert.match(reply().textContent, /Protéines avant les calories/);
  assert.doesNotMatch(reply().textContent, /DEMANDE/);
  assert.equal(app.card().querySelectorAll('[data-slot="badge"]').length, 1);
  assert.equal(app.card().querySelector('[data-task-status]')?.textContent, 'En préparation');
  // The next PM turn: the source is read again, and the list's record wins (waiting on the viewer: « À confirmer », Confirmer).
  await app.show([...turn, user(5, 'Merci'), { id: 6, kind: 'message', model: [assistant([{ type: 'text', text: 'Avec plaisir.' }])] }]);
  await app.wait();
  assert.ok(calls.length >= 2, 'read again on the next turn, never latched');
  assert.match(reply().textContent, /Attend votre avis/);
  assert.ok(reply().querySelector('[data-testid="pm-request-confirm"]'), '« Confirmer » from the list');
  await app.act(async () => app.container.querySelector('[data-testid="workspace-bar-tasks"]').click());
  await app.wait();
  assert.match(document.querySelector('[data-testid="pm-task-board-seam"]')?.textContent ?? '', /Plan du jour/, '« Mes demandes » lists the host\'s records');
});

test('the list never answers: the native card keeps its title and one preparation chip, without unverified viewer actions', async t => {
  const app = await mount(t, (url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  await app.show(turn);
  await app.wait();
  const reply = app.container.querySelector('[data-testid="transcript"]');
  assert.ok(app.card(), 'the request card remains present');
  assert.match(reply.textContent, /Protéines avant les calories/);
  assert.doesNotMatch(reply.textContent, /DEMANDE/);
  assert.equal(app.card().querySelectorAll('[data-slot="badge"]').length, 1);
  assert.equal(app.card().querySelector('[data-task-status]')?.textContent, 'En préparation');
  assert.doesNotMatch(reply.textContent, /À confirmer|Envoyée/, 'no viewer-action claim without verified waiting_on_you');
  assert.equal(reply.querySelector('[data-testid="pm-request-confirm"]'), null);
});


test('confirmation shows busy, keeps the question on outage, and succeeds as En préparation', async t => {
  let reject, resolve;
  const app = await mount(t, async (_url, init) => init?.method === 'POST' ? new Promise((yes, no) => { resolve = yes; reject = no; }) : Response.json(listed));
  await app.show(turn); await app.wait();
  const confirm = () => app.container.querySelector('[data-testid="pm-request-confirm"]');
  await app.act(async () => confirm().click());
  assert.equal(confirm()?.disabled, true, 'busy control remains present until acknowledgement');
  assert.equal(confirm()?.getAttribute('aria-busy'), 'true');
  await app.act(async () => reject(new TypeError('offline')));
  assert.equal(confirm()?.disabled, false, 'retry is actionable');
  assert.match(app.card().querySelector('[role="alert"]')?.textContent ?? '', /Impossible de confirmer/);
  await app.act(async () => confirm().click());
  await app.act(async () => resolve(new Response(null, { status: 200 })));
  assert.equal(confirm(), null);
  assert.equal(app.card().querySelector('[data-task-status]')?.textContent, 'En préparation');
  assert.doesNotMatch(app.card().textContent, /Envoyée/);
});
