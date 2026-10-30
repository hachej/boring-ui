import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Phone-user regression: public PM surfaces show human replies and questions, never native tool traces.
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.PM_SOURCE_ROOT ?? root;
const out = `${root}.cache/pm-panel-thread-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: `export { PmPanelProvider, ImproveLayout, PmChat } from './registry/pm-panel/pm-panel';`, resolveDir: source, loader: 'tsx' }, outfile: `${out}/panel.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent', alias: { '@': `${root}examples/app-shell` } });

const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1, ...extra });
const user = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 0 }] });
const write = { type: 'toolCall', id: 'w', name: 'write', arguments: { path: 'docs/tasks/fictional/brief.md', content: '# D-9 — Fictif' } };
/** A raw tool error stays in pi-chat's DOM but the app panel hides it: its details and orphan notices sit under the panel's hiding rule. */
const hiddenByPanel = node => { for (let at = node; at; at = at.parentElement) if (['[&_[data-testid=tool-details]]:hidden', '[&_[data-testid=tool-error]]:hidden'].every(rule => (at.getAttribute?.('class') ?? '').split(/\s+/).includes(rule))) return true; return false; };
const refused = { role: 'toolResult', toolCallId: 'w', toolName: 'write', content: [{ type: 'text', text: 'Refused: docs/tasks/fictional/brief.md is outside the workspace.' }], isError: true, timestamp: 2 };

test('the app panel thread hides tools and raw errors, and draws the reply as Markdown', async t => {
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
  assert.ok(!panel().querySelector('[data-testid="activity"]'), 'member tool chrome is not rendered');
  const raw = [...panel().querySelectorAll('[data-testid="tool-details"], [data-testid="tool-error"]')];
  assert.ok(raw.every(hiddenByPanel), 'the raw tool error is hidden from the member');
  assert.ok([...panel().querySelectorAll('*')].filter(node => node.children.length === 0 && /Refused|outside the workspace/.test(node.textContent)).every(hiddenByPanel), 'no visible raw error text');
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
  assert.doesNotMatch(panel().textContent, /stack trace/);
  assert.ok([...panel().querySelectorAll('*')].filter(node => node.children.length === 0 && /Refused/.test(node.textContent)).every(hiddenByPanel), 'the refusal stays hidden');
});

// Presented mockups and ask_user cards remain actionable without exposing native execution details.
const call = (id, name, args = {}) => ({ type: 'toolCall', id, name, arguments: args });
const result = (id, name, text, isError = false) => ({ id: `r-${id}`, kind: 'message', model: [{ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 2 }] });
const round = (id, content) => ({ id, kind: 'message', model: [assistant(content, { stopReason: 'toolUse' })] });
const mockup = name => ({ schema: 'boring.artifact', version: 1, title: name, type: 'html', mediaType: 'text/html', target: { resource: { providerId: 'workspace', path: `maquettes/${name}` }, view: { kind: 'published' } }, revision: `rev-${name}` });

for (const surface of ['member', 'studio']) test(`${surface} thread: human progress, a streamed reply, mockups and a usable pending choice`, async t => {
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
  let snapshot;
  const listeners = new Set();
  let submits = 0;
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setText: value => { snapshot = { ...snapshot, draft: { ...snapshot.draft, text: value, version: snapshot.draft.version + 1 } }; for (const listener of listeners) listener(); },
    send: async () => { submits++; },
  }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const answers = []; let rejectAnswer = false;
  const reads = [];
  const readArtifact = async artifact => { reads.push(artifact.target.resource.path); return `<!doctype html><main><h1>Fictional ${artifact.title}</h1></main>`; };
  const spec = { controller, readArtifact, chatProps: { locale: 'fr', actions: { answer: async (id, text) => {
    if (rejectAnswer) throw new Error('Fictional network failure');
    answers.push([id, text]); return { kind: 'answered' };
  } } } };
  const render = async (entries, live, open = true) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries, docs: live ? { 'pi.live': live } : {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => { for (const listener of listeners) listener(); ui.render(surface === 'studio' ? h(PmChat, { spec, page: null }) : h(PmPanelProvider, { spec, open, close: () => {}, appName: 'Coach', locale: 'fr' }, h(ImproveLayout, { screen: 'Ma journée' }, h('main', null, 'Fictional page')))); });
  };
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const panel = () => container.querySelector(surface === 'studio' ? '[data-testid="pm-chat"]' : '[data-testid="pm-panel"]');
  const tools = () => [...panel().querySelectorAll('[data-testid="activity"] [data-testid="tool-card"]')].map(card => [card.dataset.tool, card.dataset.status]);
  const run = message => ({ run: { taskId: 7 }, ...(message ? { generation: { message: { role: 'assistant', content: message } } } : {}) });

  // Running: the standard trace (a read, a refused write, a tool still running) and pi-chat's own working line; the refusal is hidden.
  const turn = [user(1, 'Mettre les protéines en avant'), round(2, [call('a', 'tasks_list')]), result('a', 'tasks_list', '[]'), round(3, [call('w', 'write', { path: '../dehors.md' })]),
    result('w', 'write', 'Refused: ../dehors.md is outside the workspace.', true), round(4, [call('x', 'mystery_tool', { secret: 'json' })])];
  await render(turn, run());
  assert.deepEqual(tools(), []);
  assert.ok(panel().querySelector('[data-testid="preparing"]'), 'human progress feedback stays visible');
  if (surface === 'member') assert.ok([...panel().querySelectorAll('[data-testid="tool-details"]')].every(hiddenByPanel), 'the raw refusal is hidden');

  // Native grouping splits at prose; a separate running activity starts collapsed, so inspect its visible summary, not its unmounted steps.
  await render([...turn.slice(0, -1), round(4, [{ type: 'text', text: 'Je vérifie…' }, call('x', 'mystery_tool', { secret: 'json' })])], run());
  assert.match(panel().textContent, /Je vérifie…/, 'text alongside a running tool remains visible');
  assert.doesNotMatch(panel().textContent, /tasks_list|mystery_tool|Utilisé/);

  // The reply streams: its Markdown is drawn live.
  await render([...turn, result('x', 'mystery_tool', 'ok')], run([{ type: 'text', text: 'Je propose **deux pistes**' }]));
  assert.equal(panel().querySelector('[data-testid="transcript"] strong')?.textContent, 'deux pistes', 'the streamed reply is Markdown, live');

  // A run that ends in error after a tool step: one muted line, never the provider's error.
  await render([...turn, result('x', 'mystery_tool', 'ok'), { id: 9, kind: 'message', model: [assistant([], { stopReason: 'error', errorMessage: 'Fictional provider stack trace' })] }]);
  if (surface === 'member') assert.match(panel().textContent, /Le chef de projet n'a pas pu terminer\. Réessayez\./);
  if (surface === 'member') assert.doesNotMatch(panel().textContent, /stack trace/);

  // Mockups and a choice: two `present` results become two mockup rows, `ask_user` its options, both as thread content; text beside the calls stays.
  const choose = [user(1, 'Montrez-moi des maquettes'), round(2, [{ type: 'text', text: 'Voici deux pistes.' }, call('p1', 'present', { path: 'maquettes/piste-a.html' }), call('p2', 'present', { path: 'maquettes/piste-b.html' })]),
    result('p1', 'present', JSON.stringify({ kind: 'presented', artifact: mockup('piste-a.html') })), result('p2', 'present', JSON.stringify({ kind: 'presented', artifact: mockup('piste-b.html') })),
    round(3, [{ type: 'text', text: 'Laquelle préférez-vous ?' }, call('q', 'ask_user', { question: 'Quelle piste ?', options: ['Piste A', 'Piste B'] })])];
  await render(choose, run());
  assert.equal(panel().querySelector('[data-testid="composer-submit"]')?.dataset.state, 'send', 'pending question offers Send, not Stop');
  assert.equal(panel().querySelector('[data-testid="composer-input"]')?.disabled, false, 'pending question keeps the composer usable');
  assert.ok(!panel().querySelector('[data-testid="preparing"]'), 'pending question is awaiting an answer, not preparing');
  if (surface === 'member') {
    const transcript = panel().querySelector('[data-testid="transcript"]');
    for (let node = transcript; node && node !== panel(); node = node.parentElement) assert.doesNotMatch(node.className ?? '', /\[&_(?:\[data-testid=transcript\]|\[data-boring=pi-chat\]>\.relative)\]:hidden/, 'recent conversation and question are visible without expanding');
  }
  assert.deepEqual([...panel().querySelectorAll('[data-testid="pm-mockup-title"]')].map(node => node.textContent), ['piste-a.html', 'piste-b.html']);
  if (surface === 'member') {
    await render(choose, run(), false); await render(choose, run(), true);
    assert.ok(panel().querySelector('[data-testid="question-card"]'), 'reopening restores the pending question');
  }
  rejectAnswer = true;
  await act(async () => spec.controller.setText('Piste B'));
  await act(async () => panel().querySelector('[data-testid="composer-submit"]').click());
  assert.equal(snapshot.draft.text, 'Piste B', 'a lost answer keeps the draft for retry');
  assert.match(panel().textContent, /Votre texte est conservé/);
  rejectAnswer = false;
  await act(async () => panel().querySelector('[data-testid="composer-submit"]').click());
  assert.equal(snapshot.draft.text, '', 'accepted answer clears only that draft');
  assert.deepEqual(answers, [[JSON.stringify([3, 'q']), 'Piste B']], 'the plain composer answers the existing native question ID');
  assert.equal(submits, 0, 'nothing is queued behind the durable question');
  assert.deepEqual([...panel().querySelectorAll('[data-testid="question-option"]')].map(node => node.textContent), ['Piste A', 'Piste B']);
  assert.match(panel().textContent, /Voici deux pistes\.[\s\S]*Laquelle préférez-vous/, 'the text of a round that calls tools stays');
  await settle();
  assert.ok(panel().querySelector('[data-testid="pm-mockup-thumb-run-frame"]')?.getAttribute('srcdoc')?.includes('Fictional piste-a.html'), 'a live thumbnail');
  await act(async () => panel().querySelectorAll('[data-testid="pm-mockup-open"]')[1].click());
  await settle();
  const frame = panel().querySelector('[data-testid="pm-mockup-view"] [data-testid="pm-mockup-full-run-frame"]');
  assert.ok(frame?.getAttribute('srcdoc')?.includes('Fictional piste-b.html'), 'the mockup opens full height in the sheet');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts', 'in a sandboxed frame (opaque origin)');
  if (surface === 'member') assert.equal(panel().dataset.mode, 'full');
  assert.deepEqual([...new Set(reads)], ['maquettes/piste-a.html', 'maquettes/piste-b.html'], 'one read per revision');
  await act(async () => panel().querySelector('[data-testid="pm-mockup-back"]').click());
  assert.equal(panel().querySelector('[data-testid="pm-mockup-view"]'), null, '« ‹ Retour » goes back to the thread');
  assert.equal(panel().querySelectorAll('[data-testid="pm-mockup"]').length, 2);
  if (surface === 'studio') {
    await act(async () => panel().querySelectorAll('[data-testid="pm-mockup-open"]')[1].click());
    // A different host-owned controller is a new resource/subject boundary, even at equal descriptor revisions.
    spec.controller = new Proxy({ getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } }, { get: (target, key) => key in target ? target[key] : async () => {} });
    await render(choose, run()); await settle();
    assert.equal(panel().querySelector('[data-testid="pm-mockup-view"]'), null, 'a new controller cannot retain the old opened resource');
    assert.equal(reads.length, 4, 'a new controller reads its own revisions, never the previous subject cache');
    const hostArtifacts = { recognise: () => undefined, open: () => {} };
    spec.chatProps.artifacts = hostArtifacts;
    await render(choose, run());
    assert.equal(panel().querySelectorAll('[data-testid="pm-mockup"]').length, 0, 'explicit host artifact configuration still wins');
  }
});
