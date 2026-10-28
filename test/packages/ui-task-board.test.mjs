import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTasks, taskReference, taskFromUrl, taskUrl, TASK_STATES } from '@hachej/boring-ui-kit/task-board';

const tasks = [
  { id: 'a', number: 201, title: 'Fictional orchard', state: 'waiting', requesterId: 'alice', waiting_on_you: true, updated_at: '2026-10-27T10:00:00Z' },
  { id: 'b', number: 202, title: 'Fictional picnic', state: 'working', requesterId: 'bob', updated_at: '2026-10-28T10:00:00Z' },
  { id: 'c', number: 203, title: 'Fictional map', state: 'open', requesterId: 'alice', updated_at: '2026-10-28T09:00:00Z' },
  { id: 'd', title: 'Fictional closed request', state: 'closed', requesterId: 'alice' },
];
test('task board headless public entry groups five business states, filters own requests before limiting and never mutates input', () => {
  assert.deepEqual(TASK_STATES, ['waiting', 'working', 'open', 'done', 'closed']);
  const before = structuredClone(tasks);
  assert.deepEqual(selectTasks(tasks, { filter: 'mine', currentUser: 'alice', limit: 2 }).map(task => task.id), ['c', 'a']);
  assert.deepEqual(selectTasks(tasks, { filter: 'mine' }), []);
  assert.deepEqual(selectTasks(tasks, { filter: 'waiting-on-me' }).map(task => task.id), ['a']);
  assert.deepEqual(selectTasks(tasks, { limit: 0 }), []);
  assert.throws(() => selectTasks(tasks, { limit: -1 }), RangeError);
  assert.deepEqual(tasks, before);
  assert.equal(taskReference(tasks[0]), 'D-201');
});
test('task URL helpers preserve unrelated state and round-trip opaque task IDs without adding authority', () => {
  const url = taskUrl('https://fictional.invalid/app?agent=pm#notes', 'task /?&');
  assert.equal(taskFromUrl(url), 'task /?&');
  assert.equal(new URL(url).searchParams.get('agent'), 'pm');
  assert.equal(new URL(url).hash, '#notes');
  assert.equal(taskFromUrl(taskUrl(url, null)), null);
});
