import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const out = resolve('.cache/task-board-test'); mkdirSync(out, { recursive: true });
const tasks = [
  { id: 'orchard', number: 201, title: 'Fictional orchard map', state: 'waiting', requesterId: 'alice', requester: '<script>not executable</script>', waiting_on_you: true, waiting_on: { who: 'Alice', question: 'Which route?' }, screen: 'Garden', capture: 'Map capture', captureCount: 2, age: '12m', spec: '<script>not executable</script>', updated_at: '2026-10-27T10:00:00Z', questions: [{ id: 'route', text: 'Choose a route', options: ['River', { label: 'Hill', value: 'hill' }] }], history: [{ note: 'Request received', actor: 'PM', at: '2026-10-27T09:00:00Z' }] },
  { id: 'picnic', number: 202, title: 'Fictional picnic plan', state: 'working', requesterId: 'bob', updated_at: '2026-10-28T10:00:00Z' },
  { id: 'kites', number: 203, title: 'Fictional kite colors', state: 'open', status: 'À essayer', requesterId: 'alice', screen: 'Garden', captureCount: 2, updated_at: '2026-10-28T09:00:00Z' },
  { id: 'done', title: 'Fictional finished task', state: 'done' },
  { id: 'closed', title: 'Fictional closed task', state: 'closed' },
];
let sequence = 0;

test('answered questions name their actor, Other is a distinct host intent, files use the injected right viewer and remain task-bound', async t => {
  const other = [], opened = [], shown = [];
  const record = { ...tasks[0], questions: [...tasks[0].questions, { id: 'time', text: 'When?', answer: 'Noon', answeredBy: 'Sam' }], files: [{ path: 'docs/tasks/D-201/brief.md', name: 'Brief' }] };
  const f = await fixture(t, { tasks: [record, tasks[1]], onAnswer: () => {}, onOther: (...args) => other.push(args),
    onOpenFile: (...args) => opened.push(args), onShowFile: (...args) => shown.push(args),
    renderFile: (task, file, api) => f.h('div', { 'data-host-viewer': task.id }, file.path,
      f.h('button', { onClick: api.onShowFile }, 'Montrer'), f.h('button', { onClick: api.onClose }, 'Close file')) });
  await f.click('[data-task-open=orchard]');
  assert.match(document.querySelector('[data-task-answered=time]').textContent, /Sam: Noon/);
  await f.click('[data-task-other=route]');
  const field = document.querySelector('[data-task-other-form=route] input');
  await f.run(() => { Object.getOwnPropertyDescriptor(f.window.HTMLInputElement.prototype, 'value').set.call(field, 'Along the river'); field.dispatchEvent(new f.window.Event('input', { bubbles: true })); });
  await f.click('[data-task-other-form=route] button[type=submit]');
  assert.equal(other[0][1].id, 'route'); assert.equal(other[0][2], 'Along the river', 'Other sends the typed text inline');
  await f.click('[data-task-file]');
  assert.equal(opened[0][0].id, 'orchard');
  assert.ok(document.querySelector('[data-task-side]').isConnected);
  assert.ok(document.querySelector('[data-task-list]').isConnected);
  assert.equal(document.querySelector('[data-task-list]').classList.contains('hidden'), false);
  assert.equal(document.querySelector('[data-task-detail]').dataset.taskDetail, 'orchard');
  await f.click('[data-host-viewer] button'); assert.equal(shown[0][1].path, record.files[0].path);
  await f.click('[data-host-viewer] button:last-child'); assert.equal(document.querySelector('[data-task-file-pane]'), null);
  await f.click('[data-task-file]');
  await f.render({ selectedTask: 'picnic' }); assert.equal(document.querySelector('[data-task-file-pane]'), null);
  await f.render({ selectedTask: 'orchard', tasks: [{ ...record, files: [] }] }); assert.equal(document.querySelector('[data-task-file-pane]'), null);
});
async function fixture(t, props = {}, query = '?agent=pm') {
  const outfile = `${out}/board-${++sequence}.mjs`;
  await build({ entryPoints: ['registry/task-board/task-board.tsx'], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': resolve('examples/app-shell') }, logLevel: 'silent' });
  const window = new Window({ url: `https://fictional.invalid/app${query}` });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame)$/.test(name) ? window[name].bind(window) : window[name] });
  const { createElement: h, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { TaskBoard, TaskRequestCard } = await import(pathToFileURL(outfile));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = async next => act(async () => root.render(h(TaskBoard, { tasks, ...props, ...next })));
  await render();
  t.after(async () => { await act(async () => root.unmount()); host.remove(); window.close(); for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; });
  const click = async selector => { const node = document.querySelector(selector); assert.ok(node, selector); await act(async () => node.click()); };
  const run = async fn => act(async () => fn());
  return { render, click, run, window, root, h, act, TaskRequestCard };
}

test('board orders WAITING · WORKING · OPEN with Done/Closed list links, URL selection supports deep links, safe detail, question callback and keyboard back', async t => {
  const answers = [];
  const f = await fixture(t, { onAnswer: (...answer) => answers.push(answer) });
  assert.deepEqual([...document.querySelectorAll('[data-task-column]')].map(node => node.dataset.taskColumn), ['waiting', 'working', 'open']);
  assert.deepEqual([...document.querySelectorAll('[data-task-bar] > *')].map(node => node.textContent).filter(text => text !== '·'), ['3 open', 'Done 1', 'Closed 1']);
  assert.equal(document.querySelector('[data-task-column=waiting] h3').textContent, 'Waiting 11 on you');
  assert.equal(document.querySelector('[data-task-attention] [data-task-card=orchard]')?.dataset.taskCard, 'orchard', 'the card waiting on the viewer carries the attention edge');
  for (const [element, token] of [[document.querySelector('[data-task-column=waiting]'), '--task-column-radius'], [document.querySelector('[role=listitem]'), '--task-card-padding-y'], [document.querySelector('[role=listitem]'), '--task-card-padding-x'], [document.querySelector('[data-task-status]').parentElement, '--task-pill-font-size'], [document.querySelector('[data-task-on-you]').parentElement, '--task-pill-height']])
    assert.ok(element.className.includes(`var(${token},`), `the board reads the host token ${token}`);
  await f.click('[data-task-list-link=done]'); assert.deepEqual([...document.querySelectorAll('[data-task-card]')].map(node => node.dataset.taskCard), ['done']);
  await f.click('[data-task-list-link=open]');
  await f.click('[data-task-open=orchard]');
  assert.equal(new URL(f.window.location.href).searchParams.get('task'), 'orchard');
  assert.equal(new URL(f.window.location.href).searchParams.get('agent'), 'pm');
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Back to the tasks');
  assert.ok(document.querySelector('[data-task-detail]').textContent.includes('Screen: Garden'));
  assert.ok(document.querySelector('[data-task-detail]').textContent.includes('<script>not executable</script>'));
  assert.equal(document.querySelector('script'), null);
  await f.click('[data-task-question] button');
  assert.equal(answers[0][0].id, 'orchard'); assert.equal(answers[0][1].id, 'route'); assert.equal(answers[0][2], 'River');
  await f.run(() => document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  assert.equal(new URL(f.window.location.href).searchParams.get('task'), null);
  assert.equal(document.activeElement.dataset.taskOpen, 'orchard');
});

test('open questions precede bounded latest-three answers; full huge answers mount only on expansion; discussion is a distinct host intent', async t => {
  const discussed = [], answered = [];
  const huge = 'Fictional answer '.repeat(20000) + 'TAIL_SENTINEL';
  const record = { ...tasks[0], questions: [...Array.from({ length: 7 }, (_, i) => ({ id: `answer-${i}`, text: `Answered question ${i}`, answer: huge, answeredBy: 'Sam' })), tasks[0].questions[0]] };
  const f = await fixture(t, { tasks: [record], onAnswer: (...args) => answered.push(args), onDiscussQuestion: (...args) => discussed.push(args) });
  await f.click('[data-task-open=orchard]');
  assert.equal(document.querySelectorAll('[data-task-answered]').length, 3);
  assert.equal(document.querySelector('[data-task-answered]').dataset.taskAnswered, 'answer-6');
  assert.equal(document.querySelector('[data-task-answer-full]'), null);
  assert.ok(document.querySelector('[data-task-detail]').textContent.length < 5000);
  assert.equal(document.querySelector('[data-task-question]').compareDocumentPosition(document.querySelector('[aria-label="Answered questions"]')) & 4, 4);
  await f.click('[data-task-question] button'); assert.equal(answered.length, 1); assert.equal(discussed.length, 0);
  await f.click('[data-task-discuss]'); assert.equal(discussed[0][0].id, 'orchard'); assert.equal(discussed[0][1].id, 'route');
  await f.click('[data-task-answered] button'); assert.match(document.querySelector('[data-task-answer-full]').textContent, /TAIL_SENTINEL/);
  await f.click('[data-task-answered] button'); assert.equal(document.querySelector('[data-task-answer-full]'), null);
  await f.click('[data-task-show-answers]'); assert.equal(document.querySelectorAll('[data-task-answered]').length, 7);
  assert.equal(document.querySelector('[data-task-answer-full]'), null);
  await f.render({ tasks: [{ ...record, questions: record.questions.map(question => question.id === 'answer-0' ? { ...question, answeredAt: '2026-10-28T12:00:00Z' } : question) }] });
  assert.equal(document.querySelector('[data-task-answered]').dataset.taskAnswered, 'answer-0', 'host answer time takes precedence over source position');
});

test('compact mine prioritizes needs-you among own request cards and uses the host open path', async t => {
  const opened = []; const f = await fixture(t, { filter: 'mine', currentUser: 'alice', limit: 2, variant: 'compact', onOpen: task => opened.push(task.id) });
  assert.deepEqual([...document.querySelectorAll('[data-task-card]')].map(node => node.dataset.taskCard), ['orchard', 'kites']);
  assert.equal(document.querySelectorAll('[data-variant=compact][data-task-card]').length, 2);
  assert.doesNotMatch(document.body.textContent, /REQUEST/);
  assert.doesNotMatch(document.body.textContent, /Screen: Garden|captures/);
  assert.doesNotMatch(document.body.textContent, /Fictional picnic/);
  await f.click('[data-task-open=orchard]'); assert.deepEqual(opened, ['orchard']);
  assert.equal(new URL(f.window.location.href).searchParams.get('task'), null);
  assert.equal(document.querySelector('[data-task-side]'), null);
  await f.render({ currentUser: undefined }); assert.match(document.body.textContent, /No requests/);
});

test('deep-link alias, browser navigation and missing records remain explicit without exposing filtered-out data', async t => {
  const f = await fixture(t, {}, '?task=D-201&agent=pm');
  assert.equal(document.querySelector('[data-task-detail]').dataset.taskDetail, 'orchard');
  await f.run(() => { f.window.history.replaceState(null, '', '?task=missing'); f.window.dispatchEvent(new f.window.PopStateEvent('popstate')); });
  assert.match(document.body.textContent, /Task unavailable/);
  await f.run(() => { f.window.history.replaceState(null, '', '?agent=pm'); f.window.dispatchEvent(new f.window.PopStateEvent('popstate')); });
  assert.equal(document.querySelector('[data-task-side]'), null);
  await f.render({ tasks: tasks.filter(task => task.id !== 'orchard') });
  await f.run(() => { f.window.history.replaceState(null, '', '?task=orchard'); f.window.dispatchEvent(new f.window.PopStateEvent('popstate')); });
  assert.equal(document.querySelector('[data-task-detail]'), null);
});

test('return from a deep-linked terminal task switches to its list before restoring keyboard focus', async t => {
  const f = await fixture(t, {}, '?task=done');
  await f.click('[data-task-side] button');
  assert.equal(document.querySelector('[data-task-column]').dataset.taskColumn, 'done');
  assert.equal(document.activeElement.dataset.taskOpen, 'done');
});

test('controlled selection and shared PM request card keep confirmation as a host action', async t => {
  const selected = [], answers = []; const f = await fixture(t, { selectedTask: null, onSelectedTaskChange: id => selected.push(id) });
  await f.click('[data-task-open=orchard]'); assert.deepEqual(selected, ['orchard']);
  assert.equal(f.window.location.search, '?agent=pm');
  await f.render({ selectedTask: 'orchard' }); assert.ok(document.querySelector('[data-task-detail=orchard]'));
  await f.act(async () => f.root.render(f.h(f.TaskRequestCard, { task: tasks[0], variant: 'compact', locale: 'fr', viewerAction: 'confirmation', actions: f.h('button', { onClick: () => answers.push('confirmed') }, 'Confirmer') })));
  assert.doesNotMatch(document.body.textContent, /DEMANDE/); assert.match(document.body.textContent, /À confirmer/);
  assert.doesNotMatch(document.body.textContent, /Garden|captures/);
  await f.click('button'); assert.deepEqual(answers, ['confirmed']);
});

test('compact public cards show one localized product chip, terminal guards and host override without changing operator cards', async t => {
  const f = await fixture(t);
  const base = { id: 'product', title: 'A fictional product request', state: 'working' };
  const cases = [
    [{}, 'preparation', 'En préparation', 'Preparing'],
    [{ state: 'open', confirmed_at: '2026-10-29' }, 'preparation', 'En préparation', 'Preparing'],
    [{ state: 'waiting', waiting_on_you: true, status: 'blocked' }, 'needs-you', 'À vous', 'Needs you'],
    [{ state: 'working', waiting_on_you: true }, 'preparation', 'En préparation', 'Preparing'],
    [{ state: 'waiting', waiting_on_you: 'true' }, 'preparation', 'En préparation', 'Preparing'],
    [{ status: 'blocked' }, 'blocked', 'Bloquée', 'Blocked'],
    [{ status: 'verifying' }, 'verifying', 'Vérification', 'Verification'],
    [{ state: 'done', waiting_on_you: true }, 'live', 'En ligne', 'Live'],
    [{ status: 'shipped' }, 'live', 'En ligne', 'Live'],
    [{ state: 'closed', status: 'shipped', waiting_on_you: true }, 'live', 'En ligne', 'Live'],
    [{ state: 'closed', waiting_on_you: true, status: 'blocked' }, 'closed', 'Fermée', 'Closed'],
    [{ state: 'waiting', waiting_on_you: true, status: 'withdrawn' }, 'closed', 'Retirée', 'Withdrawn'],
    [{ state: 'waiting', waiting_on_you: true, status: 'abandoned' }, 'closed', 'Retirée', 'Withdrawn'],
    [{ status: 'closed', waiting_on_you: true }, 'closed', 'Fermée', 'Closed'],
    [{ status: 'Bloquée', waiting_on: { who: 'builder', type: 'builder' }, risk: 'high' }, 'preparation', 'En préparation', 'Preparing'],
  ];
  for (const [fields, status, fr, en] of cases) for (const locale of ['fr', 'en']) {
    await f.act(async () => f.root.render(f.h(f.TaskRequestCard, { task: { ...base, ...fields }, variant: 'compact', locale })));
    const chips = document.querySelectorAll('[data-slot=badge]');
    assert.equal(chips.length, 1, JSON.stringify(fields));
    assert.equal(chips[0].dataset.taskStatus, status);
    assert.equal(chips[0].textContent, locale === 'fr' ? fr : en);
  }
  await f.act(async () => f.root.render(f.h(f.TaskRequestCard, { task: base, variant: 'compact', pill: f.h('span', { 'data-host-pill': '' }, 'Déjà prévu') })));
  assert.equal(document.querySelectorAll('[data-task-status]').length, 0);
  assert.equal(document.querySelectorAll('[data-host-pill]').length, 1);
  await f.act(async () => f.root.render(f.h(f.TaskRequestCard, { task: base, variant: 'card' })));
  assert.equal(document.querySelector('[data-task-status]'), null, 'operator card stays unchanged');
});

test('compact titles are never cut mid-sentence, actions stay authorized host intents, original open record and native detail retain the full need', async t => {
  const opened = [], actions = [];
  const record = Object.freeze({ id: 'full', number: 743, title: 'Un besoin complet de plus de six mots à conserver sans aucune modification', spec: 'Full fictional specification', display: 'Choisir les repas', state: 'waiting', waiting_on_you: true, screen: 'PRIVATE_SCREEN', requester: 'PRIVATE_ACTOR', captureCount: 3 });
  const f = await fixture(t, { tasks: [record], variant: 'compact', locale: 'fr', viewerAction: 'confirmation', onOpen: task => opened.push(task) });
  await f.render({ cardActions: task => f.h('div', null, f.h('button', { onClick: () => actions.push(['edit', task]) }, 'Modifier'), f.h('button', { onClick: () => actions.push(['confirm', task]) }, 'Confirmer')) });
  assert.match(document.body.textContent, /Choisir les repas/);
  assert.doesNotMatch(document.body.textContent, /D-743|PRIVATE_|DEMANDE|REQUEST|captures/);
  assert.equal(document.querySelectorAll('[data-slot=badge]').length, 1);
  await f.click('[data-task-actions] button'); await f.click('[data-task-actions] button:last-child');
  assert.deepEqual(actions.map(([intent]) => intent), ['edit', 'confirm']);
  assert.equal(actions[0][1], record); assert.equal(actions[1][1], record);
  await f.click('[data-task-open=full]'); assert.equal(opened[0], record);
  assert.equal(opened[0].title, record.title); assert.equal(opened[0].spec, record.spec);
  await f.render({ variant: 'board', selectedTask: 'full' });
  assert.ok(document.querySelector('[data-task-detail]').textContent.includes(record.title));
  for (const display of [undefined, '   ', 'Un affichage beaucoup trop long pour une seule demande', '  Un affichage\n  avec des espaces mais sans aucune coupure  ']) {
    const input = Object.freeze({ ...record, display });
    await f.act(async () => f.root.render(f.h(f.TaskRequestCard, { task: input, variant: 'compact' })));
    const title = document.querySelector('[data-task-title]').textContent;
    assert.equal(title, (display?.trim() || record.title).replace(/\s+/gu, ' '));
    assert.equal(document.querySelectorAll('[data-slot=badge]').length, 1);
    assert.equal(input.display, display);
    assert.equal(input.title, record.title);
  }
});

test('compact board prioritizes valid needs-you before limit, omits canonical technical and collapses closed plus explicit owner technical', async t => {
  const records = [
    { id: 'working', title: 'Préparer les menus', state: 'working', updated_at: '2026-10-30' },
    { id: 'technical', title: 'Fictional internal task', state: 'waiting', waiting_on_you: true, technical: true },
    { id: 'closed', title: 'Une demande retirée', state: 'waiting', status: 'abandoned', waiting_on_you: true },
    { id: 'needs', title: 'Choisir les repas', state: 'waiting', waiting_on_you: true },
    { id: 'not-inferred', title: 'Technical builder machine', state: 'open', technical: false },
    { id: 'stale', title: 'Une demande fermée', state: 'closed', waiting_on_you: true },
  ];
  const f = await fixture(t, { tasks: records, variant: 'compact', filter: 'all', locale: 'fr' });
  const ids = () => [...document.querySelectorAll('[data-task-card]')].map(node => node.dataset.taskCard);
  assert.deepEqual(ids(), ['needs', 'working', 'not-inferred']);
  assert.equal(document.querySelector('[data-task-group=technical]'), null);
  assert.equal(document.querySelector('[data-task-group=closed] button').getAttribute('aria-expanded'), 'false');
  await f.click('[data-task-group=closed] button');
  assert.deepEqual(ids(), ['needs', 'working', 'not-inferred', 'closed', 'stale']);
  await f.render({ compactPresentation: { includeTechnical: true } });
  assert.ok(!ids().includes('technical'));
  await f.click('[data-task-group=technical] button'); assert.ok(ids().includes('technical'));
  await f.render({ limit: 1, compactPresentation: undefined });
  assert.deepEqual(ids(), ['needs']);
  await f.render({ variant: 'board', limit: undefined });
  assert.ok(ids().includes('technical'), 'operator board retains technical records');
});
