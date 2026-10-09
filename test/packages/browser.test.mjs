// @hachej/boring-browser: the opt-in agent worker's entries, run here in Node (a MessageChannel stands in for a Worker and SQLite
// Wasm uses memory). The browser journey (examples/browser-agent) runs them in headless Chromium.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

test('worker transport carries Requests with streamed bodies and abort over a message channel', async () => {
  const { serveRequests, connectWorker } = await import('@hachej/boring-browser/transport');
  const { port1: page, port2: worker } = new MessageChannel();
  let aborted = false;
  const stop = serveRequests(async request => {
    const url = new URL(request.url);
    if (url.pathname === '/echo') return Response.json({ method: request.method, body: await request.text() }, { status: 201 });
    if (url.pathname === '/stream') {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('one\n')); controller.enqueue(encoder.encode('two\n')); controller.close(); } }));
    }
    if (url.pathname === '/hang') return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }));
    return new Response(null, { status: 404 });
  }, worker);
  const connection = connectWorker(page);
  try {
    await connection.ready;
    const echoed = await connection.fetch('https://agent.invalid/echo', { method: 'POST', body: 'fictional payload' });
    assert.equal(echoed.status, 201);
    assert.deepEqual(await echoed.json(), { method: 'POST', body: 'fictional payload' });
    assert.equal(await (await connection.fetch('https://agent.invalid/stream')).text(), 'one\ntwo\n');
    assert.equal((await connection.fetch('https://agent.invalid/missing')).status, 404);
    const controller = new AbortController();
    const hanging = connection.fetch('https://agent.invalid/hang', { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(hanging, { name: 'AbortError' });
    for (let attempt = 0; attempt < 100 && !aborted; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(aborted, true, 'the worker saw the abort');
  } finally { stop(); page.close(); worker.close(); }
});

test('browser SQLite satisfies the pi-durable database contract and a Harness runs on it', async t => {
  const { openBrowserSqlite } = await import('@hachej/boring-browser/sqlite');
  const { SqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite');
  const { sqliteWasmFiles } = await import('@hachej/boring-browser/build');
  assert.deepEqual([...sqliteWasmFiles()['/vendor/sqlite3.wasm'].slice(0, 4)], [0, 0x61, 0x73, 0x6d], 'the build helper finds the SQLite wasm');
  const db = await openBrowserSqlite('/contract.sqlite');
  assert.equal(db.persistent, false, 'no OPFS in Node: memory fallback');
  await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, data BLOB)');
  await db.run('INSERT INTO t (name, data) VALUES (?, ?)', 'a', new Uint8Array([1, 2]));
  assert.equal((await db.get('SELECT name FROM t WHERE id = ?', 1)).name, 'a');
  await assert.rejects(db.transaction(async tx => { await tx.run('INSERT INTO t (name) VALUES (?)', 'rolled back'); throw new Error('stop'); }), /stop/);
  assert.deepEqual((await db.all('SELECT name FROM t')).map(row => row.name), ['a']);
  const harness = await Harness.open(await SqliteStorage.open(db), { registry: createRegistry(), models: createModels() }, context);
  const conversation = await harness.root(context);
  assert.ok(conversation.id !== undefined);
  await harness.close(context);
  await db.close();
  await assert.rejects(db.get('SELECT 1'), /closed/);
});

test('browser models list any registered provider and store keys; the access handler reads and sets the conversation\'s native model', async () => {
  const { openBrowserSqlite } = await import('@hachej/boring-browser/sqlite');
  const { openBrowserModels, createModelAccessHandler } = await import('@hachej/boring-browser/models');
  const { createProvider } = await import('@earendil-works/pi-ai/models');
  const model = (provider, id) => ({ id, name: `Model ${id}`, provider, api: 'fictional-api', baseUrl: 'https://fixture.invalid/v1', input: ['text'], reasoning: false, contextWindow: 8000, maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  const stream = () => { throw new Error('not called'); };
  const keyed = (id, ids) => createProvider({ id, name: id, models: ids.map(name => model(id, name)), auth: { apiKey: { name: 'key', resolve: async ({ credential }) => credential?.key ? { auth: { apiKey: credential.key } } : undefined } }, api: { stream, streamSimple: stream } });
  const free = createProvider({ id: 'local', name: 'Local keyless', models: [model('local', 'l1')], auth: { apiKey: { name: 'none', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } });
  const db = await openBrowserSqlite('/models.sqlite');
  const browser = await openBrowserModels({ db, providers: [keyed('one', ['a', 'b']), () => keyed('two', ['c', 'd']), free], defaultModels: { two: 'd' } });
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: browser.models }, context);
  try {
    const summary = async () => (await browser.catalog()).map(entry => [entry.id, entry.models.map(item => item.id).join(','), entry.auth.join('+'), entry.configured]);
    assert.deepEqual(await summary(), [['one', 'a,b', 'api_key', false], ['two', 'd,c', 'api_key', false], ['local', 'l1', 'api_key', true]], 'configured is pi-ai\'s own auth resolution; the preferred default is listed first');
    await assert.rejects(browser.saveApiKey('one', '  '), /empty/);
    await assert.rejects(browser.saveApiKey('unregistered', 'x'), /does not use an API key/);
    await assert.rejects(browser.loginDeviceCode('one', { onCode: () => {} }), /no sign-in/);

    const conversation = await harness.root(context, { agent: { model: { provider: 'one', modelId: 'a' } } });
    const access = createModelAccessHandler(browser, conversation, context, { prefix: '/api/model/' });
    const call = (method, path, body) => access(new Request(`https://page.invalid${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }));
    assert.equal(await call('GET', '/elsewhere'), undefined, 'other routes are left to the host');
    assert.equal(await call('DELETE', '/api/model'), undefined);
    const first = await (await call('GET', '/api/model')).json();
    assert.deepEqual([first.settings, first.providers.map(entry => entry.id), first.login], [{ provider: 'one', modelId: 'a' }, ['one', 'two', 'local'], { state: 'idle' }]);
    assert.equal((await call('PUT', '/api/model', { provider: 'nope' })).status, 400);
    assert.equal((await call('PUT', '/api/model', { provider: 'one', modelId: 'zzz' })).status, 400);
    assert.equal((await call('PUT', '/api/model', { provider: 'one', apiKey: '  ' })).status, 400);
    const saved = await (await call('PUT', '/api/model', { provider: 'two', apiKey: 'k2' })).json();
    assert.deepEqual(saved.settings, { provider: 'two', modelId: 'd' }, 'a new provider gets its default model');
    assert.equal(saved.providers.find(entry => entry.id === 'two').configured, true);
    assert.equal((await browser.models.getAuth('two')).auth.apiKey, 'k2');
    assert.deepEqual((await conversation.agent(context)).model, { provider: 'two', modelId: 'd' }, 'the model lives only in the conversation\'s native agent configuration');
    assert.equal((await call('POST', '/api/model/login', { provider: 'one' })).status, 400, 'no sign-in for a key-only provider');
    assert.equal((await call('POST', '/api/model/login', {})).status, 400);
    await browser.logout('two');
    assert.equal((await browser.catalog()).find(entry => entry.id === 'two').configured, false);
  } finally { await harness.close(context); await db.close(); }
});

test('browser SQLite reports a held database as a typed error that survives the worker boundary', async () => {
  const { BrowserSqliteLockedError, isBrowserSqliteLocked } = await import('@hachej/boring-browser/sqlite');
  const { serveRequests, connectWorker } = await import('@hachej/boring-browser/transport');
  const locked = new BrowserSqliteLockedError('boring-agent');
  assert.equal(locked.code, 'sqlite-locked');
  assert.match(locked.message, /already open in another tab/);
  assert.equal(isBrowserSqliteLocked(locked), true);
  assert.equal(isBrowserSqliteLocked(Object.assign(new Error('x'), { code: 'sqlite-locked' })), true);
  assert.equal(isBrowserSqliteLocked(new Error('x')), false);
  const { port1: page, port2: worker } = new MessageChannel();
  const stop = serveRequests(Promise.reject(locked), worker);
  try {
    const connection = connectWorker(page);
    await assert.rejects(connection.ready, error => error.code === 'sqlite-locked' && /already open in another tab/.test(error.message) && !/\n\s+at /.test(error.message));
  } finally { stop(); page.close(); worker.close(); }
});

test('browser build helpers bundle Node built-ins to shims, pi-codemode worker unchanged, and locate the QuickJS wasm', async () => {
  const { browserBundleOptions, codemodeWorkerEntry, quickjsWasm } = await import('@hachej/boring-browser/build');
  const { browserCodemode } = await import('@hachej/boring-browser/codemode');
  const { build } = await import('esbuild');
  assert.equal(typeof browserCodemode, 'function');
  const bytes = quickjsWasm();
  assert.deepEqual([...bytes.slice(0, 4)], [0, 0x61, 0x73, 0x6d], 'a WebAssembly module');
  const run = async (side, entry) => (await build({ ...browserBundleOptions(side), ...entry, outfile: 'out.js' })).outputFiles[0].text;
  const agent = await run('agent', { stdin: { contents: "import path from 'node:path'; import { randomUUID } from 'node:crypto'; import { Worker } from 'node:worker_threads'; import { gzipSync } from 'node:zlib'; globalThis.out = [path.join('a', '..', 'b'), randomUUID().length, typeof Worker, typeof gzipSync];", resolveDir: process.cwd() } });
  assert.ok(!/from "node:|require\("node:/.test(agent), 'no Node built-in is left in the bundle');
  assert.ok(/ieee754/.test(agent) && /\.Buffer\b/.test(agent), 'agent bundles inject the buffer package as the global Buffer');
  const plain = await run('agent', { stdin: { contents: "globalThis.out = [1, 2].map(function (fixtureValue) { return fixtureValue + 1; });", resolveDir: process.cwd() } });
  const minified = await (async () => (await build({ ...browserBundleOptions('agent', { minify: true }), stdin: { contents: "globalThis.out = [1, 2].map(function (fixtureValue) { return fixtureValue + 1; });", resolveDir: process.cwd() }, outfile: 'out.js' })).outputFiles[0].text)();
  assert.ok(/function ?\(fixtureValue\)/.test(plain) && minified.length < plain.length && !minified.includes('fixtureValue'), 'minify is opt-in and shrinks the bundle');
  const codemode = await run('codemode', { entryPoints: [codemodeWorkerEntry()] });
  assert.ok(!/from "node:|require\("node:/.test(codemode));
  assert.ok(/__workerData/.test(codemode) && /parentPort/.test(codemode), 'upstream worker is bundled behind the worker_threads shim');
});

