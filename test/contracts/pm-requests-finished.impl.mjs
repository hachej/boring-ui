import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// « Mes demandes » is the one board, finished requests folded (decided 2026-10-29, 10-31): the one line's task source (`useHostTasks`) behind the public
// PmPanelProvider + ImproveLayout, against a fake host task API. Fictional records only. PM_SOURCE_ROOT runs it against another checkout.
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.PM_SOURCE_ROOT ?? root;
const out = `${root}.cache/pm-requests-finished-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: `export { PmPanelProvider, ImproveLayout } from './registry/pm-panel/pm-panel'; export { useHostTasks, toTaskRecord } from './registry/pm-panel/pm-task-source'; export { pmTextFr } from './registry/pm-panel/pm-text';`, resolveDir: source, loader: 'tsx' },
  outfile: `${out}/panel.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent', alias: { '@': `${root}examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${root}packages/ui/styles/file-tree.css` } });

const id = n => `0b8e2c7e-1111-4222-8333-9444555566${String(n).padStart(2, '0')}`;
const OPEN = [
  { id: id(1), ref: 'D-301', title: 'Plan du jour : photo du déjeuner', state: 'open', updated: '2026-10-28T09:00:00Z', waiting_on_you: false, is_requester: true },
  { id: id(2), ref: 'D-302', title: 'Un repère sur la jauge', state: 'working', updated: '2026-10-27T09:00:00Z', waiting_on_you: false, is_requester: true },
];
const FINISHED = [
  { id: id(3), ref: 'D-290', title: 'Graphique hebdomadaire', state: 'done', closed_reason: 'shipped', updated: '2026-10-20T09:00:00Z' },
  { id: id(4), ref: 'D-291', title: 'Rappel du dimanche', state: 'closed', closed_reason: 'withdrawn', updated: '2026-10-22T09:00:00Z' },
  { id: id(5), ref: 'D-292', title: 'Mode sombre des cartes', state: 'closed', closed_reason: 'closed', updated: '2026-10-21T09:00:00Z' },
];

async function mount(t, host) {
  const window = new Window({ url: 'https://fictional.invalid/apps/coach/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'fetch' ? host : window[name];
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
  const snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries: [], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  function App() {
    const tasks = useHostTasks('https://fictional.invalid/apps/coach/_tasks/api', 'alice', controller, pmTextFr);
    return h(PmPanelProvider, { spec: { controller, ...(tasks ? { tasks } : {}), chatProps: { locale: 'fr' } }, open: true, close: () => {}, appName: 'Coach', locale: 'fr' },
      h(ImproveLayout, { screen: 'Ma journée' }, h('main', null, 'Fictional page')));
  }
  // The task source reads 300 ms after a change.
  const wait = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  const click = selector => act(async () => document.querySelector(selector).click());
  await act(async () => ui.render(h(App)));
  await wait();
  await click('[data-testid="workspace-bar-tasks"]');
  // The panel opens through the kit's popover, later on a loaded runner.
  for (let tries = 0; tries < 20 && !document.querySelector('[data-testid="pm-task-board-seam"]'); tries++) await wait();
  const seam = () => document.querySelector('[data-testid="pm-task-board-seam"]');
  const finished = () => seam().querySelector('[data-task-group="finished"]');
  const toggle = () => finished()?.querySelector('button');
  const openCards = () => [...seam().querySelectorAll('[data-task-column] [data-task-card]')].map(card => card.dataset.taskCard);
  const finishedCards = () => [...(finished()?.querySelectorAll('[data-task-card]') ?? [])].map(card => ({ id: card.dataset.taskCard, text: card.textContent }));
  // « Retirer » lives in the request's detail, not on the card.
  const withdraw = async n => { await click(`[data-task-open="${id(n)}"]`); await click('[data-testid="pm-withdraw"]'); await click('[data-testid="pm-withdraw-confirm"]'); await wait(); await click('[data-task-back]'); };
  return { container, act, wait, click, seam, finished, toggle, openCards, finishedCards, withdraw };
}

const list = tasks => async (url, init) => init?.method === 'POST' ? new Response(null, { status: 404 }) : Response.json({ tasks: tasks(), cursor: '1' });

test('open requests in the columns; finished ones folded under « Terminées · n », labelled, without actions', async t => {
  const app = await mount(t, list(() => [...OPEN, ...FINISHED]));
  assert.deepEqual(app.openCards(), [id(1), id(2)], 'the columns: not done, not closed');
  assert.equal(app.toggle()?.textContent, 'Terminées · 3');
  assert.equal(app.toggle().getAttribute('aria-expanded'), 'false', 'collapsed by default');
  assert.deepEqual(app.finishedCards(), [], 'no finished card while collapsed');
  await app.click('[data-task-group="finished"] button');
  assert.equal(app.toggle().getAttribute('aria-expanded'), 'true');
  const cards = app.finishedCards();
  assert.deepEqual(cards.map(card => card.id), [id(4), id(5), id(3)], 'newest first');
  assert.match(cards[0].text, /Retirée/); assert.match(cards[1].text, /Fermée/); assert.match(cards[2].text, /En ligne/);
  assert.equal(app.seam().querySelector('[data-testid="pm-withdraw"]'), null, 'cards carry no action');
  await app.click(`[data-task-open="${id(1)}"]`);
  assert.ok(app.seam().querySelector('[data-task-detail]'), 'the detail opens in place');
  assert.ok(app.seam().querySelector('[data-testid="pm-withdraw"]'), 'an open request keeps « Retirer » in its detail');
  await app.click('[data-task-back]');
  await app.click(`[data-task-open="${id(4)}"]`);
  assert.equal(app.seam().querySelector('[data-testid="pm-withdraw"]'), null, 'a finished request has no action');
});

test('no finished request: no « Terminées » section', async t => {
  const app = await mount(t, list(() => OPEN));
  assert.deepEqual(app.openCards(), [id(1), id(2)]);
  assert.equal(app.finished(), null);
  assert.doesNotMatch(app.seam().textContent, /Terminées/);
});

test('a waiting request is answered on the board: its question and « Confirmer » in the detail, or the viewer\'s own words', async t => {
  const tasks = [{ id: id(6), ref: 'D-306', title: 'Choisir une piste', state: 'waiting', waiting_on_you: true, is_requester: true, question: 'Je lance cette demande ?', updated: '2026-10-29T08:00:00Z' }];
  const answers = [];
  const app = await mount(t, async (url, init) => {
    if (init?.method !== 'POST') return Response.json({ tasks, cursor: '1' });
    answers.push([String(url).split('/').at(-2), JSON.parse(init.body).text]);
    Object.assign(tasks[0], { state: 'working', waiting_on_you: false });
    return Response.json({ task: tasks[0] });
  });
  const card = app.seam().querySelector(`[data-task-column="needs-you"] [data-task-card="${id(6)}"]`);
  assert.match(card?.textContent ?? '', /Je lance cette demande \?/, 'the card says what is wanted');
  await app.click(`[data-task-open="${id(6)}"]`);
  await app.click('[data-task-question] button');
  assert.deepEqual(answers, [[id(6), 'Confirmer']]);
  await app.wait();
  assert.ok(app.seam().querySelector(`[data-task-column="progress"] [data-task-card="${id(6)}"]`), 'it leaves Needs you at once');
});

for (const body of ['empty', '{ task }']) test(`after « Retirer » (200, ${body} body) the card folds as « Retirée », and the count follows`, async t => {
  const tasks = structuredClone([...OPEN, ...FINISHED]);
  const withdrawals = [];
  const app = await mount(t, async (url, init) => {
    if (init?.method !== 'POST') return Response.json({ tasks, cursor: '1' });
    const target = tasks.find(task => String(url).includes(task.id));
    withdrawals.push(target.id);
    // The host closes it; its record carries no closed_reason here: the session remembers « Retirée ».
    Object.assign(target, { state: 'closed', updated: '2026-10-29T08:10:00Z' });
    return body === 'empty' ? new Response(null, { status: 200 }) : Response.json({ task: target });
  });
  assert.equal(app.toggle()?.textContent, 'Terminées · 3');
  await app.withdraw(1);
  assert.deepEqual(withdrawals, [id(1)]);
  assert.deepEqual(app.openCards(), [id(2)], 'it leaves the columns');
  assert.equal(app.toggle().textContent, 'Terminées · 4', 'the count follows');
  assert.equal(app.toggle().getAttribute('aria-expanded'), 'true', 'closing the detail follows the card into its fold');
  assert.equal(app.finishedCards()[0].id, id(1), 'newest first');
  assert.match(app.finishedCards()[0].text, /Retirée/);
  await app.wait();
  assert.match(app.finishedCards()[0].text, /Retirée/, 'still « Retirée » after the list is read again without closed_reason');
});

for (const later of ['reopened', 'shipped']) test(`after « Retirer », the host's newer word wins (${later})`, async t => {
  const tasks = structuredClone(OPEN);
  const app = await mount(t, async (url, init) => {
    if (init?.method !== 'POST') return Response.json({ tasks, cursor: '1' });
    Object.assign(tasks[0], { state: 'closed' });
    return new Response(null, { status: 200 });
  });
  await app.withdraw(1);
  assert.deepEqual(app.openCards(), [id(2)]);
  Object.assign(tasks[0], later === 'reopened' ? { state: 'open', updated: '2099-01-01T09:00:00Z' } : { state: 'done', closed_reason: 'shipped' });
  await app.click('[data-testid="workspace-bar-tasks"]'); await app.click('[data-testid="workspace-bar-tasks"]'); await app.wait();
  if (later === 'reopened') assert.ok(app.openCards().includes(id(1)), 'a request reopened after the withdraw is open again');
  else {
    if (app.toggle()?.getAttribute('aria-expanded') === 'false') await app.click('[data-task-group="finished"] button');
    assert.match(app.seam().querySelector(`[data-task-card="${id(1)}"]`)?.textContent ?? '', /En ligne/, 'shipped after the withdraw is « En ligne »');
  }
});

test('the label: closed_reason first; done alone is « En ligne », any other closed « Fermée »; open has none', async () => {
  const { toTaskRecord } = await import(pathToFileURL(`${out}/panel.mjs`).href);
  const outcome = fields => toTaskRecord({ id: 'x', title: 'T', ...fields }, 'alice').outcome;
  assert.equal(outcome({ state: 'done', closed_reason: 'shipped' }), 'live');
  assert.equal(outcome({ state: 'done' }), 'live', 'done without closed_reason');
  assert.equal(outcome({ state: 'closed', closed_reason: 'shipped' }), 'live');
  assert.equal(outcome({ state: 'closed', closed_reason: 'withdrawn' }), 'withdrawn');
  assert.equal(outcome({ state: 'closed', closed_reason: 'closed' }), 'closed');
  assert.equal(outcome({ state: 'closed' }), 'closed', 'no field: « Fermée »');
  assert.equal(outcome({ state: 'closed', closed_reason: 'toString' }), 'closed', 'an unknown reason: « Fermée »');
  for (const state of ['open', 'working', 'waiting']) assert.equal(outcome({ state }), undefined, state);
});


test('member requests: short display titles in columns by who acts next, technical folded, the full need in the detail', async t => {
  const tasks = [
    { ...OPEN[0], display: 'Photo du déjeuner', title: 'Je voudrais une photo de mon déjeuner chaque jour avec tous les détails', confirmed_at: '2026-10-29T08:00:00Z' },
    { ...OPEN[1], display: 'Repère sur la jauge', status: 'verifying' },
    { id: id(6), title: 'Choisir une piste', state: 'waiting', waiting_on_you: true, updated_at: '2026-10-20T08:00:00Z' },
    { id: id(7), title: 'Un bouton bloqué', state: 'working', status: 'blocked' },
    { id: id(8), title: 'Infrastructure fictive', state: 'working', technical: true },
    { id: id(9), title: 'Ancienne demande', state: 'working', status: 'abandoned', waiting_on_you: true },
  ];
  const app = await mount(t, list(() => tasks));
  assert.equal(app.openCards()[0], id(6), 'needs-you comes first, before more recent work');
  const card = n => app.seam().querySelector(`[data-task-card="${id(n)}"]`);
  const column = n => card(n).closest('[data-task-column]')?.dataset.taskColumn;
  assert.equal(column(6), 'needs-you'); assert.equal(column(7), 'blocked'); assert.equal(column(1), 'progress');
  assert.match(card(2).textContent, /Vérification/);
  assert.equal(card(8), null, 'technical cards are not mounted until expanded');
  assert.doesNotMatch(card(1).textContent, /Je voudrais/);
  await app.click(`[data-task-open="${id(1)}"]`);
  assert.match(app.seam().querySelector('[data-task-detail]')?.textContent ?? '', /Je voudrais une photo/);
  await app.click('[data-task-back]');
  await app.click('[data-task-group="technical"] button');
  assert.match(card(8)?.textContent ?? '', /Infrastructure fictive/);
  await app.click('[data-task-group="finished"] button');
  assert.match(card(9)?.textContent ?? '', /Retirée/, 'abandoned is finished even with stale waiting flag');
});
