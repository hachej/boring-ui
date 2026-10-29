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

// Decided 2026-10-29 (Julien's test): the member thread shows a calm live step list in plain words instead of the lone « Préparation… »,
// streams the reply, and draws `present` mockups and `ask_user` choices in place. Fictional turn, fictional files.
const call = (id, name, args = {}) => ({ type: 'toolCall', id, name, arguments: args });
const result = (id, name, text, isError = false) => ({ id: `r-${id}`, kind: 'message', model: [{ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 2 }] });
const round = (id, content) => ({ id, kind: 'message', model: [assistant(content, { stopReason: 'toolUse' })] });
const mockup = name => ({ schema: 'boring.artifact', version: 1, title: name, type: 'html', mediaType: 'text/html', target: { resource: { providerId: 'workspace', path: `maquettes/${name}` }, view: { kind: 'published' } }, revision: `rev-${name}` });

test('the member thread: a live step list in plain words, a streamed reply, mockups and a choice', async t => {
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
  const listeners = new Set();
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const reads = [];
  const readArtifact = async artifact => { reads.push(artifact.target.resource.path); return `<!doctype html><main><h1>Fictional ${artifact.title}</h1></main>`; };
  const spec = { controller, readArtifact, chatProps: { locale: 'fr', actions: { answer: async () => ({ kind: 'answered' }) } } };
  const render = async (entries, live) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries, docs: live ? { 'pi.live': live } : {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => { for (const listener of listeners) listener(); ui.render(h(PmPanelProvider, { spec, open: true, close: () => {}, appName: 'Coach', locale: 'fr' }, h(ImproveLayout, { screen: 'Ma journée' }, h('main', null, 'Fictional page')))); });
  };
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const panel = () => container.querySelector('[data-testid="pm-panel"]');
  const steps = () => [...panel().querySelectorAll('[data-testid="pm-step"]')].map(step => [step.textContent, step.dataset.stepStatus]);
  const run = message => ({ run: { taskId: 7 }, ...(message ? { generation: { message: { role: 'assistant', content: message } } } : {}) });

  // Running: a read, a refused write, then a tool the map doesn't know, still running. Plain words, never a raw name or error.
  const turn = [user(1, 'Mettre les protéines en avant'), round(2, [call('a', 'tasks_list')]), result('a', 'tasks_list', '[]'), round(3, [call('w', 'write', { path: '../dehors.md' })]),
    result('w', 'write', 'Refused: ../dehors.md is outside the workspace.', true), round(4, [call('x', 'mystery_tool', { secret: 'json' })])];
  await render(turn, run());
  assert.equal(panel().querySelector('[data-testid="pm-steps"]')?.dataset.open, 'true', 'the list is open while the PM works');
  assert.deepEqual(steps(), [['Lecture des tâches', 'done'], ["Rédaction d'un document", 'stopped'], ['Étape en cours', 'running']]);
  assert.equal(panel().querySelectorAll('[data-testid="pm-step-dot"]').length, 1, 'the failed step is a neutral dot');
  assert.doesNotMatch(panel().textContent, /tasks_list|mystery_tool|Refused|dehors|secret|\{/, 'no tool name, argument, result or error');

  // The reply streams: its Markdown is drawn live, and the list folds to its summary.
  await render([...turn, result('x', 'mystery_tool', 'ok')], run([{ type: 'text', text: 'Je propose **deux pistes**' }]));
  assert.equal(panel().querySelector('[data-testid="pm-reply-text"] strong')?.textContent, 'deux pistes', 'the streamed reply is Markdown, live');
  assert.equal(panel().querySelector('[data-testid="pm-steps"]').dataset.open, 'false', 'folded once the reply arrives');
  assert.match(panel().querySelector('[data-testid="pm-steps-summary"]').textContent, /^3 étapes/);

  // Done: folded; a tap opens it again.
  await render([...turn, result('x', 'mystery_tool', 'ok'), { id: 9, kind: 'message', model: [assistant([{ type: 'text', text: 'Je propose **deux pistes**.' }])] }]);
  assert.equal(panel().querySelector('[data-testid="pm-steps"]').dataset.open, 'false');
  await act(async () => panel().querySelector('[data-testid="pm-steps-summary"]').click());
  assert.equal(panel().querySelector('[data-testid="pm-steps"]').dataset.open, 'true', 'a tap opens the list');
  assert.equal(panel().querySelectorAll('[data-testid="pm-reply"]').length, 1);

  // Mockups and a choice: two `present` results become two mockup rows, `ask_user` its options, both as thread content; text beside the calls stays.
  const choose = [user(1, 'Montrez-moi des maquettes'), round(2, [{ type: 'text', text: 'Voici deux pistes.' }, call('p1', 'present', { path: 'maquettes/piste-a.html' }), call('p2', 'present', { path: 'maquettes/piste-b.html' })]),
    result('p1', 'present', JSON.stringify({ kind: 'presented', artifact: mockup('piste-a.html') })), result('p2', 'present', JSON.stringify({ kind: 'presented', artifact: mockup('piste-b.html') })),
    round(3, [{ type: 'text', text: 'Laquelle préférez-vous ?' }, call('q', 'ask_user', { question: 'Quelle piste ?', options: ['Piste A', 'Piste B'] })])];
  await render(choose, run());
  assert.deepEqual([...panel().querySelectorAll('[data-testid="pm-mockup-title"]')].map(node => node.textContent), ['piste-a.html', 'piste-b.html']);
  assert.deepEqual([...panel().querySelectorAll('[data-testid="question-option"]')].map(node => node.textContent), ['Piste A', 'Piste B']);
  assert.match(panel().textContent, /Voici deux pistes\.[\s\S]*Laquelle préférez-vous/, 'the text of a round that calls tools stays');
  assert.deepEqual(steps(), [["Préparation d'une maquette", 'done'], ["Préparation d'une maquette", 'done'], ['Question pour vous', 'running']]);
  await settle();
  assert.ok(panel().querySelector('[data-testid="pm-mockup-thumb-run-frame"]')?.getAttribute('srcdoc')?.includes('Fictional piste-a.html'), 'a live thumbnail');
  await act(async () => panel().querySelectorAll('[data-testid="pm-mockup-open"]')[1].click());
  await settle();
  const frame = panel().querySelector('[data-testid="pm-mockup-view"] [data-testid="pm-mockup-full-run-frame"]');
  assert.ok(frame?.getAttribute('srcdoc')?.includes('Fictional piste-b.html'), 'the mockup opens full height in the sheet');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts', 'in a sandboxed frame (opaque origin)');
  assert.equal(panel().dataset.mode, 'full');
  assert.deepEqual([...new Set(reads)], ['maquettes/piste-a.html', 'maquettes/piste-b.html'], 'one read per revision');
  await act(async () => panel().querySelector('[data-testid="pm-mockup-back"]').click());
  assert.equal(panel().querySelector('[data-testid="pm-mockup-view"]'), null, '« ‹ Retour » goes back to the thread');
  assert.equal(panel().querySelectorAll('[data-testid="pm-mockup"]').length, 2);
});
