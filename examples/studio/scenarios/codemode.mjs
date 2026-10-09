// Code mode (upstream pi-codemode): an aggregate question over a paginated fictional ledger is answered exactly, through one or two
// sandboxed code executions instead of one tool call per page. The expected numbers are computed here from the same dataset.
import assert from 'node:assert/strict';
import { LIMITS, PAGE_SIZE, RECORDS, STATUSES, runCode } from '../../shared/codemode-tools.mjs';
import { call } from './_script.mjs';

const counts = Object.fromEntries(STATUSES.map(status => [status, RECORDS.filter(record => record.status === status).length]));
const north = RECORDS.filter(record => record.region === 'north').reduce((sum, record) => sum + record.amount, 0);
const pages = Math.ceil(RECORDS.length / PAGE_SIZE);

export default {
  id: 'codemode-ledger', group: 'Code mode', requires: ['codemode'], title: 'Aggregate a paginated ledger in code',
  description: 'One sandboxed code tool loops over twelve pages of records and returns only the exact numbers.',
  steps: [{ prompt: 'How many records are there per status, and what is the total amount of all records in region north?' }],
  script: { 0: [
    call('run_code', { code: `const counts = {}; let north = 0;
for (let page = 1, pages = 1; page <= pages; page++) {
  const result = await tools.list_records({ page }); pages = result.pages;
  for (const record of result.records) { counts[record.status] = (counts[record.status] ?? 0) + 1; if (record.region === 'north') north += record.amount; }
}
return { counts, north };` }),
    ctx => `Records per status: ${Object.entries(ctx.last.json.counts).map(([status, count]) => `${status} ${count}`).join(', ')}. The total amount in region north is ${ctx.last.json.north}.`,
  ] },
  expect: [{ replyNumbers: [...Object.values(counts), north] }, { toolCalls: { name: 'run_code', min: 1, max: 2 } }],
  async verify(t) {
    const { browser, q, qa } = t;
    assert.equal(await browser.evaluate(`${qa('[data-testid=tool-card][data-tool=run_code][data-status=completed]')}.length >= 1`), true, 'a completed run_code card is shown');
    const cards = await browser.evaluate(`${qa('[data-testid=tool-card]')}.map(e => e.dataset.tool)`);
    assert.ok(cards.length >= 1 && cards.length <= 2 && cards.every(card => card === 'run_code'), `tool cards: ${cards.join(' | ')}`);
    // The code read every page inside the sandbox and only the aggregate entered the transcript.
    const results = (await t.messages()).filter(message => message.role === 'toolResult' && message.toolName === 'run_code');
    assert.ok(results.length >= 1 && results.length <= 2, `one or two code executions, saw ${results.length}`);
    assert.ok(results.reduce((sum, result) => sum + (result.details?.nestedCalls ?? 0), 0) >= pages, 'the code read every page inside the sandbox');
    assert.ok(results.at(-1).details.outputChars < 2000, 'only the aggregate entered the transcript');
    await browser.screenshot('codemode.png');

    // The sandbox reaches only the injected tools: nothing else exists inside it.
    const probe = await runCode(`const seen = {};
for (const name of ['fetch', 'require', 'process', 'setTimeout', 'XMLHttpRequest', 'WebAssembly', 'Deno', 'Bun']) seen[name] = typeof globalThis[name];
let imported; try { await import('node:fs'); imported = 'loaded'; } catch (error) { imported = 'refused'; }
return { seen, imported, tools: Object.keys(tools).sort(), first: (await tools.get_record({ id: 'REC-0001' })).id };`);
    assert.equal(probe.isError, false, probe.text);
    const result = JSON.parse(probe.text);
    assert.deepEqual([...new Set(Object.values(result.seen))], ['undefined'], probe.text);
    assert.equal(result.imported, 'refused');
    assert.deepEqual(result.tools, ['get_record', 'list_records']);
    assert.equal(result.first, 'REC-0001');
    for (const code of [`return await fetch('http://127.0.0.1/')`, `return require('node:fs').readdirSync('/')`, `return process.env`]) {
      const denied = await runCode(code);
      assert.equal(denied.isError, true, code);
      assert.match(denied.text, /^script: .*(not defined|not a function)/, code);
    }
    // A deep throw and a host tool's failure come back as the bounded message: no stack frames, at most the output cap.
    for (const code of ['function down(n) { if (!n) throw new Error(`deep ${"x".repeat(20000)}`); return down(n - 1); } down(500)', `await tools.get_record({ id: 'REC-NONE' })`]) {
      const failed = await runCode(code);
      assert.equal(failed.isError, true, code);
      assert.match(failed.text, /^script: Error: (deep|No record REC-NONE)/, failed.text.slice(0, 200));
      assert.doesNotMatch(failed.text, /^\s+at /m, 'no stack frames reach the transcript');
      assert.ok(failed.text.length <= LIMITS.outputChars + 100, `bounded: ${failed.text.length}`);
    }
    const spinning = await runCode('while (true) {}', AbortSignal.timeout(300));
    assert.equal(spinning.isError, true);
    assert.match(spinning.text, /^aborted:/);
    void q;
  },
};
