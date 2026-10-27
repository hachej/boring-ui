import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const out = resolve('.cache/task-board-test'); mkdirSync(out, { recursive: true });
await build({ entryPoints: ['registry/task-board/task-board.tsx'], outfile: `${out}/task-board.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': resolve('examples/app-shell') }, logLevel: 'silent' });
const now = Date.parse('2026-10-20T12:00:00Z');
const task = (id, state = 'open', extra = {}) => ({ id, title: `Task ${id}`, state, ...extra });
const tasks = [task('old', 'open', { updated_at: '2026-10-18' }), task('new', 'open', { updated_at: '2026-10-20' }), task('work', 'working'), task('other', 'waiting', { waiting_on: { who: 'Camille' }, updated_at: '2026-10-20' }), task('you', 'waiting', { waiting_on: { who: 'viewer', question: 'Can we ship?' }, updated_at: '2026-10-18', risk: 'high', createdBy: 'viewer', children: { done: 2, total: 5 } }), task('done', 'done'), task('closed', 'closed')];
async function fixture(t, props = {}, { width = 1440, cssWidth, saved = {}, denied = false, hydrate = false } = {}) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame)$/.test(name) ? window[name].bind(window) : window[name] });
  window.innerWidth = width;
  if (cssWidth !== undefined) {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const media = matchMedia(query);
      if (query === '(max-width: 640px)') Object.defineProperty(media, 'matches', { get: () => cssWidth <= 640 });
      return media;
    };
  }
  for (const [key, value] of Object.entries(saved)) window.localStorage.setItem(key, value);
  if (denied) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Denied'); } });
  const { createElement: h, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const api = await import(pathToFileURL(`${out}/task-board.mjs`));
  const host = document.createElement('div'); document.body.append(host);
  let current = { tasks, viewerId: 'viewer', now, ...props };
  const hydrationErrors = [];
  let root;
  if (hydrate) {
    const { renderToString } = await import('react-dom/server');
    const browserWindow = globalThis.window;
    try {
      delete globalThis.window;
      host.innerHTML = renderToString(h(api.TaskBoard, current));
    } finally { globalThis.window = browserWindow; }
    const { hydrateRoot } = await import('react-dom/client');
    await act(async () => { root = hydrateRoot(host, h(api.TaskBoard, current), { onRecoverableError: error => hydrationErrors.push(error.message) }); });
  } else root = createRoot(host);
  const render = async patch => { current = { ...current, ...patch }; await act(async () => root.render(h(api.TaskBoard, current))); };
  await render({});
  const run = async fn => { await act(async () => fn()); };
  const click = async selector => { const element = typeof selector === 'string' ? document.querySelector(selector) : selector; assert.ok(element, `Missing ${selector}`); await run(() => element.click()); };
  const button = text => [...document.querySelectorAll('button')].find(button => button.textContent === text);
  const group = state => document.querySelector(`[data-task-state="${state}"]`);
  const ids = state => [...group(state).querySelectorAll('[data-task-entry]')].map(element => element.getAttribute('data-task-entry'));
  const input = async value => run(() => { const input = document.querySelector('input'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
  const resize = async width => run(() => { window.innerWidth = width; window.dispatchEvent(new window.Event('resize')); });
  const detail = async props => { await act(async () => root.render(h(api.TaskDetail, props))); };
  t.after(async () => { await act(async () => root.unmount()); host.remove(); window.close(); for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; });
  return { window, api, h, act, root, render, run, click, button, group, ids, input, resize, detail, hydrationErrors, board: () => document.querySelector('[data-boring=task-board]') };
}

test('public five states group in order; viewer waiting first, updated descending, stable equal/invalid dates last', async t => {
  const f = await fixture(t, { tasks: [...tasks, task('equal', 'open', { updated_at: '2026-10-20' }), task('invalid', 'open', { updated_at: 'bad' }), task('missing'), task('second-you', 'waiting', { waiting_on: { who: 'viewer' }, updated_at: '2026-10-19' })] });
  assert.deepEqual(f.api.TASK_STATES, ['open', 'working', 'waiting', 'done', 'closed']);
  assert.deepEqual([...document.querySelectorAll('[data-task-state]')].map(e => e.dataset.taskState), f.api.TASK_STATES);
  assert.deepEqual(f.ids('open'), ['new', 'equal', 'old', 'invalid', 'missing']);
  assert.deepEqual(f.ids('waiting'), ['second-you', 'you', 'other']);
  assert.match(f.group('waiting').textContent, /2 on you/);
  assert.equal(f.group('done').querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false');
  assert.equal(f.group('closed').querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false');
  const card = document.querySelector('[data-task-id=you]');
  assert.match(card.textContent, /Waiting on you.*High risk.*2\/5/); assert.equal(card.querySelector('[title="Can we ship?"]').textContent, 'Waiting on you');
  assert.match(document.querySelector('[data-task-id=old] time').textContent, /2 days ago/);
});

test('collapse choices survive layout switches and live state updates; sections show folded label and count', async t => {
  const f = await fixture(t); await f.click(f.group('done').querySelector('button'));
  assert.deepEqual(f.ids('done'), ['done']);
  await f.click('[aria-label=Sections]'); assert.equal(f.board().dataset.layout, 'sections');
  assert.equal(f.group('done').querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'true');
  assert.match(f.group('closed').textContent, /Show 1 closed/);
  await f.click(f.group('open').querySelector('button')); await f.click('[aria-label=Kanban]');
  assert.equal(f.group('open').querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false');
  await f.render({ tasks: tasks.map(item => item.id === 'work' ? { ...item, state: 'done' } : item) });
  assert.deepEqual(f.ids('done'), ['work', 'done']); assert.deepEqual(f.ids('working'), []);
});

test('finished rail label is part of its keyboard-operable expansion control', async t => {
  const f = await fixture(t);
  const label = [...f.group('done').querySelectorAll('span')].find(element => element.textContent === 'Done');
  assert.ok(label.closest('button'), 'the visible rail label must activate its disclosure');
  await f.click(label);
  assert.equal(f.group('done').querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(f.ids('done'), ['done']);
});

test('both layouts compose the host ScrollArea and preserve custom card identity while switching', async t => {
  const f = await fixture(t);
  await f.render({ renderCard: item => f.h('input', { 'aria-label': item.id, defaultValue: item.title }) });
  assert.ok(f.board().querySelector('[data-slot=scroll-area]'), 'scrolling uses the host primitive');
  const input = document.querySelector('[aria-label=new]'); input.value = 'Kept across layouts';
  await f.click('[aria-label=Sections]');
  assert.equal(document.querySelector('[aria-label=new]'), input);
  assert.equal(input.value, 'Kept across layouts');
});

test('uncontrolled default and stored layout, changes persisted, denied storage is harmless', async t => {
  const f = await fixture(t, { storageKey: 'tasks', defaultLayout: 'sections' }, { saved: { tasks: 'kanban' } });
  assert.equal(f.board().dataset.layout, 'kanban'); await f.click('[aria-label=Sections]');
  assert.equal(f.window.localStorage.getItem('tasks'), 'sections');
});

test('invalid persisted layout falls back; denied getter and writes do not break controls', async t => {
  const f = await fixture(t, { storageKey: 'tasks', defaultLayout: 'sections' }, { denied: true });
  assert.equal(f.board().dataset.layout, 'sections'); await f.click('[aria-label=Kanban]'); assert.equal(f.board().dataset.layout, 'kanban');
});

test('denied writes are harmless while reads and state changes remain usable', async t => {
  const f = await fixture(t, { storageKey: 'tasks' });
  const storage = f.window.localStorage;
  Object.defineProperty(f.window, 'localStorage', { configurable: true, value: { getItem: key => storage.getItem(key), setItem: () => { throw new Error('Quota exceeded'); } } });
  await f.click('[aria-label=Sections]'); assert.equal(f.board().dataset.layout, 'sections');
  assert.equal(f.window.localStorage.getItem('tasks'), 'kanban');
});

test('key changes restore the new key without overwriting it or losing collapse choices', async t => {
  const f = await fixture(t, { storageKey: 'first' }, { saved: { first: 'kanban', second: 'sections', invalid: 'garbage' } });
  await f.click(f.group('done').querySelector('button')); await f.render({ storageKey: 'second' });
  assert.equal(f.board().dataset.layout, 'sections'); assert.equal(f.window.localStorage.getItem('second'), 'sections');
  assert.equal(f.group('done').querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'true');
  await f.render({ storageKey: 'invalid', defaultLayout: 'kanban' }); assert.equal(f.board().dataset.layout, 'kanban');
});

test('server markup hydrates with a different saved layout without losing storage or regenerating the board', async t => {
  const f = await fixture(t, { storageKey: 'tasks', now: undefined }, { saved: { tasks: 'sections' }, hydrate: true });
  assert.deepEqual(f.hydrationErrors, [], 'saved preference must be restored after matching server markup');
  assert.equal(f.board().dataset.layout, 'sections');
  assert.equal(f.window.localStorage.getItem('tasks'), 'sections');
});

test('controlled layout only requests a change, prop wins and persistence follows accepted preference', async t => {
  const requests = []; const f = await fixture(t, { layout: 'kanban', onLayoutChange: next => requests.push(next), storageKey: 'tasks' });
  await f.click('[aria-label=Sections]'); assert.deepEqual(requests, ['sections']); assert.equal(f.board().dataset.layout, 'kanban');
  assert.equal(f.window.localStorage.getItem('tasks'), 'kanban'); await f.render({ layout: 'sections' });
  assert.equal(f.board().dataset.layout, 'sections'); assert.equal(f.window.localStorage.getItem('tasks'), 'sections');
});

test('390 and 640 force sections without callbacks or preference writes; 641 restores kanban', async t => {
  const requests = []; const f = await fixture(t, { storageKey: 'tasks', onLayoutChange: next => requests.push(next) }, { width: 390 });
  assert.equal(f.board().dataset.layout, 'sections'); assert.equal(document.querySelector('[aria-label=Kanban]'), null);
  assert.equal(f.window.localStorage.getItem('tasks'), 'kanban'); await f.resize(640); assert.equal(f.board().dataset.layout, 'sections');
  await f.resize(641); assert.equal(f.board().dataset.layout, 'kanban'); assert.deepEqual(requests, []);
  await f.resize(390); await f.render({ layout: 'sections' }); await f.resize(1440); assert.equal(f.board().dataset.layout, 'sections');
});

test('phone fallback follows CSS viewport even when mobile shrink-to-fit inflates innerWidth', async t => {
  const f = await fixture(t, {}, { width: 648, cssWidth: 390 });
  assert.equal(f.board().dataset.layout, 'sections');
  assert.equal(document.querySelector('[aria-label=Kanban]'), null);
});

test('search matches title and id, filter chips combine, counts reflect the visible tasks', async t => {
  const f = await fixture(t); await f.click(f.button('Waiting on me')); assert.deepEqual(f.ids('waiting'), ['you']); assert.deepEqual(f.ids('open'), []);
  assert.match(f.group('waiting').querySelector('button').textContent, /1/);
  await f.click(f.button('High risk')); await f.click(f.button('Mine')); assert.deepEqual(f.ids('waiting'), ['you']);
  await f.input('OTHER'); assert.equal(document.querySelectorAll('[data-task-entry]').length, 0); assert.match(document.body.textContent, /No tasks match/);
  await f.click(f.button('Waiting on me')); await f.click(f.button('High risk')); await f.click(f.button('Mine')); assert.deepEqual(f.ids('waiting'), ['other']);
  await f.input('task new'); assert.deepEqual(f.ids('open'), ['new']);
});

test('viewer filters are absent without viewerId and stale selections cannot hide tasks', async t => {
  const f = await fixture(t); await f.click(f.button('Mine')); await f.render({ viewerId: undefined });
  assert.equal(f.button('Mine'), undefined); assert.equal(f.button('Waiting on me'), undefined); assert.deepEqual(f.ids('open'), ['new', 'old']);
  assert.equal(f.group('waiting').textContent.includes('on you'), false);
});

test('toolbar can be omitted; whole empty board has one sentence and optional host action', async t => {
  const f = await fixture(t, { tasks: [], showToolbar: false, emptyAction: 'Ask your agent to create a task' });
  assert.equal(document.querySelector('[data-task-toolbar]'), null); assert.equal(document.querySelector('[data-task-state]'), null);
  assert.match(document.body.textContent, /No tasks yet.*Ask your agent/);
  await f.render({ tasks: [task('only')], showToolbar: true });
  assert.equal(f.group('waiting').querySelector('p').textContent, '—'); assert.equal(f.group('waiting').querySelector('p').getAttribute('aria-label'), 'No tasks');
});

test('default cards expose one surface, stock keyboard semantics and exact onOpen task; passive cards are not buttons', async t => {
  const opened = []; const f = await fixture(t, { onOpen: item => opened.push(item) });
  const card = document.querySelector('[data-task-id=you]'); assert.equal(card.getAttribute('role'), 'button');
  const description = document.getElementById(card.getAttribute('aria-describedby'));
  assert.ok(description, 'keyboard users receive the task signals, not just its title');
  assert.match(description.textContent, /Waiting on you.*Can we ship\?.*High risk.*2\/5/);
  assert.equal(card.querySelectorAll('[data-slot=card]').length, 0);
  await f.run(() => { card.focus(); card.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); });
  assert.equal(opened.length, 1); assert.equal(opened[0], tasks[4]);
  await f.run(() => { card.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })); card.dispatchEvent(new f.window.KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true })); });
  assert.equal(opened.length, 2);
  await f.render({ onOpen: undefined }); assert.equal(document.querySelector('[data-task-id=you]').hasAttribute('role'), false);
});

test('custom cards own their interaction, stable keys preserve mounted cards across updates in a group', async t => {
  const f = await fixture(t); const renderCard = item => f.h('input', { 'aria-label': item.id, defaultValue: item.title });
  await f.render({ renderCard }); const input = document.querySelector('[aria-label=new]'); input.value = 'Kept local';
  await f.render({ tasks: [...tasks].reverse() }); assert.equal(document.querySelector('[aria-label=new]'), input); assert.equal(input.value, 'Kept local');
  assert.equal(document.querySelector('[data-task-id]'), null);
});

test('partial i18n translates state, toolbar, counts, waiting, relative time, empty and folded text', async t => {
  const f = await fixture(t, { defaultLayout: 'sections', labels: { board: 'Tâches', open: 'À faire', waitingOnYou: 'À vous', onYou: n => `${n} pour vous`, count: n => `(${n})`, showGroup: (n, state) => `Afficher ${n} ${state}`, relativeTime: (n, unit) => `${n} ${unit}`, highRisk: 'Risque élevé', children: (done, total) => `${done} sur ${total}`, emptyGroup: 'Vide', emptyGroupLabel: 'Aucune tâche' } });
  assert.equal(f.board().getAttribute('aria-label'), 'Tâches'); assert.match(f.group('open').textContent, /À faire\(2\)/);
  assert.match(f.group('waiting').textContent, /1 pour vous.*À vous.*Risque élevé.*2 sur 5/);
  assert.match(f.group('done').textContent, /Afficher 1 Done/); assert.match(document.querySelector('[data-task-id=old]').textContent, /-2 day/);
});

test('default detail history timestamps do not depend on the rendering process timezone', async t => {
  const f = await fixture(t);
  const timezone = process.env.TZ;
  try {
    const selected = { ...tasks[0], history: [{ at: '2026-10-20T12:00:00Z', text: 'Created' }] };
    process.env.TZ = 'UTC'; await f.detail({ task: selected });
    const serverTime = document.querySelector('time').textContent;
    process.env.TZ = 'America/New_York'; await f.detail({ task: selected });
    assert.equal(document.querySelector('time').textContent, serverTime);
    assert.match(serverTime, /UTC/);
  } finally { if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone; }
});

test('TaskDetail uses kit safe Markdown, full question/history and translated detail labels without changing source', async t => {
  const f = await fixture(t);
  const selected = { ...tasks[4], title: 'Review the fictional launch', spec: '# Launch\n\n**Bold** and [safe](https://example.invalid).\n\n[bad](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![picture](https://example.invalid/image.png)\n\n```txt\nFictional code\n```\n\n- [x] Reviewed', history: [{ id: 'h1', at: '2026-10-20', text: 'Camille requested review.' }, { at: 'bad', text: 'Uncertain time' }], parent: 'D-1', route: 'review', labels: ['launch'] };
  const before = JSON.stringify(selected);
  await f.detail({ task: selected, viewerId: 'viewer', labels: { details: 'Détail', question: 'Question complète', specification: 'Cahier des charges', history: 'Historique', unknownTime: 'Date inconnue', dateTime: date => `Date: ${date}`, markdown: { copyCode: 'Copier le code', taskStatus: 'Statut de la tâche' } } });
  assert.equal(document.querySelector('[data-boring=task-detail]').getAttribute('aria-label'), 'Détail');
  assert.equal(document.querySelector('strong').textContent, 'Bold'); assert.equal(document.querySelector('h1').textContent, 'Launch');
  assert.equal(document.querySelectorAll('a').length, 1); assert.equal(document.querySelector('a').getAttribute('href'), 'https://example.invalid/');
  assert.ok(document.querySelector('[aria-label="Copier le code"]')); assert.ok(document.querySelector('[aria-label="Statut de la tâche"]'));
  assert.equal(document.querySelector('img,script'), null); assert.match(document.body.textContent, /Can we ship\?/); assert.match(document.body.textContent, /Camille requested review/); assert.match(document.body.textContent, /Date inconnue/);
  assert.match(document.body.textContent, /Cahier des charges/); assert.match(document.body.textContent, /Historique/); assert.equal(JSON.stringify(selected), before);
});
