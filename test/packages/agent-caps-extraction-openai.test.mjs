// OpenAI as the second extraction provider (caps/extraction/openai.ts). Offline: Mistral and OpenAI are local doubles behind the `fetch`
// option; the global `fetch` throws and is checked never called. Fictional documents only; planted keys appear nowhere.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import baseTest from 'node:test';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { documentTools } from '@hachej/boring-agent/documents';
import { ocrFor, readFields, readText } from '@hachej/boring-agent/caps/extraction';
import { INVOICE_PDF, INVOICE_SCHEMA, mistralDouble, pagesPdf } from '../fixtures/caps/extraction/documents.mjs';

const test = (name, body) => baseTest(name, async (t) => {
  const saved = globalThis.fetch, reached = [];
  globalThis.fetch = (...args) => { reached.push(args); throw new Error('the network is off'); };
  try { await body(t); } finally { globalThis.fetch = saved; }
  assert.deepEqual(reached, [], 'the global fetch was never called');
});

const KEYS = { MISTRAL_API_KEY: 'mk-PLANTED-0001', OPENAI_API_KEY: 'ok-PLANTED-0002' };
const SCAN = new Uint8Array(readFileSync(new URL('../fixtures/caps/extraction-openai/scan-1.pdf', import.meta.url)));
/** Mistral (`mistral`: a status) and OpenAI's Responses API behind one `fetch`; OpenAI answers `pages` (it may number them its own way). */
function doubles({ mistral = 503, pages = [{ n: 1, text: 'Atelier Imaginaire SARL\nTotal TTC 1 234,56 EUR' }], raw } = {}) {
  const m = mistralDouble({ status: mistral, ...(raw !== undefined && { raw }) }), openai = [];
  const fetch = async (url, init) => {
    if (String(url).startsWith('https://api.mistral.ai/')) return m.fetch(url, init);
    openai.push(JSON.parse(init.body));
    const fields = { supplier: { value: 'Atelier Imaginaire SARL', page: 1, quote: 'Atelier Imaginaire SARL' }, total: { value: 1234.56, page: 1, quote: 'Total TTC 1 234,56 EUR' } };
    return Response.json({ model: 'gpt-6.1-sol', usage: { input_tokens: 1000, output_tokens: 200 }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ pages, fields }) }] }] });
  };
  return { fetch, mistral: m.requests, openai };
}
function sink() {
  const calls = [], log = (name) => async (input) => { calls.push([name, input]); return name === 'recordUsage' ? { billedMicros: input.amountMicros } : name === 'reserveRun' ? { reservationId: 'r1' } : undefined; };
  return { calls, reserveRun: log('reserveRun'), recordUsage: log('recordUsage'), settleRun: log('settleRun'), releaseRun: log('releaseRun') };
}
const both = (d, extra = {}) => ({ providers: ['mistral', 'openai'], keys: KEYS, fetch: d.fetch, ...extra });

test('extraction openai not listed: nothing reaches OpenAI unless the app lists it, nor after a bad Mistral answer', async () => {
  const d = doubles();
  assert.deepEqual(await readText({ bytes: INVOICE_PDF }, { ...both(d), providers: ['mistral'] }), { ok: false, kind: 'unavailable', retryable: true });
  const junk = doubles({ mistral: 200, raw: '<html>oops</html>' });
  assert.deepEqual(await readText({ bytes: INVOICE_PDF }, both(junk)), { ok: false, kind: 'extraction-invalid-answer', retryable: false });
  assert.deepEqual([d.openai.length, junk.openai.length], [0, 0]);
});

test('extraction openai fields: every field stays « À revoir », nothing stored, keys only from `keys`', async () => {
  const d = doubles(), s = sink();
  const read = await readFields({ bytes: INVOICE_PDF }, INVOICE_SCHEMA, both(d, { meter: { sink: s, userId: 'u' } }));
  assert.deepEqual([read.provider, read.uncertain, read.fields.map((f) => [f.value, f.reason])], ['openai', true, Array(4).fill([null, 'uncertain'])]);
  assert.equal(d.openai[0].store, false);
  process.env.OPENAI_API_KEY = 'ok-PLANTED-env';
  try {
    const none = doubles();
    assert.equal((await readText({ bytes: INVOICE_PDF }, { ...both(none), keys: { MISTRAL_API_KEY: KEYS.MISTRAL_API_KEY } })).ok, false);
    assert.equal(none.openai.length, 0);
  } finally { delete process.env.OPENAI_API_KEY; }
  assert.ok(!JSON.stringify([read, s.calls]).includes('PLANTED'));
  assert.ok(!/console\./.test(readFileSync(new URL('../../packages/agent/src/caps/extraction/openai.ts', import.meta.url), 'utf8')));
});

test('extraction openai real check: NAME=value lines on stdin, skipped without keys, prints no key', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('../../scripts/cap-real/extraction-openai.mjs', import.meta.url).pathname;
  const go = (input) => spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=async()=>new Response("{}",{status:401})', script], { input, encoding: 'utf8' });
  assert.deepEqual([go('').status, go('OPENAI_API_KEY=\n').stdout.trim()], [0, 'skipped: no key']);
  const run = go('OPENAI_API_KEY=ok-PLANTED-stdin\nMISTRAL_API_KEY=\n');
  assert.deepEqual([run.stdout.includes('mistral: skipped'), run.stdout.includes('openai scan-1.pdf'), (run.stdout + run.stderr).includes('PLANTED')], [true, true, false]);
});

test('extraction openai failover: Mistral down, OpenAI reads the scan and read_pdf\'s page, priced by tokens', async () => {
  const d = doubles(), text = await readText({ bytes: SCAN }, both(d));
  assert.deepEqual([text.ok, text.provider, text.region, text.pages[0].text.split('\n')[0]], [true, 'openai', 'us', 'Atelier Imaginaire SARL']);
  const s = sink(), page = doubles({ pages: [{ n: 1, text: 'renumbered by the provider' }, { n: 2, text: "Page 2 lue par OpenAI (fictive)" }] });
  const [readPdf] = documentTools({ readBytes: () => pagesPdf(3, [2]), ocr: ocrFor(both(page, { meter: { sink: s, userId: 'camille' } })) });
  const out = JSON.parse((await readPdf.execute({ path: 'trois.pdf' }, {}, context)).output[0].text);
  assert.deepEqual([out.pages[0].text, out.pages[1], out.note.includes('openai')], ['Page 1 (fictional)', { n: 2, text: 'Page 2 lue par OpenAI (fictive)', ocr: true }, true]);
  assert.match(page.openai[0].input[0].content[0].text, /only pages 2/);
  assert.deepEqual(s.calls.filter(([n]) => n === 'recordUsage').map(([, i]) => [i.bucket, i.amountMicros]), [['tool:extract', 4000]]);
});
