import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refsOf, eventOf, sync } from '../scripts/platform-task-sync.mjs';

const REPO = 'hachej/boring-ui', URL_ = 'https://tasks.test', ID = '11111111-2222-4333-8444-555555555555';
const pr = (over = {}) => ({ html_url: 'https://github.com/hachej/boring-ui/pull/12', state: 'open', merged: false, body: '', head: { ref: 'feat/x', repo: { full_name: REPO } }, base: { repo: { full_name: REPO } }, ...over });
const payload = (action, over) => ({ action, pull_request: pr(over) });

test('a task is named by the branch or a Task: line, never by free text', () => {
  assert.deepEqual(refsOf({ branch: 'd-123-hub-decommission' }), [{ number: 123 }]);
  assert.deepEqual(refsOf({ branch: 'D-7' }), [{ number: 7 }]);
  assert.deepEqual(refsOf({ branch: 'task/D-8-slug' }), [{ number: 8 }]);
  assert.deepEqual(refsOf({ branch: 'task/9/more' }), [{ number: 9 }]);
  assert.deepEqual(refsOf({ branch: `task/${ID}-slug` }), [{ id: ID }]);
  assert.deepEqual(refsOf({ branch: 'd-5-x', body: 'Why\n\nTask: D-5\nTask: D-6, d-7\n' }), [{ number: 5 }, { number: 6 }, { number: 7 }]);
  assert.deepEqual(refsOf({ body: `Task: ${ID}` }), [{ id: ID }]);
  for (const none of [{ branch: 'feat/d-5' }, { branch: 'dev-5' }, { branch: 'd-x' }, { body: 'fixes D-5' }, { body: 'see Task: nothing' }, { body: 'Tasks: D-5' }, {}]) assert.deepEqual(refsOf(none), [], JSON.stringify(none));
  assert.equal(refsOf({ body: Array.from({ length: 20 }, (_, i) => `Task: D-${i + 1}`).join('\n') }).length, 5, 'bounded');
});

test('events: opened, reopened and ready record opened; closed is merged or closed; the rest changes nothing', () => {
  assert.deepEqual(['opened', 'reopened', 'ready_for_review'].map((a) => eventOf(payload(a))), ['opened', 'opened', 'opened']);
  assert.equal(eventOf(payload('closed', { merged: true, state: 'closed' })), 'merged');
  assert.equal(eventOf(payload('closed', { state: 'closed' })), 'closed');
  assert.equal(eventOf(payload('edited')), 'opened');
  assert.equal(eventOf(payload('edited', { state: 'closed' })), null);
  assert.equal(eventOf(payload('labeled')), null);
  assert.equal(eventOf({ action: 'opened' }), null);
});

function store(tasks, { status = 200 } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : undefined });
    if (init.method === 'GET') return Response.json({ tasks }, { status });
    return Response.json({ task: { state: 'working' } }, { status });
  };
  return { calls, fetcher };
}
const run = (p, s, over = {}) => sync({ payload: p, space: 'ui', url: URL_, token: 'tok', repository: REPO, fetcher: s.fetcher, ...over });

test('opened records the pull request on D-n of the space, with the branch', async () => {
  const s = store([{ id: ID, number: 7, state: 'open' }, { id: 'other', number: 8 }]);
  const log = await run(payload('opened', { head: { ref: 'd-7-slug', repo: { full_name: REPO } } }), s);
  assert.deepEqual(s.calls.map((c) => [c.method, c.path]), [['GET', '/repos/boring-next/ui/tasks'], ['POST', `/tasks/${ID}/pr`]]);
  assert.deepEqual(s.calls[1].body, { event: 'opened', pr: 'https://github.com/hachej/boring-ui/pull/12', branch: 'd-7-slug' });
  assert.ok(s.calls.every((c) => c.auth === 'Bearer tok'));
  assert.match(log[0], /D-7: pull request opened/);
});

test('merged and closed are recorded as such; a task of no such number, or no task named, is left alone', async () => {
  const s = store([{ id: ID, number: 7 }]);
  await run(payload('closed', { merged: true, state: 'closed', body: 'Task: D-7' }), s);
  assert.equal(s.calls.at(-1).body.event, 'merged');
  await run(payload('closed', { state: 'closed', body: 'Task: D-7' }), s);
  assert.equal(s.calls.at(-1).body.event, 'closed');
  const none = store([{ id: ID, number: 7 }]);
  assert.match((await run(payload('opened', { body: 'Task: D-999' }), none))[0], /D-999 is not a task of the ui space/);
  assert.equal(none.calls.filter((c) => c.method === 'POST').length, 0);
  const unnamed = store([]);
  assert.match((await run(payload('opened'), unnamed))[0], /no task named/);
  assert.equal(unnamed.calls.length, 0, 'no call at all');
});

test('a pull request from a fork, or into another repository, never touches a task; no token is a warning, not a failure', async () => {
  const s = store([{ id: ID, number: 7 }]);
  const fork = payload('opened', { body: 'Task: D-7', head: { ref: 'd-7', repo: { full_name: 'someone/boring-factory' } } });
  assert.match((await run(fork, s))[0], /another repository/);
  assert.match((await run(payload('opened', { body: 'Task: D-7', base: { repo: { full_name: 'x/y' } } }), s))[0], /another repository/);
  assert.match((await run(payload('opened', { body: 'Task: D-7' }), s, { token: '' }))[0], /not set/);
  assert.equal(s.calls.length, 0);
});

test('the store refusing is logged, never thrown (a pull request is never blocked by its task); a done task answering 409 is fine', async () => {
  const down = store([], { status: 503 });
  assert.match((await run(payload('opened', { body: 'Task: D-7' }), down))[0], /cannot list.*503/);
  const done = { fetcher: async (url, init) => (init.method === 'GET' ? Response.json({ tasks: [{ id: ID, number: 7, state: 'done' }] }) : Response.json({ error: 'A shipped task is immutable' }, { status: 409 })) };
  assert.match((await run(payload('closed', { merged: true, state: 'closed', body: 'Task: D-7' }), done))[0], /already done/);
});

test('the log never carries the token', async () => {
  const s = store([{ id: ID, number: 7 }]);
  assert.doesNotMatch((await run(payload('opened', { body: 'Task: D-7' }), s)).join('\n'), /tok/);
});

test('the workflow: main only, no pull request code, forks excluded, one secret, no pull request text in a shell', () => {
  const text = readFileSync(new URL('../.github/workflows/platform-tasks.yml', import.meta.url), 'utf8');
  assert.match(text, /pull_request_target/);
  assert.match(text, /^permissions: \{\}$/m);
  assert.match(text, /head\.repo\.full_name == github\.repository/);
  assert.match(text, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(text, /persist-credentials: false/);
  assert.deepEqual([...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]), ['PLATFORM_TASKS_TOKEN']);
  assert.doesNotMatch(text, /github\.token|github\.head_ref|pull_request\.(title|body|head\.ref)/);
});
