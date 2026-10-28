import assert from 'node:assert/strict';
import test from 'node:test';
import { startTaskBoard } from '../../examples/task-board/server.mjs';

test('one-tap and free-text task answers post once to the same native PM conversation', async t => {
  const app = await startTaskBoard();
  t.after(() => app.close());
  const page = await (await fetch(app.url)).text();
  const boot = JSON.parse(/window\.__TASK_BOARD__=(.*?)<\/script>/.exec(page)[1]);
  const answer = body => fetch(new URL('/api/answers', app.url), { method: 'POST', headers: { authorization: `Bearer ${boot.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const messages = async () => (await app.view()).entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user');
  const request = { task: 'D-201', question: 'unit', value: 'grams' };
  const first = await (await answer(request)).json();
  assert.equal(first.kind, 'answered');
  assert.equal(first.answeredBy, 'Alice');
  assert.equal((await messages()).length, 1, 'the one-tap answer must enter the existing PM conversation');
  assert.match((await messages())[0].content, /@task:D-201/);
  assert.match((await messages())[0].content, /unit: grams/);
  assert.deepEqual(await (await answer(request)).json(), first, 'an identical retry retains the original answer');
  assert.equal((await messages()).length, 1, 'native request identity prevents a duplicate transcript entry');
  assert.equal((await (await answer({ ...request, value: 'percentage' })).json()).kind, 'conflict');
  const custom = await (await answer({ task: 'D-201', question: 'gauge', value: 'Only on the lunch card.' })).json();
  assert.equal(custom.kind, 'answered', 'Other accepts actual free text, not a synthetic option');
  assert.equal(custom.answer, 'Only on the lunch card.');
  assert.equal((await messages()).length, 2);
  assert.equal((await (await answer({ task: 'D-201', question: 'unknown', value: 'x' })).json()).kind, 'denied');
  assert.equal((await messages()).length, 2, 'a rejected question posts nothing');
});
