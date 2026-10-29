import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTasks, taskReference, taskFromUrl, taskUrl, TASK_STATES } from '@hachej/boring-ui-kit/task-board';
import * as taskBoard from '@hachej/boring-ui-kit/task-board';

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
test('semantic task status uses explicit host facts, never display wording or guessed builder identities', () => {
  const base = { id: 'fictional-task', title: 'Fictional lunch card', state: 'waiting' };
  const cases = [
    [{}, 'none'],
    [{ status: 'Waiting on you' }, 'none'],
    [{ status: 'High risk', risk: 'unknown' }, 'none'],
    [{ waiting_on: { who: 'builder' } }, 'none'],
    [{ waiting_on: { who: 'alice', type: 'person' } }, 'none'],
    [{ waiting_on: { who: 'fictional-team', type: 'builder' } }, 'waiting-on-builder'],
    [{ waiting_on_you: false, waiting_on: { who: 'fictional-team', type: 'builder' } }, 'waiting-on-builder'],
    [{ waiting_on_you: true }, 'waiting-on-viewer'],
    [{ risk: 'high' }, 'high-risk'],
    [{ risk: 'low' }, 'none'],
    [{ waiting_on: { who: 'fictional-team', type: 'builder' }, risk: 'high' }, 'waiting-on-builder'],
    [{ waiting_on_you: true, waiting_on: { who: 'fictional-team', type: 'builder' }, risk: 'high' }, 'waiting-on-viewer'],
  ];
  for (const [facts, expected] of cases) {
    const task = Object.freeze({ ...base, ...facts });
    assert.equal(taskBoard.deriveTaskStatus(task), expected, JSON.stringify(facts));
  }
  // Native viewer projection is authoritative even without a waiting_on object or a particular column.
  assert.equal(taskBoard.deriveTaskStatus({ ...base, state: 'open', waiting_on_you: true }), 'waiting-on-viewer');
  // « Sent »: confirmed and still `open`, only when the rendering asks for it (the requester's compact card).
  const confirmed = { ...base, state: 'open', confirmed_at: '2026-10-29T08:05:00Z' };
  assert.equal(taskBoard.deriveTaskStatus(confirmed, { sent: true }), 'sent');
  assert.equal(taskBoard.deriveTaskStatus(confirmed), 'none', 'the board does not ask for it');
  for (const state of ['working', 'done', 'closed', 'waiting']) assert.equal(taskBoard.deriveTaskStatus({ ...confirmed, state }, { sent: true }), 'none', state);
  assert.equal(taskBoard.deriveTaskStatus({ ...base, state: 'open' }, { sent: true }), 'none', 'not confirmed');
  assert.equal(taskBoard.deriveTaskStatus({ ...confirmed, waiting_on_you: true }, { sent: true }), 'waiting-on-viewer');
});

test('semantic task labels localize presentation, require explicit confirmation context and omit unknown pills', () => {
  assert.equal(taskBoard.taskStatusLabel('waiting-on-viewer'), 'Waiting on you');
  assert.equal(taskBoard.taskStatusLabel('waiting-on-viewer', 'fr'), 'À vous');
  assert.equal(taskBoard.taskStatusLabel('waiting-on-viewer', 'fr', 'confirmation'), 'À confirmer');
  assert.equal(taskBoard.taskStatusLabel('waiting-on-builder'), 'Waiting on the builder');
  assert.equal(taskBoard.taskStatusLabel('waiting-on-builder', 'fr'), "Chez l'équipe");
  assert.equal(taskBoard.taskStatusLabel('high-risk'), 'High risk');
  assert.equal(taskBoard.taskStatusLabel('high-risk', 'fr'), 'Risque élevé');
  assert.equal(taskBoard.taskStatusLabel('sent'), 'Sent');
  assert.equal(taskBoard.taskStatusLabel('sent', 'fr'), 'Envoyée');
  assert.equal(taskBoard.taskStatusLabel('none'), undefined);
  assert.equal(taskBoard.taskStatusLabel('none', 'fr'), undefined);
  assert.equal(taskBoard.taskStatusLabel('unknown-host-status'), undefined);
});

test('task URL helpers preserve unrelated state and round-trip opaque task IDs without adding authority', () => {
  const url = taskUrl('https://fictional.invalid/app?agent=pm#notes', 'task /?&');
  assert.equal(taskFromUrl(url), 'task /?&');
  assert.equal(new URL(url).searchParams.get('agent'), 'pm');
  assert.equal(new URL(url).hash, '#notes');
  assert.equal(taskFromUrl(taskUrl(url, null)), null);
});
