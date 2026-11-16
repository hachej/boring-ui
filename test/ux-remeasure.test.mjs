import assert from 'node:assert/strict';
import test from 'node:test';
import { median, remeasure, suspects } from '../ux/runner/remeasure.mjs';

const flow = (id, viewport, settled) => ({ id, viewport, steps: settled.map(settledMs => ({ ok: true, settledMs, firstChangeMs: 20, cls: 0 })) });
const th = { settledMs: 800 };

test('a step over its threshold or much slower than the last accepted round is a suspect; the rest are left alone', () => {
  const result = { flows: [flow('F1', '390', [400, 1000, 400]), flow('F2', '1440', [900, 300])] }, prev = { flows: [flow('F1', '390', [400, 420, 300]), flow('F2', '1440', [880, 290])] };
  assert.deepEqual(suspects(result, prev, th).map(s => [s.id, s.idx]), [['F1', [1]], ['F2', [0]]]);
});

test('a spike is replaced by the median of the capture and two alone runs; a steady step is not touched; the cap bounds the work', async () => {
  const result = { flows: [flow('F1', '390', [400, 1000]), flow('F2', '390', [300, 300])] }, prev = { flows: [flow('F1', '390', [400, 420]), flow('F2', '390', [300, 300])] };
  let calls = 0; const alone = [380, 420];
  await remeasure(result, prev, th, async () => ({ steps: [{ ok: true, settledMs: 400 }, { ok: true, settledMs: alone[calls++] }] }));
  assert.equal(result.flows[0].steps[1].settledMs, 420); assert.equal(calls, 2); assert.equal(result.flows[0].steps[0].settledMs, 400); assert.equal(result.flows[1].steps[0].settledMs, 300);
  const many = { flows: Array.from({ length: 9 }, (_, i) => flow(`F${i}`, '390', [1000])) }; let n = 0;
  await remeasure(many, null, th, async () => { n++; return { steps: [{ ok: true, settledMs: 1000 }] }; }, { maxFlows: 5, extra: 2 });
  assert.equal(n, 10); assert.equal(median([3, 1, 2]), 2);
});

test('a real slowdown stays: when the alone runs are slow too, the median is slow', async () => {
  const result = { flows: [flow('F1', '390', [1000])] };
  await remeasure(result, null, th, async () => ({ steps: [{ ok: true, settledMs: 950 }] }));
  assert.equal(result.flows[0].steps[0].settledMs, 950);
});
