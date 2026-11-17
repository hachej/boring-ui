#!/usr/bin/env node
// The optional real check of `run` and `pickOne` (card cap-decision AC-16). The key comes from standard input, never from an argument or
// the environment, and is printed nowhere:
//   vault kv get -mount=secret -field=<field> <path> | node scripts/cap-real/decision.mjs --runs 3 [--provider openrouter-jev]
// Per run: the 20 fictional lines of test/fixtures/caps/decision/lines.json tagged among 12 accounts, 8 questions per call; then 10
// `pickOne` on foods.json at threshold 0.7 and 700 ms, with a recording meter in the loop. It passes when each run has at least 16 of
// 20 lines right at confidence 0.6 or more, no wrong pick (a `none` is not wrong), and a median pick under 300 ms.
import { readFileSync } from 'node:fs';
import { pickOne, run } from '@hachej/boring-agent/caps/decision';

const flag = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const runs = Number(flag('--runs', '3')), provider = flag('--provider', 'typesafe');
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs: an integer from 1 to 10');
if (!['typesafe', 'openrouter-jev'].includes(provider)) throw new Error('--provider: typesafe or openrouter-jev');
const key = process.stdin.isTTY ? '' : readFileSync(0, 'utf8').trim();
if (!key) { console.log('skipped: no key'); process.exit(0); }

const read = (name) => JSON.parse(readFileSync(new URL(`../../test/fixtures/caps/decision/${name}`, import.meta.url), 'utf8'));
const { accounts, lines } = read('lines.json'), foods = read('foods.json');
const sink = { reserveRun: async () => ({ reservationId: 'r' }), recordUsage: async (i) => ({ billedMicros: i.amountMicros }), settleRun: async () => {}, releaseRun: async () => {} };
const options = { providers: [provider], keys: { [provider === 'typesafe' ? 'TYPESAFE_API_KEY' : 'OPENROUTER_API_KEY']: key }, meter: { sink, userId: 'real-check' } };
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let passed = true;
for (let n = 1; n <= runs; n += 1) {
  let right = 0, wrong = 0;
  for (let at = 0; at < lines.length; at += 8) {
    const chunk = lines.slice(at, at + 8);
    const questions = Object.fromEntries(chunk.map((_, i) => [`l${i}`, { type: 'choice', instructions: 'Which account does this accounting line go to?', criteria: accounts }]));
    const result = await run({ state: Object.fromEntries(chunk.map((line, i) => [`l${i}`, line.text])), questions }, { ...options, timeoutMs: 30_000 });
    if (result.ok) chunk.forEach((line, i) => { const a = result.answers[`l${i}`]; if (a?.choice === line.account && a.confidence >= 0.6) right += 1; });
  }
  const times = [];
  for (const food of foods) {
    const started = Date.now();
    const pick = await pickOne({ state: { sentence: food.sentence, item: food.item }, options: food.options, threshold: 0.7, timeoutMs: 700, instructions: 'Which food of the table is this item of the sentence?' }, options);
    times.push(Date.now() - started);
    if (pick.choice !== 'none' && pick.choice !== food.expected) wrong += 1;
  }
  const mid = median(times);
  console.log(`run ${n}: ${right}/${lines.length} lines right, ${wrong} wrong picks, median pick ${mid} ms`);
  if (right < 16 || wrong > 0 || mid >= 300) passed = false;
}
console.log(passed ? 'pass: each run has 16 of 20 lines right, no wrong pick and a median pick under 300 ms' : 'fail: a run is under 16 of 20, has a wrong pick or a median pick at 300 ms or more');
process.exit(passed ? 0 : 1);
