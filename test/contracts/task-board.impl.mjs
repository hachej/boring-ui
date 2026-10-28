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

test('compact mine stacks the newest two own C7 request cards and uses the host open path', async t => {
  const opened = []; const f = await fixture(t, { filter: 'mine', currentUser: 'alice', limit: 2, variant: 'compact', onOpen: task => opened.push(task.id) });
  assert.deepEqual([...document.querySelectorAll('[data-task-card]')].map(node => node.dataset.taskCard), ['kites', 'orchard']);
  assert.equal(document.querySelectorAll('[data-variant=compact][data-task-card]').length, 2);
  assert.match(document.body.textContent, /REQUEST/);
  assert.match(document.body.textContent, /Screen: Garden · 2 captures/);
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
  assert.match(document.body.textContent, /DEMANDE/); assert.match(document.body.textContent, /À confirmer/);
  assert.match(document.body.textContent, /Écran\u00a0: Garden · 2 captures/);
  await f.click('button'); assert.deepEqual(answers, ['confirmed']);
});
