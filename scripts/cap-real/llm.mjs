#!/usr/bin/env node
// The optional real check of `structured` (card cap-llm-single AC-16). The key comes from standard input, never from an argument or the
// environment, and is printed nowhere:
//   vault kv get -mount=secret -field=<field> agent/anthropic | node scripts/cap-real/llm.mjs --runs 3
// It sends the 20 fictional sentences of test/fixtures/caps/llm/sentences.json and prints, per run, the valid answers, the corrective
// turns (requests beyond one per sentence) and the median and slowest time. It passes at 19 of 20 valid and a median under 2.0 s.
import { readFileSync } from 'node:fs';
import { structured } from '@hachej/boring-agent/caps/llm';

const arg = process.argv.indexOf('--runs');
const runs = arg > 0 ? Number(process.argv[arg + 1]) : 3;
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs: an integer from 1 to 10');
const key = process.stdin.isTTY ? '' : readFileSync(0, 'utf8').trim();
if (!key) { console.log('skipped: no key'); process.exit(0); }

const sentences = JSON.parse(readFileSync(new URL('../../test/fixtures/caps/llm/sentences.json', import.meta.url), 'utf8'));
const schema = { type: 'object', additionalProperties: false, required: ['heard', 'actions'], properties: {
  heard: { type: 'array', items: { type: 'string' } },
  actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'label'], properties: { op: { type: 'string', enum: ['add', 'ask', 'unknown'] }, label: { type: 'string' } } } },
} };
const system = 'You read one sentence a person wrote about what they ate or drank. Put what you heard in `heard`, and one action per item in `actions`: add (an item to log), ask (a question to ask back) or unknown.';

let requests = 0;
const counted = (...args) => { requests += 1; return fetch(...args); };
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let passed = true;
for (let run = 1; run <= runs; run += 1) {
  requests = 0;
  const times = [], valid = [];
  for (const sentence of sentences) {
    const started = Date.now();
    const result = await structured({ purpose: 'food-lookup', effort: 'low', maxTokens: 400, schema, messages: [{ role: 'system', content: system }, { role: 'user', content: sentence }] },
      { providers: ['anthropic:claude-sonnet-5-5'], keys: { ANTHROPIC_API_KEY: key }, fetch: counted, timeoutMs: 30_000 });
    times.push(Date.now() - started);
    valid.push(result.ok);
  }
  const ok = valid.filter(Boolean).length, mid = median(times);
  console.log(`run ${run}: ${ok}/${sentences.length} valid, ${Math.max(0, requests - sentences.length)} corrective turns, median ${(mid / 1000).toFixed(2)} s, slowest ${(Math.max(...times) / 1000).toFixed(2)} s`);
  if (ok < 19 || mid >= 2000) passed = false;
}
console.log(passed ? 'pass: each run has at least 19 of 20 valid answers and a median under 2.0 s' : 'fail: a run is under 19 of 20 valid or at 2.0 s median or more');
process.exit(passed ? 0 : 1);
