import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

// The one line's task source (`pm-task-source.tsx`): the host's task API behind a feature check, its record mapping and the tolerant
// matcher that finds the task a PM reply created. The browser path is examples/pm-panel/journey.mjs with PM_ONE_LINE=1.
await build({ stdin: { contents: `export { readTasks, answerTask, withdrawTask, withdrawable, toTaskRecord, createdTask } from './registry/pm-panel/pm-task-source';`, resolveDir: process.cwd(), loader: 'tsx' }, outfile: '.cache/pm-task-source-test/source.mjs', bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', alias: { '@': `${process.cwd()}/examples/app-shell` } });
const { readTasks, answerTask, withdrawTask, withdrawable, toTaskRecord, createdTask } = await import(pathToFileURL(`${process.cwd()}/.cache/pm-task-source-test/source.mjs`));

const served = (status, body) => async (url, init) => { served.calls.push({ url: String(url), init }); return new Response(body === undefined ? null : JSON.stringify(body), { status }); };
served.calls = [];

test('404 and 403 mean no task source; other failures are errors', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const status of [404, 403]) { globalThis.fetch = served(status); assert.equal(await readTasks('http://app.test/apps/x/_tasks/api', 'alice'), null, String(status)); }
  globalThis.fetch = served(500);
  await assert.rejects(readTasks('http://app.test/apps/x/_tasks/api', 'alice'));
});

test('the viewer\'s tasks map to TaskRecord: uuid id, D-ref number, waiting on the viewer', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  served.calls = [];
  globalThis.fetch = served(200, { tasks: [{ id: '0b8e2c7e-1111-4222-8333-944455556666', ref: 'D-7', title: 'Fictif', state: 'open', created: '2026-10-29T08:00:00Z', waiting_on_you: true, question: 'Vous confirmez ?' }], cursor: '3' });
  const [task] = await readTasks('http://app.test/apps/x/_tasks/api', 'alice');
  assert.equal(served.calls[0].url, 'http://app.test/apps/x/_tasks/api?mine=1');
  assert.deepEqual(task, { id: '0b8e2c7e-1111-4222-8333-944455556666', number: 'D-7', title: 'Fictif', requesterId: 'alice', waiting_on_you: true, state: 'waiting',
    waiting_on: { who: 'alice', type: 'person', question: 'Vous confirmez ?' }, created_at: '2026-10-29T08:00:00.000Z' });
  assert.equal(toTaskRecord({ id: 'x', title: 'T', state: 'unknown-state' }, 'alice').state, 'open');
  assert.deepEqual(toTaskRecord({ id: 'x', number: 'D-3', title: 'T', state: 'working', status: 'En cours', updated_at: '2026-10-29T08:00:00Z' }, 'alice'),
    { id: 'x', number: 'D-3', title: 'T', status: 'En cours', requesterId: 'alice', waiting_on_you: false, state: 'working', updated_at: '2026-10-29T08:00:00.000Z' }, '#892 field names');
  globalThis.fetch = served(200, { ok: true });
  await answerTask('http://app.test/apps/x/_tasks/api', 'a b', 'Confirmer');
  assert.equal(served.calls.at(-1).url, 'http://app.test/apps/x/_tasks/api/a%20b/answer');
  assert.deepEqual(JSON.parse(served.calls.at(-1).init.body), { text: 'Confirmer' });
});

test('confirmed_at and is_requester (decided 2026-10-29): « Envoyée » and « Retirer » read them; absent, the record is today\'s', () => {
  const host = { id: 'x', ref: 'D-5', title: 'T', state: 'open', waiting_on_you: false };
  assert.deepEqual(toTaskRecord(host, 'alice'), { id: 'x', number: 'D-5', title: 'T', requesterId: 'alice', waiting_on_you: false, state: 'open' }, 'no new field without the host\'s');
  assert.deepEqual(toTaskRecord({ ...host, confirmed_at: '2026-10-29T08:05:00Z', is_requester: true }, 'alice'),
    { id: 'x', number: 'D-5', title: 'T', requesterId: 'alice', waiting_on_you: false, state: 'open', confirmed_at: '2026-10-29T08:05:00.000Z', is_requester: true });
  assert.equal(withdrawable(toTaskRecord({ ...host, is_requester: true }, 'alice')), true);
  assert.equal(withdrawable(toTaskRecord({ ...host, is_requester: true, state: 'waiting', waiting_on_you: true }, 'alice')), true, 'waiting on them: not started');
  assert.equal(withdrawable(toTaskRecord({ ...host, is_requester: true, state: 'working' }, 'alice')), false, 'started');
  assert.equal(withdrawable(toTaskRecord({ ...host, is_requester: false }, 'alice')), false, 'listed because it waits on them, not theirs');
  assert.equal(withdrawable(toTaskRecord(host, 'alice')), false, 'never assumed');
});

test('POST withdraw: 200 withdrawn ({ task } or empty body), 409 started, 404 or a network failure refused', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  served.calls = [];
  globalThis.fetch = served(200, { task: { id: 'a b', state: 'closed' } });
  assert.equal(await withdrawTask('http://app.test/apps/x/_tasks/api', 'a b'), 'withdrawn');
  assert.equal(served.calls.at(-1).url, 'http://app.test/apps/x/_tasks/api/a%20b/withdraw');
  assert.equal(served.calls.at(-1).init.method, 'POST');
  globalThis.fetch = served(200); assert.equal(await withdrawTask('http://app.test/apps/x/_tasks/api', 'x'), 'withdrawn', 'an empty 200 body too');
  globalThis.fetch = served(409); assert.equal(await withdrawTask('http://app.test/apps/x/_tasks/api', 'x'), 'started');
  globalThis.fetch = served(404); assert.equal(await withdrawTask('http://app.test/apps/x/_tasks/api', 'x'), 'refused');
  globalThis.fetch = async () => { throw new TypeError('offline'); }; assert.equal(await withdrawTask('http://app.test/apps/x/_tasks/api', 'x'), 'refused');
});

test('the created task: a task tool result in the reply\'s turn, from details or text; never an earlier turn', () => {
  const user = id => ({ id, kind: 'message', model: [{ role: 'user', content: 'x' }] });
  const result = (id, toolName, details, text = '', isError = false) => ({ id, kind: 'message', model: [{ role: 'toolResult', toolName, details, isError, content: [{ type: 'text', text }] }] });
  const reply = id => ({ id, kind: 'message', model: [{ role: 'assistant', content: [{ type: 'text', text: 'Noté.' }] }] });
  const exact = (id, json) => ({ id, kind: 'message', model: [{ role: 'toolResult', toolName: 'tasks_create', isError: false, content: [{ type: 'text', text: json }] }] });
  const turn = [user(20), result(21, 'create_task', { ref: 'D-3' }), exact(22, JSON.stringify({ created: true, task: { id: '0b8e2c7e-1111-4222-8333-944455556666', number: 'D-12', title: 'Fictif', state: 'waiting', status: 'À confirmer', updated_at: '2026-10-29T08:00:00Z' } })), reply(23)];
  assert.deepEqual(createdTask(turn, turn[3]), { ref: 'D-12', id: '0b8e2c7e-1111-4222-8333-944455556666',
    task: { id: '0b8e2c7e-1111-4222-8333-944455556666', number: 'D-12', title: 'Fictif', state: 'waiting', status: 'À confirmer', updated_at: '2026-10-29T08:00:00Z' } }, 'tasks_create, exactly (#892), with the task that draws the card');
  const entries = [user(1), result(2, 'create_task', { task: { id: 'u-1', ref: 'D-4' } }), reply(3), user(4), result(5, 'pm_tasks.file', undefined, 'Demande D-9 créée.'), result(6, 'search', { ref: 'D-1' }), reply(7), user(8), reply(9), result(10, 'create_task', { ref: 'D-2' }, '', true), reply(11)];
  assert.deepEqual(createdTask(entries, entries[2]), { ref: 'D-4' });
  assert.deepEqual(createdTask(entries, entries[6]), { ref: 'D-9' }, 'from the text; a tool without « task » in its name is ignored');
  assert.equal(createdTask(entries, entries[8]), undefined, 'a reply without a task tool in its turn has no card');
  assert.equal(createdTask(entries, entries[10]), undefined, 'a failed tool result is not a task');
});
