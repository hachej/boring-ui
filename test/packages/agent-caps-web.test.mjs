// The web capability (caps/web): `search` (Tavily), `fetch` (the kit's reader) and the `web_search` / `web_fetch` tools. Offline: Tavily and the
// pages are a local double behind the `fetch` option; the global `fetch` throws and is checked never called. Fictional pages and a planted key only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import baseTest from 'node:test';
import { fileURLToPath } from 'node:url';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { build } from 'esbuild';
import { defineAgent } from '@hachej/boring-agent/agents';
import { SEARCH_USD, WEB_NOTE, fetch as readPage, search, webTool } from '@hachej/boring-agent/caps/web';
import { KEY, PAGES, TAVILY_RESULTS, webDouble } from '../fixtures/caps/web/pages.mjs';
import { pdf } from '../fixtures/caps/extraction/documents.mjs';

const test = (name, body) => baseTest(name, async (t) => {
  const saved = globalThis.fetch, reached = [];
  globalThis.fetch = (...args) => { reached.push(args); throw new Error('the network is off'); };
  try { await body(t); } finally { globalThis.fetch = saved; }
  assert.deepEqual(reached, [], 'the global fetch was never called');
});
const PAGE = 'https://physique.example.test/page';
const tv = (double, extra = {}) => ({ providers: ['tavily'], keys: { TAVILY_API_KEY: KEY }, fetch: double.fetch, ...extra });
const rd = (double, extra = {}) => ({ providers: ['reader'], fetch: double.fetch, ...extra });
const fake = { providers: ['fake'] };
const refusal = (kind, retryable = false) => ({ ok: false, kind, retryable });
function sink(refuse) {
  const calls = [], log = (name) => async (input) => { calls.push([name, input]); return name === 'recordUsage' ? { billedMicros: input.amountMicros } : name === 'reserveRun' ? (refuse ? { kind: 'refused', reason: refuse } : { reservationId: 'r1' }) : undefined; };
  return { calls, names: () => calls.map(([n]) => n), reserveRun: log('reserveRun'), recordUsage: log('recordUsage'), settleRun: log('settleRun'), releaseRun: log('releaseRun') };
}

test('web plain import: a search and a page, with the fake, Tavily and the reader', async () => {
  const f = await search({ query: 'pendulum experiment' }, fake);
  assert.deepEqual([f.ok, f.results.length, f.provider, f.region, f.counted, f.untrusted], [true, 2, 'fake', 'none', false, true]);
  assert.deepEqual(Object.keys(f.results[0]).sort(), ['published', 'snippet', 'title', 'url']);
  const p = await readPage({ url: 'https://physique.example.test/page' }, fake);
  assert.deepEqual([p.ok, p.truncated, p.untrusted, p.provider], [true, false, true, 'fake']);
  const double = webDouble();
  const t = await search({ query: 'pendulum experiment' }, tv(double));
  assert.deepEqual([t.ok, t.provider, t.region, t.results[0].url, t.untrusted], [true, 'tavily', 'us', 'https://physique.example.test/pendulum', true]);
  assert.equal(double.calls.length, 1);
  assert.deepEqual(JSON.parse(double.calls[0].body), { query: 'pendulum experiment', max_results: 5, search_depth: 'basic', include_answer: false, include_raw_content: false, include_images: false });
  const r = await readPage({ url: PAGE }, rd(double));
  assert.deepEqual([r.ok, r.provider, r.region, r.title], [true, 'reader', 'global', 'The pendulum experiment']);
  assert.match(r.markdown, /Measure the period with a stopwatch\./);
});

test('web url guard: refused before anything is sent', async () => {
  const double = webDouble(), s = sink(), options = rd(double, { meter: { sink: s, userId: 'u' } });
  for (const url of ['http://physique.example.test/page', 'https://user:pass@physique.example.test/page', 'https://127.0.0.1/page', 'https://[::1]/page', 'https://0x7f000001/page', 'https://2130706433/page', 'https://localhost/page', 'https://printer.local/x', 'https://service.internal./x', 'https://app.localhost/x', 'ftp://physique.example.test/x', 'not a url', 5, `https://physique.example.test/${'a'.repeat(2050)}`]) {
    assert.deepEqual(await readPage({ url }, options), refusal('web-url'), String(url).slice(0, 40));
  }
  assert.deepEqual([double.calls.length, s.names()], [0, []]);
  assert.equal((await readPage({ url: 'https://PHYSIQUE.example.test/page' }, rd(double))).ok, true);
  assert.equal(double.calls[0].url, PAGE);
});

test('web redirects: each hop checked, five followed, the sixth refused', async () => {
  const chain = ['https://physique.example.test/c', (_, url) => Number(url.slice(-1)) < 5 ? new Response(null, { status: 302, headers: { location: `/c${Number(url.slice(-1)) + 1}` } }) : new Response(PAGES.page, { headers: { 'content-type': 'text/html' } })];
  const double = webDouble({ extra: [chain] });
  assert.equal((await readPage({ url: 'https://physique.example.test/moved' }, rd(double))).url, PAGE);
  assert.equal((await readPage({ url: 'https://physique.example.test/c0' }, rd(double))).ok, true);
  assert.ok(double.calls.every((c) => c.redirect === 'manual'));
  for (const path of ['to-http', 'to-local', 'to-internal']) {
    const before = double.calls.length;
    assert.deepEqual(await readPage({ url: `https://physique.example.test/${path}` }, rd(double)), refusal('web-redirect'), path);
    assert.equal(double.calls.length, before + 1, 'the target got no request');
  }
  const before = double.calls.length;
  assert.deepEqual(await readPage({ url: 'https://physique.example.test/loop' }, rd(double)), refusal('web-redirect'));
  assert.equal(double.calls.length, before + 6);
});

test('web search limits: checked before anything is sent', async () => {
  const double = webDouble(), s = sink(), options = tv(double, { meter: { sink: s, userId: 'u' } });
  assert.deepEqual(await search({ query: '   ' }, options), refusal('web-query'));
  assert.deepEqual(await search({ query: `${'a '.repeat(150)}${'b'.repeat(200)}` }, options), refusal('web-query:400'));
  assert.deepEqual([double.calls.length, s.names()], [0, []]);
  const sent = async (limit) => { const before = double.calls.length; const r = await search({ query: 'pendulum', limit }, tv(double)); return [JSON.parse(double.calls[before].body).max_results, r.results.length]; };
  assert.deepEqual(await sent(50), [8, 3]);
  for (const limit of [undefined, 0, 'x']) assert.equal((await sent(limit))[0], 5, String(limit));
  assert.deepEqual(await sent(2), [2, 2]);
  assert.equal((await search({ query: 'pendulum', limit: 3 }, tv(double))).results.length, 3);
});

test('web reader: readable text, charset, plain text, a PDF, and only the page\'s own request', async () => {
  const double = webDouble(), read = (path) => readPage({ url: `https://physique.example.test/${path}` }, rd(double));
  const page = await read('page');
  assert.match(page.markdown, /^# The pendulum experiment/);
  assert.doesNotMatch(page.markdown, /never read|Menu Accueil|Footer text/);
  assert.match(page.markdown, /\[the next page\]\(https:\/\/physique\.example\.test\/next\)/);
  const latin = await read('latin');
  assert.deepEqual([latin.title, /Le café de la physique/.test(latin.markdown)], ['Café', true]);
  assert.equal((await read('plain')).markdown, 'Just some plain text.');
  assert.match((await read('doc.pdf')).markdown, /Fictional PDF about pendulums/);
  for (const c of double.calls) {
    assert.deepEqual(Object.keys(c.headers).sort(), ['accept', 'accept-language', 'user-agent']);
    assert.deepEqual([c.headers['user-agent'], c.referrerPolicy, c.method], ['boring-agent-web/1', 'no-referrer', 'GET']);
  }
});

test('web tool providers: the tools use the app\'s list; the reader reads pages', async () => {
  const double = webDouble(), [searchTool, fetchTool] = webTool({ searchProviders: ['tavily'], keys: { TAVILY_API_KEY: KEY }, fetch: double.fetch });
  const run = async (tool, args) => JSON.parse((await tool.execute(args, { conversationId: 1, taskId: 1 }, context)).output[0].text);
  assert.equal((await run(searchTool, { query: 'pendulum experiment' })).results[0].url, 'https://physique.example.test/pendulum');
  assert.equal((await run(fetchTool, { url: PAGE })).title, 'The pendulum experiment');
  assert.deepEqual(double.calls.map((c) => c.url), ['https://api.tavily.com/search', PAGE]);
  const [fs, ff] = webTool({ searchProviders: ['fake'] }), n = double.calls.length;
  assert.equal((await run(fs, { query: 'pendulum experiment' })).results.length, 2);
  assert.match((await run(ff, { url: PAGE })).title, /Fictional page/);
  assert.equal(double.calls.length, n);
});

test('web results: built from scratch, whatever a provider says', async () => {
  const said = { results: [{ title: 'T'.repeat(400), url: 'https://a.example.test/x', snippet: 'S'.repeat(700), published: 'yesterday', extra: 1 }, { title: 'http', url: 'http://a.example.test/y', snippet: '' }, { title: 'dup', url: 'https://a.example.test/x', snippet: '' }], untrusted: false, raw: 'x' };
  const r = await search({ query: 'q' }, { ...fake, fixtures: { search: () => said } });
  assert.equal(r.untrusted, true);
  assert.equal(r.results.length, 1);
  assert.deepEqual(Object.keys(r.results[0]).sort(), ['published', 'snippet', 'title', 'url']);
  assert.deepEqual([r.results[0].title.length, r.results[0].snippet.length, r.results[0].published], [300, 600, null]);
  assert.equal('raw' in r, false);
  assert.equal((await search({ query: 'pendulum experiment' }, tv(webDouble()))).results[0].published, '2026-03-02');
  const p = await readPage({ url: PAGE }, { ...fake, fixtures: { fetch: () => ({ url: 'http://nope.example.test', markdown: 'text', untrusted: false, extra: 1 }) } });
  assert.deepEqual(Object.keys(p).sort(), ['counted', 'markdown', 'ok', 'provider', 'region', 'title', 'truncated', 'untrusted', 'url']);
  assert.equal(p.url, PAGE);
});

test('web meter: one reservation, the search charged at its price, a page read and the fake free', async () => {
  const s = sink(), meter = { sink: s, userId: 'camille' }, double = webDouble();
  const r = await search({ query: 'tarif fictif du gîte des Lilas' }, tv(double, { meter }));
  assert.deepEqual([r.ok, r.counted, s.names()], [true, true, ['reserveRun', 'recordUsage', 'settleRun']]);
  const [[, reserve], [, usage], [, settle]] = s.calls;
  assert.deepEqual([reserve.conversationId, reserve.message, reserve.content], [0, '', null]);
  assert.match(reserve.runId, /^web:[0-9a-f]{16}:.+$/);
  assert.deepEqual([usage.bucket, usage.amountMicros, settle.status], ['tool:web-search', Math.round(SEARCH_USD * 1_000_000), 'done']);
  assert.equal(SEARCH_USD, 0.008);
  const page = sink();
  assert.equal((await readPage({ url: PAGE }, rd(double, { meter: { sink: page, userId: 'camille' } }))).counted, true);
  assert.deepEqual(page.names(), ['reserveRun', 'settleRun']);
  const free = sink();
  await search({ query: 'tarif fictif du gîte des Lilas' }, { ...fake, meter: { sink: free, userId: 'camille' } });
  assert.deepEqual(free.names(), ['reserveRun', 'settleRun']);
  assert.ok(!JSON.stringify([s.calls, page.calls]).includes('tarif fictif') && !JSON.stringify(page.calls).includes(PAGE));
  const before = double.calls.length;
  assert.deepEqual(await search({ query: 'q' }, tv(double, { meter: { sink: sink('daily-share:50'), userId: 'u' } })), refusal('daily-share:50'));
  assert.equal(double.calls.length, before);
  assert.equal((await search({ query: 'q' }, tv(double))).counted, false);
});

test('web keys: by name only, and never in a result', async () => {
  process.env.TAVILY_API_KEY = 'tvly-ENV-PLANTED';
  try {
    const double = webDouble();
    assert.deepEqual(await search({ query: 'q' }, tv(double, { keys: {} })), refusal('web-failed'));
    assert.equal(double.calls.length, 0);
    const s = sink(), r = await search({ query: 'q' }, tv(double, { meter: { sink: s, userId: 'u' } }));
    assert.equal(double.calls[0].headers.authorization, `Bearer ${KEY}`);
    assert.ok(!JSON.stringify([r, s.calls]).includes(KEY) && !JSON.stringify(double.calls.slice(1)).includes('ENV-PLANTED'));
  } finally { delete process.env.TAVILY_API_KEY; }
});

test('web tool: an agent searches, reads the page and answers; the wordings; no double count', async () => {
  const tools = webTool({ searchProviders: ['fake'] });
  assert.deepEqual(tools.map((t) => [t.name, t.replay, t.parameters.additionalProperties]), [['web_search', 'safe', false], ['web_fetch', 'safe', false]]);
  assert.ok(tools.every((t) => t.description.includes(WEB_NOTE)));
  const chat = fauxProvider({ provider: 'chat', models: [{ id: 'm' }] }), models = createModels();
  models.setProvider(chat.provider);
  const asked = (c) => c.messages.filter((m) => m.role === 'toolResult').length;
  const step = (c) => asked(c) === 0 ? fauxAssistantMessage([fauxToolCall('web_search', { query: 'pendulum experiment' }, { id: 'c1' })], { stopReason: 'toolUse' })
    : asked(c) === 1 ? fauxAssistantMessage([fauxToolCall('web_fetch', { url: JSON.parse(c.messages.at(-1).content[0].text).results[0].url }, { id: 'c2' })], { stopReason: 'toolUse' }) : fauxAssistantMessage('done');
  const double = webDouble(), searched = [];
  const agent = defineAgent({ id: 'reader', model: { provider: 'chat', modelId: 'm' }, tools: webTool({ searchProviders: ['fake'], fixtures: { search: (input) => { searched.push(input); return { results: [{ title: 'Pendulum', url: PAGE, snippet: 's' }] }; } } }) });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  try {
    const conversation = await agent.createConversation(harness, context);
    const go = async (n) => (await (await conversation.submit({ type: 'input', requestId: `r${n}`, content: 'cherche' }, context)).wait(context)).status;
    chat.setResponses([step, step, step]);
    assert.equal(await go(1), 'done');
    const results = (await conversation.context(context)).messages.filter((m) => m.role === 'toolResult').map((m) => JSON.parse(m.content[0].text));
    assert.deepEqual([results[0].note, results[0].untrusted, results[0].query, results[1].untrusted, results[1].url], [WEB_NOTE, true, 'pendulum experiment', true, PAGE]);
    chat.setResponses([(c) => c.messages.at(-1).role === 'toolResult' ? fauxAssistantMessage('done') : fauxAssistantMessage([fauxToolCall('web_search', { query: 'q', providers: ['x'] }, { id: 'c3' })], { stopReason: 'toolUse' }), (c) => fauxAssistantMessage('done')]);
    await go(2);
    assert.equal((await conversation.context(context)).messages.findLast((m) => m.role === 'toolResult').isError, true);
    assert.equal(searched.length, 1, 'refused before execute');
  } finally { await harness.close(context); }
  const words = async (options, name, args) => (await webTool(options).find((t) => t.name === name).execute(args, { conversationId: 1, taskId: 1 }, context)).output[0].text;
  assert.equal(await words({ searchProviders: ['fake'] }, 'web_fetch', { url: 'http://physique.example.test/page' }), 'refused: web-url. Fix the arguments and call again.');
  assert.equal(await words({ searchProviders: ['tavily'], fetch: double.fetch }, 'web_fetch', { url: 'https://physique.example.test/to-http' }), 'refused: web-redirect. Stop and tell the person.');
  assert.equal(await words({ searchProviders: ['tavily'], keys: { TAVILY_API_KEY: KEY }, fetch: webDouble({ tavily: 503 }).fetch }, 'web_search', { query: 'q' }), 'failed: unavailable. You may call once more; if it fails again, tell the person.');
  const [searchTool] = webTool({ searchProviders: ['fake'], meter: { sink: sink(), userId: 'u' } }), [bare] = webTool({ searchProviders: ['fake'] });
  assert.equal((await searchTool.execute({ query: 'q' }, { conversationId: 1, taskId: 1 }, context)).usage, undefined);
  assert.ok((await bare.execute({ query: 'q' }, { conversationId: 1, taskId: 2 }, context)).usage);
});

test('web failover: the next provider answers a failure; an invalid answer stops; a refusal never holds provider text', async () => {
  const both = { ...tv(webDouble({ tavily: 503 })), providers: ['tavily', 'fake'] };
  assert.equal((await search({ query: 'q' }, both)).provider, 'fake');
  for (const status of [503, 429]) assert.deepEqual(await search({ query: 'q' }, tv(webDouble({ tavily: status }))), refusal('unavailable', true), String(status));
  for (const status of [401, 403, 432, 433]) assert.deepEqual(await search({ query: 'q' }, tv(webDouble({ tavily: status }))), refusal('web-failed'), String(status));
  assert.equal((await search({ query: 'q' }, { ...tv(webDouble({ tavily: 401 })), providers: ['tavily', 'fake'] })).provider, 'fake');
  let read = 0;
  const bad = webDouble({ extra: [['https://api.tavily.com/search', () => new Response('not json', { headers: { 'content-type': 'text/plain' } })]] });
  assert.deepEqual(await search({ query: 'q' }, { ...tv(bad), providers: ['tavily', 'fake'], fixtures: { search: () => { read++; return {}; } } }), refusal('web-invalid-answer'));
  assert.equal(read, 0);
  const none = webDouble();
  assert.deepEqual(await readPage({ url: PAGE }, tv(none)), refusal('web-provider'));
  assert.deepEqual(await search({ query: 'q' }, rd(none)), refusal('web-provider'));
  assert.deepEqual(await search({ query: 'q' }, { providers: ['tavily'], keys: { TAVILY_API_KEY: KEY } }), refusal('web-no-fetch'));
  assert.equal(none.calls.length, 0);
  const echo = JSON.stringify(await search({ query: 'q' }, tv(webDouble({ mode: 'error' }))));
  assert.ok(!echo.includes('echo') && !echo.includes(KEY));
});

test('web page limits: cut, refused or retryable, each named', async () => {
  const run = async (path, extra = {}, double = webDouble()) => [await readPage({ url: `https://physique.example.test/${path}` }, rd(double, extra)), double];
  const [huge, hd] = await run('huge');
  assert.deepEqual([huge.ok, huge.truncated, hd.state.cancelled], [true, true, true]);
  const [pdfHuge, pd] = await run('huge.pdf');
  assert.deepEqual([pdfHuge, pd.state.cancelled], [refusal('web-too-large:8000000'), true]);
  const [big] = await run('big');
  assert.deepEqual([big.markdown.length, big.truncated], [12_000, true]);
  const [gif, gd] = await run('image');
  assert.deepEqual([gif, gd.state.cancelled], [refusal('web-type'), true]);
  for (const [path, expected] of [['empty', refusal('web-empty')], ['gone', refusal('web-page')], ['absent', refusal('web-page')], ['down', refusal('unavailable', true)], ['busy', refusal('unavailable', true)], ['bad.pdf', refusal('web-unreadable')]]) assert.deepEqual((await run(path))[0], expected, path);
  const [slow, sd] = await run('slow', { timeoutMs: 40 });
  assert.deepEqual([slow, sd.calls[0].aborted], [refusal('timeout', true), true]);
});

baseTest('web lazy imports: the reader\'s libraries load on the first page read only', () => {
  const hook = 'import { registerHooks } from "node:module"; globalThis.specs = []; registerHooks({ resolve(s, c, next) { globalThis.specs.push(s); return next(s, c); } });';
  const script = `import { search, fetch } from "@hachej/boring-agent/caps/web";
    const libs = ["@mozilla/readability", "linkedom", "turndown", "unpdf"], seen = () => libs.filter((l) => globalThis.specs.includes(l));
    await search({ query: "q" }, { providers: ["fake"] }); const before = seen();
    const page = "<html><head><title>T</title></head><body><article><p>" + "text ".repeat(100) + "</p></article></body></html>";
    await fetch({ url: "https://physique.example.test/page" }, { providers: ["reader"], fetch: async () => new Response(page, { headers: { "content-type": "text/html" } }) });
    const html = seen();
    const { pdf } = await import(${JSON.stringify(new URL('../fixtures/caps/extraction/documents.mjs', import.meta.url).href)});
    await fetch({ url: "https://physique.example.test/doc.pdf" }, { providers: ["reader"], fetch: async () => new Response(pdf([["A PDF"]]), { headers: { "content-type": "application/pdf" } }) });
    console.log(JSON.stringify([before, html, seen()]));`;
  const out = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(hook)}`, '--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const [before, html, all] = JSON.parse(out.stdout.trim().split('\n').at(-1));
  assert.deepEqual([before, html.sort(), all.sort()], [[], ['@mozilla/readability', 'linkedom', 'turndown'], ['@mozilla/readability', 'linkedom', 'turndown', 'unpdf']]);
  const grep = spawnSync('grep', ['-rn', 'node:\\|Buffer\\|console\\.', 'packages/agent/src/caps/web'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' });
  assert.equal(grep.stdout, '');
});

baseTest('web workerd: the reader runs in workerd', { timeout: 300_000 }, async (t) => {
  const { Miniflare, convertV4MiniflareOptions } = createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'))('miniflare');
  const worker = `import { fetch as readPage } from "@hachej/boring-agent/caps/web";
    export default { async fetch(request) { const url = new URL(request.url).searchParams.get("url"); return Response.json(await readPage({ url }, { providers: ["reader"], fetch: (...a) => fetch(...a) })); } };`;
  const bundle = await build({ stdin: { contents: worker, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'], logLevel: 'silent' });
  const double = webDouble();
  const flags = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ handleRuntimeStdio() {}, workers: [{ name: 'web', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01', compatibilityFlags: flags, outboundService: (request) => double.fetch(request.url, { headers: Object.fromEntries(request.headers) }) }] }));
  t.after(() => mf.dispose());
  const read = async (path) => (await mf.dispatchFetch(`https://worker.test/?url=${encodeURIComponent(`https://physique.example.test/${path}`)}`)).json();
  const page = await read('page');
  assert.deepEqual([page.ok, page.title], [true, 'The pendulum experiment']);
  assert.match(page.markdown, /Measure the period with a stopwatch\./);
  assert.doesNotMatch(page.markdown, /never read|Menu Accueil|Footer text/);
  const latin = await read('latin');
  assert.deepEqual([latin.title, /Le café de la physique/.test(latin.markdown)], ['Café', true]);
  assert.match((await read('doc.pdf')).markdown, /Fictional PDF about pendulums/);
});
