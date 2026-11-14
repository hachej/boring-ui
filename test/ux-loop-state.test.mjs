import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addTried, allNine, claimPid, firstChange, focusBrief, overCap, pauseDue, pauseFor, pauseHours, pickFocus, readTried, releasePid, rethinkDue, triedText, updateMisses, writeStatus } from '../ux/runner/loop-state.mjs';

const KEYS = ['clarity', 'layout', 'states', 'phone', 'polish', 'flows'], dir = () => mkdtempSync(join(tmpdir(), 'ux-state-'));
const grades = (...v) => Object.fromEntries(KEYS.map((k, i) => [k, v[i]]));

// The loop's decisions driven by a fake worker (an accepted gain or not) and a fake judge, round by round, as loop.mjs does.
function simulate(outcomes, { start = grades(7, 6, 7, 6, 6.5, 5.5) } = {}) {
  let g = start, misses = {}, failed = 0, pauses = 0; const log = [];
  for (const gain of outcomes) {
    if (allNine(g, KEYS)) { log.push('done'); break; }
    if (pauseDue(failed)) { log.push(`pause ${pauseHours(pauses++)}h`); failed = 3; }
    const focus = pickFocus(g, KEYS, misses), rethink = rethinkDue(failed); log.push(`${focus}${rethink ? ' rethink' : ''}`);
    const next = gain ? { ...g, [focus]: g[focus] + 1 } : g;
    misses = updateMisses(misses, focus, g, next);
    if (gain) { g = next; failed = 0; pauses = 0; } else failed++;
  }
  return { g, log };
}

test('the loop ends only when every criterion is 9 or more, and a criterion switched off does not count', () => {
  assert.equal(allNine(grades(9, 9, 9, 9, 9, 8.5), KEYS), false); assert.equal(allNine(grades(9, 9, 9, 9, 9, 9), KEYS), true);
  assert.equal(allNine({ ...grades(9, 9, 9, 9, 9, 9), flows: undefined }, KEYS), true);
  assert.deepEqual(simulate([1, 1, 1], { start: grades(9, 9, 9, 9, 9, 8) }).log, ['flows', 'done']);
});

test('a stall rotates to the next lowest criterion after two rounds without a gain; a gain keeps the target', () => {
  const g = grades(7, 6, 7, 6, 6.5, 5.5);
  assert.equal(pickFocus(g, KEYS, {}), 'flows'); assert.equal(pickFocus(g, KEYS, { flows: 1 }), 'flows'); assert.equal(pickFocus(g, KEYS, { flows: 2 }), 'layout');
  assert.equal(pickFocus(g, KEYS, { flows: 2, layout: 2 }), 'phone'); assert.equal(pickFocus(g, KEYS, Object.fromEntries(KEYS.map(k => [k, 2]))), 'flows', 'all stalled: start over');
  assert.equal(pickFocus(grades(9, 9, 9, 9, 9, 9), KEYS), null);
  assert.deepEqual(updateMisses({ flows: 1 }, 'flows', g, { ...g, flows: 6 }), { flows: 0 }); assert.deepEqual(updateMisses({ flows: 1 }, 'flows', g, g), { flows: 2 });
  assert.deepEqual(simulate([0, 0, 0]).log, ['flows', 'flows', 'layout']);
});

test('three rounds in a row with nothing accepted make the next a rethink round; an accepted round ends it', () => {
  assert.deepEqual([2, 3].map(rethinkDue), [false, true]);
  assert.deepEqual(simulate([0, 0, 0, 0, 1]).log, ['flows', 'flows', 'layout', 'layout rethink', 'phone rethink']);
  assert.match(focusBrief({ focus: 'flows', tried: '- x', rethink: true, failures: 'boom text' }), /Rethink round[\s\S]*SMALLER and DIFFERENT[\s\S]*boom text/);
  assert.doesNotMatch(focusBrief({ focus: 'flows', tried: '- x', rethink: false }), /Rethink round/);
});

test('eight rounds in a row with nothing accepted pause the loop: 6 h, then 12, then 24 at most, and a rethink after the wake', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(pauseHours), [6, 12, 24, 24, 24]); assert.deepEqual([7, 8].map(pauseDue), [false, true]);
  const log = simulate(Array(10).fill(0)).log, at = log.indexOf('pause 6h'); assert.equal(at, 8, 'after 8 rounds'); assert.match(log[7], / rethink$/); assert.match(log[at + 1], / rethink$/);
});

test('a pause sleeps in short steps, ends at once on STOP, and otherwise wakes', async () => {
  let slept = 0; assert.equal(await pauseFor(90, { stopped: () => false, sleep: async () => { slept++; }, step: 30 }), 'woke'); assert.equal(slept, 3);
  slept = 0; assert.equal(await pauseFor(1e9, { stopped: () => slept >= 2, sleep: async () => { slept++; }, step: 30 }), 'stop'); assert.equal(slept, 2);
});

test('a round that touches more than 8 files outside tests is over the cap; tests do not count', () => {
  const files = n => Array.from({ length: n }, (_, i) => `registry/app-shell/f${i}.tsx`);
  assert.deepEqual(overCap(files(8)), []); assert.match(overCap(files(9))[0], /9 files outside tests \(the cap is 8\)/);
  assert.deepEqual(overCap([...files(8), 'test/x.test.mjs', 'registry/y.test.tsx']), []);
});

test('what was tried on a criterion is one line per round and goes to the worker for that criterion only', () => {
  const f = join(dir(), 'tried.json'); addTried(f, { round: 4, criterion: 'flows', result: 'failed', note: 'npm run check still failing\n   after 3 repairs' }); addTried(f, { round: 5, criterion: 'layout', result: 'accepted', note: 'x' });
  assert.equal(readTried(f).length, 2); assert.equal(triedText(readTried(f), 'flows'), '- round 4 (failed): npm run check still failing after 3 repairs'); assert.equal(triedText(readTried(f), 'phone'), 'nothing yet on this criterion');
  assert.equal(firstChange('# Round\n\n- **Flows.** Close returns focus.\n- other'), '- **Flows.** Close returns focus.'.replace(/^- /, ''));
});

test('one loop per state folder: a live pid refuses a second start, a dead or reused pid does not, release removes only our own', () => {
  const f = join(dir(), 'loop.pid'); assert.deepEqual(claimPid(f, { pid: 100 }), { ok: true, pid: 100 });
  assert.deepEqual(claimPid(f, { pid: 200, isAlive: p => p === 100 }), { ok: false, pid: 100 }); assert.equal(readFileSync(f, 'utf8'), '100\n');
  assert.deepEqual(claimPid(f, { pid: 200, isAlive: () => false }), { ok: true, pid: 200 }); releasePid(f, 100); assert.equal(readFileSync(f, 'utf8'), '200\n'); releasePid(f, 200);
  assert.deepEqual(claimPid(f, { pid: 300, isAlive: () => true }), { ok: true, pid: 300 }, 'no file: nothing to refuse');
});

test('status.json keeps its start time and moves lastChangeAt only when something changed', () => {
  const f = join(dir(), 'status.json'), at = t => () => new Date(t);
  writeStatus(f, { state: 'running', round: 4, focus: 'flows', failedInRow: 0 }, at('2026-11-14T10:00:00Z'));
  const same = writeStatus(f, { state: 'running', round: 4, focus: 'flows', failedInRow: 0 }, at('2026-11-14T10:05:00Z')); assert.equal(same.lastChangeAt, '2026-11-14T10:00:00.000Z');
  const moved = writeStatus(f, { state: 'paused', round: 4, nextWake: 'w' }, at('2026-11-14T10:10:00Z'));
  assert.equal(moved.startedAt, '2026-11-14T10:00:00.000Z'); assert.equal(moved.lastChangeAt, '2026-11-14T10:10:00.000Z'); assert.equal(JSON.parse(readFileSync(f, 'utf8')).state, 'paused');
});
