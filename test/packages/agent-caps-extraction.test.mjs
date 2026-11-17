// The extraction capability (caps/extraction): text and checked fields from a PDF or an image, the field check alone, the `documents` OCR
// callback and the `extract_fields` tool. Offline: Mistral is a local double behind the `fetch` option; the global `fetch` throws and is
// checked never called. Fictional documents only; planted keys appear nowhere.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import baseTest from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { documentTools } from '@hachej/boring-agent/documents';
import { checkFields, extractionTool, ocrFor, readFields, readText } from '@hachej/boring-agent/caps/extraction';
import { INVOICE_FIELDS, INVOICE_LINES, INVOICE_PDF, INVOICE_PNG, INVOICE_SCHEMA, INVOICE_TEXT, MARKDOWN, QUOTES, TAMPERED, mistralDouble, pagesPdf, pdf } from '../fixtures/caps/extraction/documents.mjs';

const test = (name, body) => baseTest(name, async (t) => {
  const saved = globalThis.fetch, reached = [];
  globalThis.fetch = (...args) => { reached.push(args); throw new Error('the network is off'); };
  try { await body(t); } finally { globalThis.fetch = saved; }
  assert.deepEqual(reached, [], 'the global fetch was never called');
});

const KEYS = { MISTRAL_API_KEY: 'mk-PLANTED-0001' };
const mistral = (double, extra = {}) => ({ providers: ['mistral'], keys: KEYS, fetch: double.fetch, ...extra });
const expected = () => Object.entries(INVOICE_FIELDS).map(([name, value]) => ({ name, value, confidence: 0.97, evidence: { page: 1, quote: QUOTES[name] } }));
function sink(refuse) {
  const calls = [], log = (name) => async (input) => { calls.push([name, input]); return name === 'recordUsage' ? { billedMicros: input.amountMicros } : name === 'reserveRun' ? (refuse ? { kind: 'refused', reason: refuse } : { reservationId: 'r1' }) : undefined; };
  return { calls, names: () => calls.map(([n]) => n), reserveRun: log('reserveRun'), recordUsage: log('recordUsage'), settleRun: log('settleRun'), releaseRun: log('releaseRun') };
}
const charged = (s) => s.calls.filter(([n]) => n === 'recordUsage').map(([, i]) => i.amountMicros);
const readPdfOf = (files, ocr) => documentTools({ readBytes: (p) => files[p], ocr }).find((t) => t.name === 'read_pdf');
const read = async (tool, path) => JSON.parse((await tool.execute({ path }, {}, context)).output[0].text);

test('extraction plain import: an invoice as a PDF and as a photo, four fields with their quotes, one request each', async () => {
  for (const bytes of [INVOICE_PDF, INVOICE_PNG]) {
    const double = mistralDouble();
    const result = await readFields({ bytes }, { supplier: 'string', invoiceNumber: 'string', invoiceDate: 'date', total: 'amount' }, mistral(double));
    assert.deepEqual([result.ok, result.provider, result.region, result.counted, result.untrusted, result.uncertain], [true, 'mistral', 'eu', false, true, false]);
    assert.deepEqual(result.fields, expected());
    assert.deepEqual(result.pages, [{ n: 1, text: MARKDOWN, confidence: 0.97 }]);
    assert.equal(double.requests.length, 1);
    assert.equal(double.requests[0].body.document.type, bytes === INVOICE_PDF ? 'document_url' : 'image_url');
  }
  const text = await readText({ bytes: INVOICE_PDF }, mistral(mistralDouble()));
  assert.deepEqual([text.ok, text.pages[0].n, text.uncertain, 'fields' in text], [true, 1, false, false]);
  assert.equal((await readText({ bytes: INVOICE_PDF.slice().buffer }, mistral(mistralDouble()))).ok, true);
});

test('extraction fields: a field is kept only when its whole value is on its page', async () => {
  const tampered = await readFields({ bytes: INVOICE_PDF }, INVOICE_SCHEMA, mistral(mistralDouble({ annotation: TAMPERED })));
  assert.deepEqual(tampered.fields.filter((f) => f.value === null).map((f) => [f.name, f.reason, f.evidence]), [['supplier', 'uncertain', null], ['total', 'uncertain', null]]);
  assert.equal(tampered.uncertain, true);
  const low = await readFields({ bytes: INVOICE_PDF }, INVOICE_SCHEMA, mistral(mistralDouble({ confidence: 0.79 })));
  assert.deepEqual([low.fields.every((f) => f.value === null), low.uncertain], [true, true]);
  const page = (text, confidence = 0.97) => [{ n: 1, text, confidence }];
  const one = (type, value, quote, text = INVOICE_TEXT) => checkFields({ f: type }, page(text), [{ name: 'f', value, page: 1, quote }])[0];
  for (const [type, value, quote, text] of [
    ['amount', 1234.56, 'Date : 14/10/2026'], ['amount', '1.234', 'Total TTC 1 234,56 EUR'], ['string', 'Atelier Imaginaire SARL', 'x'.repeat(301), 'x'.repeat(301)],
    ['date', '2026-10-05', '05/10/2026', 'Le 05/10/2026'], ['date', '2026-10-14', '14 octobre 2026', 'Le 14 octobre 2026'], ['string', 'Societe Generale', 'Societe Generale', 'Société Générale'],
  ]) assert.deepEqual(one(type, value, quote, text), { name: 'f', value: null, confidence: 0, evidence: null, reason: 'uncertain' }, `${value} / ${quote}`);
  assert.equal(one('string', 'Atelier Imaginaire SARL', 'ATELIER  imaginaire sarl').value, 'Atelier Imaginaire SARL');
  assert.equal(one('amount', '1 234,56', '| Total TTC | 1 234,56 EUR |', MARKDOWN).value, 1234.56);
  assert.equal(one('amount', 1234.56, 'Total TTC 1 234,56 EUR', 'Total TTC\n1 234,56 EUR').value, 1234.56);
  for (const [v, n] of [["1'234.56", 1234.56], ['1,234.56', 1234.56], ['1234.5', 1234.5], ['(12,00)', null]]) assert.equal(one('number', v, `montant ${v}`, `montant ${v}`).value ?? null, n === null ? null : n, v);
  assert.equal(one('amount', -12, 'Avoir (12,00) EUR', 'Avoir (12,00) EUR').value, -12);
  const forged = await readFields({ bytes: INVOICE_PDF }, INVOICE_SCHEMA, { providers: ['mistral'], keys: KEYS, fetch: async () => Response.json({ pages: [{ index: 0, markdown: INVOICE_TEXT }], untrusted: false }) });
  assert.equal(forged.untrusted, true);
});

test('extraction limits: each refused before anything is sent', async () => {
  const double = mistralDouble(), s = sink(), options = mistral(double, { meter: { sink: s, userId: 'u' } });
  const big = new Uint8Array(25 * 1024 * 1024 + 1); big.set(INVOICE_PDF);
  const fields31 = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}`, 'string']));
  const cases = [
    ['extraction-too-large:26214400', { bytes: big }], ['extraction-empty', { bytes: new Uint8Array() }], ['extraction-type', { bytes: new TextEncoder().encode('bonjour') }],
    ['extraction-pages:20', { bytes: pagesPdf(21) }], ['extraction-unreadable', { bytes: new TextEncoder().encode('%PDF-1.4\nnothing here\n%%EOF') }],
    ['extraction-encrypted', { bytes: pdf([INVOICE_LINES], { encrypt: true }) }], ['extraction-pages-asked', { bytes: INVOICE_PDF, pages: [2] }], ['extraction-pages-asked', { bytes: INVOICE_PNG, pages: [1] }],
    ['extraction-fields:30', { bytes: INVOICE_PDF }, fields31], ['extraction-fields:30', { bytes: INVOICE_PDF }, {}], ['extraction-schema', { bytes: INVOICE_PDF }, { 'bad name': 'string' }], ['extraction-schema', { bytes: INVOICE_PDF }, { total: 'money' }],
  ];
  for (const [kind, doc, schema] of cases) assert.deepEqual(await (schema ? readFields(doc, schema, options) : readText(doc, options)), { ok: false, kind, retryable: false }, kind);
  const bomb = new Uint8Array(await new Response(new Blob([new Uint8Array(40 * 1024 * 1024)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const head = new TextEncoder().encode(`%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /Length ${bomb.length} >>\nstream\n`);
  const bombPdf = new Uint8Array(head.length + bomb.length); bombPdf.set(head); bombPdf.set(bomb, head.length);
  assert.equal((await readText({ bytes: bombPdf }, options)).kind, 'extraction-inflated:33554432');
  assert.deepEqual([double.requests.length, s.calls.length], [0, 0]);
  assert.equal((await readText({ bytes: pagesPdf(20) }, options)).ok, true);
  assert.equal((await readText({ bytes: pagesPdf(21), pages: [3] }, options)).ok, true);
  assert.deepEqual([double.requests.at(-1).body.pages, charged(s)], [[2], [40_000, 2000]]);
});

test('extraction ocr: read_pdf reads only the scanned pages, charged as read; a refusal is a short note', async () => {
  const s = sink(), double = mistralDouble({ markdown: (i) => `Page ${i + 1} lue sur l'image (fictive)` });
  const files = { 'trois.pdf': pagesPdf(3, [2]), 'long.pdf': pagesPdf(21, [7]), 'secret.pdf': pdf([INVOICE_LINES], { encrypt: true }) };
  const tool = readPdfOf(files, ocrFor(mistral(double, { meter: { sink: s, userId: 'camille' } })));
  const three = await read(tool, 'trois.pdf');
  assert.deepEqual(three.pages[1], { n: 2, text: "Page 2 lue sur l'image (fictive)", ocr: true });
  assert.match(three.note, /mistral/);
  assert.deepEqual([double.requests[0].body.pages, charged(s)], [[1], [2000]]);
  const long = await read(tool, 'long.pdf');
  assert.deepEqual([long.pages[6].ocr, double.requests[1].body.pages, charged(s)], [true, [6], [2000, 2000]]);
  const before = [double.requests.length, s.calls.length];
  assert.match((await read(tool, 'secret.pdf')).error, /protected/);
  assert.deepEqual([double.requests.length, s.calls.length], before);
  const refused = await read(readPdfOf(files, ocrFor(mistral(double, { meter: { sink: sink('daily-share:50'), userId: 'u' } }))), 'trois.pdf');
  assert.match(refused.note, /OCR failed: daily-share:50$/);
  const many = await read(readPdfOf({ 'scan.pdf': pagesPdf(25, Array.from({ length: 21 }, (_, i) => i + 1)) }, ocrFor(mistral(double))), 'scan.pdf');
  assert.match(many.note, /OCR failed: extraction-pages:20$/);
  for (const note of [refused.note, many.note]) assert.ok(!note.includes('PLANTED'));
});

test('extraction meter: one reserve, one record at the page price, then settle; no name or text reaches the sink', async () => {
  const s = sink();
  const text = await readText({ bytes: pdf([['PLANTED page text one'], ['two'], ['three']]) }, mistral(mistralDouble(), { meter: { sink: s, userId: 'camille' } }));
  assert.equal(text.counted, true);
  assert.deepEqual(s.names(), ['reserveRun', 'recordUsage', 'settleRun']);
  const [, reserve] = s.calls[0], [, record] = s.calls[1];
  assert.match(reserve.runId, /^extraction:[0-9a-f]{16}:.+$/);
  assert.deepEqual([reserve.userId, reserve.conversationId, reserve.message, reserve.content, record.bucket, record.amountMicros, s.calls[2][1].status], ['camille', 0, '', null, 'tool:extract', 6000, 'done']);
  const f = sink();
  await readFields({ bytes: INVOICE_PNG }, INVOICE_SCHEMA, mistral(mistralDouble(), { meter: { sink: f, userId: 'camille' } }));
  assert.deepEqual(charged(f), [3000]);
  assert.ok(!JSON.stringify([s.calls, f.calls]).match(/PLANTED|Atelier|\.pdf/));
  const double = mistralDouble();
  assert.deepEqual(await readText({ bytes: INVOICE_PDF }, mistral(double, { meter: { sink: sink('daily-share:50'), userId: 'u' } })), { ok: false, kind: 'daily-share:50', retryable: false });
  assert.equal(double.requests.length, 0);
  assert.equal((await readText({ bytes: INVOICE_PDF }, mistral(double))).counted, false);
});

test('extraction failover: a provider failure moves on, a bad answer stops, keys only from `keys`', async () => {
  const down = mistralDouble({ status: 503 });
  assert.deepEqual(await readText({ bytes: INVOICE_PDF }, mistral(down)), { ok: false, kind: 'unavailable', retryable: true });
  const refusedKey = mistralDouble({ status: 401 });
  assert.deepEqual(await readText({ bytes: INVOICE_PDF }, mistral(refusedKey)), { ok: false, kind: 'extraction-failed', retryable: false });
  const fixtures = { [await sha256(INVOICE_PDF)]: { pages: [{ n: 1, text: INVOICE_TEXT, confidence: 0.99 }] } };
  const moved = await readText({ bytes: INVOICE_PDF }, { ...mistral(down), providers: ['mistral', 'fake'], fixtures });
  assert.deepEqual([moved.provider, moved.region, moved.pages[0].text], ['fake', 'none', INVOICE_TEXT]);
  const junk = mistralDouble({ raw: '<html>oops</html>' });
  assert.deepEqual(await readText({ bytes: INVOICE_PDF }, { ...mistral(junk), providers: ['mistral', 'fake'], fixtures }), { ok: false, kind: 'extraction-invalid-answer', retryable: false });
  assert.equal(junk.requests.length, 1);
  process.env.MISTRAL_API_KEY = 'mk-PLANTED-env';
  try {
    const none = mistralDouble();
    assert.deepEqual(await readText({ bytes: INVOICE_PDF }, { providers: ['mistral'], keys: {}, fetch: none.fetch }), { ok: false, kind: 'extraction-failed', retryable: false });
    assert.equal(none.requests.length, 0);
  } finally { delete process.env.MISTRAL_API_KEY; }
  assert.deepEqual(await readText({ bytes: INVOICE_PDF }, { providers: ['mistral'], keys: KEYS }), { ok: false, kind: 'extraction-fetch', retryable: false });
  const blank = await readFields({ bytes: INVOICE_PNG }, INVOICE_SCHEMA, { providers: ['fake'] });
  assert.deepEqual([blank.uncertain, blank.fields.every((f) => f.value === null)], [true, true]);
});

test('extraction check alone: the check on text the app already has, no provider call', () => {
  const pages = [{ n: 1, text: MARKDOWN, confidence: 1 }];
  const said = Object.entries(INVOICE_FIELDS).map(([name, value]) => ({ name, value, page: 1, quote: QUOTES[name], confidence: 0.97 }));
  assert.deepEqual(checkFields(INVOICE_SCHEMA, pages, said), expected());
  assert.equal(checkFields(INVOICE_SCHEMA, pages, [{ ...said[0], quote: 'Fournisseur Inventé SA' }])[0].reason, 'uncertain');
});

test('extraction nothing kept: no console line, no file written, no node import in the source', async () => {
  const lines = [], saved = { ...console };
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => lines.push(a.join(' '));
  const files = { 'f.pdf': INVOICE_PDF }, before = JSON.stringify(Object.keys(files));
  try {
    await readText({ bytes: INVOICE_PDF }, mistral(mistralDouble()));
    await readFields({ bytes: INVOICE_PDF }, INVOICE_SCHEMA, mistral(mistralDouble()));
    await extractionTool({ ...mistral(mistralDouble()), readBytes: (p) => files[p] }).execute({ path: 'f.pdf', schema: INVOICE_SCHEMA }, { conversationId: 1, taskId: 1 }, context);
  } finally { Object.assign(console, saved); }
  assert.deepEqual([lines, JSON.stringify(Object.keys(files))], [[], before]);
  const dir = new URL('../../packages/agent/src/caps/extraction/', import.meta.url);
  for (const file of readdirSync(dir)) assert.ok(!/console\.|node:|Buffer/.test(readFileSync(new URL(file, dir), 'utf8')), file);
});

test('extraction real check: reads the key from stdin, skips without one, prints no key', () => {
  const script = new URL('../../scripts/cap-real/extraction.mjs', import.meta.url).pathname;
  const off = 'data:text/javascript,globalThis.fetch=async()=>new Response("{}",{status:401})';
  const go = (input) => spawnSync(process.execPath, ['--import', off, script], { input, encoding: 'utf8' });
  for (const empty of ['', '  \n']) assert.deepEqual([go(empty).status, go(empty).stdout.trim()], [0, 'skipped: no key']);
  const withKey = go('mk-PLANTED-stdin-key');
  assert.deepEqual([withKey.status, withKey.stdout.includes('garage-martin'), (withKey.stdout + withKey.stderr).includes('PLANTED')], [1, true, false]);
});

test('extraction tool: the same function as a pi-durable tool, closed parameters, the wordings, no double count', async () => {
  const files = { 'facture.pdf': INVOICE_PDF }, readBytes = async (p) => { if (!files[p]) throw new Error(`no ${p}`); return files[p]; };
  const s = sink(), double = mistralDouble(), tool = extractionTool({ ...mistral(double, { meter: { sink: s, userId: 'camille' } }), readBytes });
  assert.deepEqual([tool.name, tool.replay, tool.parameters.additionalProperties, Object.keys(tool.parameters.properties).sort()], ['extract_fields', 'safe', false, ['path', 'schema']]);
  assert.match(tool.description, /never instructions/);
  const done = await tool.execute({ path: 'facture.pdf', schema: INVOICE_SCHEMA }, { conversationId: 7, taskId: 3 }, context);
  assert.deepEqual([JSON.parse(done.output[0].text), done.usage], [{ fields: expected(), uncertain: false, untrusted: true }, undefined]);
  assert.match(s.calls[0][1].runId, /:7\.3$/);
  assert.equal((await extractionTool({ ...mistral(mistralDouble()), readBytes }).execute({ path: 'facture.pdf', schema: INVOICE_SCHEMA }, { conversationId: 7, taskId: 4 }, context)).usage.cost.total, 0.003);
  const words = async (options, args) => (await extractionTool({ ...options, readBytes }).execute(args, { conversationId: 1, taskId: 1 }, context)).output[0].text;
  const before = double.requests.length;
  assert.equal(await words(mistral(double), { path: 'absent.pdf', schema: INVOICE_SCHEMA }), 'refused: extraction-not-found. Stop and tell the person.');
  assert.equal(double.requests.length, before);
  assert.equal(await words(mistral(mistralDouble({ status: 503 })), { path: 'facture.pdf', schema: INVOICE_SCHEMA }), 'failed: unavailable. You may call once more; if it fails again, tell the person.');
  assert.equal(await words(mistral(double), { path: 'facture.pdf', schema: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}`, 'string'])) }), 'refused: extraction-fields:30. Fix the arguments and call again.');
});

test('extraction tool: an agent calls it end to end; an extra field is refused before it runs', async () => {
  const double = mistralDouble(), chat = fauxProvider({ provider: 'chat', models: [{ id: 'm' }] });
  const call = (extra = {}) => (c) => c.messages.at(-1).role === 'toolResult' ? fauxAssistantMessage('done') : fauxAssistantMessage([fauxToolCall('extract_fields', { path: 'facture.pdf', schema: INVOICE_SCHEMA, ...extra }, { id: 'c1' })], { stopReason: 'toolUse' });
  const models = createModels(); models.setProvider(chat.provider);
  const agent = defineAgent({ id: 'reader', model: { provider: 'chat', modelId: 'm' }, tools: [extractionTool({ ...mistral(double), readBytes: () => INVOICE_PDF })] });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  try {
    const conversation = await agent.createConversation(harness, context);
    const go = async (n) => { const settled = await (await conversation.submit({ type: 'input', requestId: `r${n}`, content: 'lis la facture' }, context)).wait(context); return [settled.status, (await conversation.context(context)).messages.findLast((m) => m.role === 'toolResult')]; };
    chat.setResponses([call(), call()]);
    const [status, result] = await go(1);
    assert.deepEqual([status, JSON.parse(result.content[0].text).fields, JSON.parse(result.content[0].text).untrusted], ['done', expected(), true]);
    chat.setResponses([call({ providers: ['fake'] }), call({ providers: ['fake'] })]);
    const [, refused] = await go(2);
    assert.deepEqual([refused.isError, double.requests.length], [true, 1]);
  } finally { await harness.close(context); }
});

async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
