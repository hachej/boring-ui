// The public demo's journey against a running Worker: the accounts-payable flow through the real UI (scripted model), then the abuse limits
// over HTTP: sessions are separate objects that never see each other's files or decisions, an oversized or unsized body is refused, the
// per-session message limit answers 429, and an idle session's data is deleted. Screenshots (desktop 1440 and phone 390, light and dark,
// stock and brand theme) go to .cache/evidence/demo-worker/.
//   DEMO_URL=https://demo.senecaapp.ai CHROMIUM=<binary> node demos/workspace/cloudflare/journey.mjs   # a running Worker (skips the expiry proof)
//   CHROMIUM=<binary> node demos/workspace/cloudflare/journey.mjs                                       # starts `wrangler dev --local` itself
// Build first: npm run workspace-demo:cloudflare:build. Fictional content only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insecureUrl, launch, pause, q } from '@hachej/boring-testing/browser';
import { connectRevisionProvider } from '@hachej/boring-files/revision';

const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/demo-worker';
mkdirSync(evidence, { recursive: true });
const config = fileURLToPath(new URL('./wrangler.jsonc', import.meta.url));
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const freePort = () => new Promise(resolve => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
/** `wrangler dev --local` on a free port with these vars; resolves once it answers. Its state lives in a fresh temporary folder. */
async function startWorker(vars = {}) {
  const port = await freePort();
  const child = spawn('npx', ['wrangler', 'dev', '--local', '--config', config, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(await freePort()),
    '--persist-to', mkdtempSync(join(tmpdir(), 'demo-worker-state-')), ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`])],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited ${child.exitCode}\n${log}`);
    try { if ((await fetch(url)).ok) return { url, log: () => log, stop: () => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }) }; } catch { /* not up yet */ }
    await pause(500);
  }
  child.kill('SIGKILL');
  throw new Error(`wrangler dev did not answer\n${log}`);
}

/** A visitor's session over HTTP: the cookie from /api/session.js, sent with every call. */
async function visitor(base) {
  const response = await fetch(new URL('/api/session.js', base));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^demo_session=[0-9a-f]{32}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+/);
  const app = JSON.parse(/^window\.__APP__=(.*);$/.exec(await response.text())[1]);
  assert.equal(app.token, null, 'no bearer token reaches the page');
  const call = (path, init = {}) => fetch(new URL(path, base), { ...init, headers: { ...init.headers, cookie: cookie.split(';')[0] } });
  // A revision provider is bound to the workspace incarnation it first saw: a deleted and reseeded session refuses the old binding.
  const connect = () => connectRevisionProvider({ endpoint: new URL('/api/resources', base), fetch: request => { const headers = new Headers(request.headers); headers.set('cookie', cookie.split(';')[0]); return fetch(new Request(request, { headers })); } });
  const files = await connect();
  const pathsOf = provider => async directory => (await provider.list(directory ? { directory } : {})).entries.map(entry => entry.path);
  const invoice = async id => (await (await call('/api/ap/state')).json()).invoices.find(item => item.id === id);
  return { app, call, files, paths: pathsOf(files), invoice, reconnect: async () => pathsOf(await connect()) };
}

const write = (files, path, content) => files.publish({ operationId: `journey-${path}-${Date.now()}`, atomicity: 'all-or-nothing',
  changes: [{ kind: 'create', target: files.locate(path), expected: { kind: 'absent' }, bytes: new TextEncoder().encode(content), mediaType: 'text/markdown' }] });

const local = !process.env.DEMO_URL;
const worker = local ? await startWorker() : { url: process.env.DEMO_URL, stop: async () => {} };
const base = worker.url;
let browser;
try {
  await step('static files and the session gate', async () => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<script src="\/api\/session\.js"><\/script>/);
    const pdfWorker = await fetch(new URL('/pdfjs-dist/build/pdf.worker.min.mjs', base));
    assert.equal(pdfWorker.status, 200, 'pdf.js worker is a static asset');
    assert.match(pdfWorker.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(new URL('/__test/brand.css', base))).status, 200, 'the brand theme preview is a static asset');
    for (const path of ['/api/ap/state', '/api/conversations', '/api/resources', '/api/transcribe']) assert.equal((await fetch(new URL(path, base))).status, 401, `${path} needs a session`);
  });

  await step('two sessions are two objects: files and decisions never cross', async () => {
    const [a, b] = [await visitor(base), await visitor(base)];
    assert.equal((await write(a.files, 'only-a.md', '# Only A\n')).kind, 'committed');
    assert.ok((await a.paths()).includes('only-a.md'));
    assert.ok(!(await b.paths()).includes('only-a.md'), 'B does not see A\'s file');
    assert.ok((await b.paths('Policies')).includes('Policies/AP policy.md'), 'B has its own seeded Library');
    const pending = await a.invoice('INV-2044');
    const decided = await (await a.call('/api/ap/actions/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoice: 'INV-2044', expected: pending.revision }) })).json();
    assert.equal(decided.kind, 'committed');
    assert.equal((await a.invoice('INV-2044')).status, 'approved');
    assert.equal((await b.invoice('INV-2044')).status, 'pending', 'B\'s invoices are its own');
    assert.equal((await fetch(new URL('/api/ap/state', base), { headers: { cookie: 'demo_session=../../etc' } })).status, 401, 'a malformed session id is no session');
  });

  await step('an oversized or unsized body is refused before the object', async () => {
    const a = await visitor(base);
    const big = JSON.stringify({ requestId: 'too-big', padding: 'x'.repeat(2 * 1024 * 1024) });
    const refused = await a.call('/api/resources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
    assert.equal(refused.status, 413);
    assert.equal((await refused.json()).reason, 'request-too-large');
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); } });
    assert.equal((await a.call('/api/resources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' })).status, 411);
    assert.ok(!(await a.paths()).some(path => path.includes('too-big')));
  });

  await step('the per-session message limit answers 429, and only for that session', async () => {
    const c = await visitor(base), d = await visitor(base);
    const submit = session => session.call(`/api/chat?conversation=${session.app.conversation}&op=submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    let status, count = 0;
    while ((status = (await submit(c)).status) !== 429 && count < 200) count++;
    assert.equal(status, 429, 'the limit answered');
    assert.equal(count, 30, 'after 30 messages in the window');
    assert.notEqual((await submit(d)).status, 429, 'another session is not limited');
  });

  await step('browser: the accounts-payable journey on the Worker', async () => {
    browser = await launch(insecureUrl(base), { evidence });
    const INPUT = q('[data-testid=composer-input]');
    const placement = `${q('[data-dock=chat]')}?.dataset.placement`;
    const viewing = `${q('[data-testid=viewing]')}?.textContent`;
    const body = 'document.body.innerText';
    const say = async text => { await browser.until('the composer', `!!${INPUT}`, 30000); await browser.type(INPUT, text); await browser.press('Enter'); };
    const sees = (label, text, timeout = 30000) => browser.until(label, `${body}.includes(${JSON.stringify(text)})`, timeout);
    const dockAgent = async () => {
      const now = await browser.evaluate(placement);
      if (now === 'floating') await browser.click(q('[data-testid=ambient-dock]'));
      else if (now === 'page') await browser.click(q('[data-testid=chat-action-dock]'));
      await browser.until('docked', `${placement} === 'docked'`, 10000);
    };
    const schemes = async name => {
      await browser.evaluate('document.activeElement?.blur()');
      for (const scheme of ['light', 'dark']) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await pause(400);
        await browser.screenshot(`${name}-${scheme}.png`);
      }
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    };
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.until('the chat is live', `!!${INPUT} && ${placement} === 'page'`, 60000);
    await browser.until('the earlier conversations are seeded', `!!${q('[data-testid=chat-action-history]')}`, 10000);
    await schemes('desktop-1-agent');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await browser.evaluate('location.reload()');
    await pause(1000);
    await browser.until('the phone Agent page', `!!${INPUT} && ${placement} === 'page' && innerWidth === 390`, 30000);
    await schemes('phone-0-agent');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('location.reload()');
    await pause(1000);
    await browser.until('the desktop Agent page again', `!!${INPUT} && ${placement} === 'page' && innerWidth === 1440`, 30000);

    await say('Hello, what needs my approval this week?');
    await sees('the answer', 'I opened the queue in the viewer.');
    await browser.until('the queue is on show', `${viewing} === 'Approvals' && document.querySelectorAll('[data-testid^=queue-row-]').length === 3`, 15000);
    await browser.until('show gave the main area to the app and floated the agent', `${placement} === 'floating'`, 10000);
    await dockAgent();
    await schemes('desktop-2-approvals');

    await browser.click(q('[data-testid=queue-row-INV-2041]'));
    await browser.until('the invoice', `${viewing} === 'Invoice INV-2041' && /1,284\\.00/.test(${q('[data-testid=invoice-summary]')}?.innerText ?? '')`, 15000);
    await browser.until('the invoice PDF drawn (pdf.js worker from the static assets)', `!!${q('[data-testid=invoice-pdf] [data-pdf]')}`, 20000);
    await pause(1200);
    await schemes('desktop-3-invoice');

    await browser.until('a duplicate alert on INV-2041', `!!${q('[data-testid=duplicate-alert]')}`, 5000);
    await browser.click(`[...document.querySelectorAll('[data-testid=duplicate-alert] button')].find(item => item.textContent === 'INV-2043')`);
    await browser.until('INV-2043 open', `${viewing} === 'Invoice INV-2043'`, 10000);
    await say('Anything odd about this one?');
    await sees('the duplicate is named', 'INV-2043 looks like a duplicate of INV-2041');

    await browser.click(q('[data-testid=chat-action-library]'));
    await browser.until('the Library tree', `!!${q('[role=treeitem][data-path="Policies"]')}`, 15000);
    await browser.click(q('[role=treeitem][data-path="Policies"]'));
    await browser.until('the policy in the tree', `!!${q('[role=treeitem][data-path="Policies/AP policy.md"]')}`, 15000);
    await browser.click(q('[role=treeitem][data-path="Policies/AP policy.md"]'));
    await browser.until('the policy in the agent viewer', `${q('[data-testid=library-document]')}?.innerText.includes('Approval limits')`, 15000);
    await say('Does this invoice respect the policy?');
    await sees('the answer cites the policy and the invoice', 'No. Section 2 of the policy holds an invoice');
    await schemes('desktop-4-policy');
    await browser.click(q('[data-testid=library-document] [data-testid=viewer-close]'));
    await browser.until('the viewer closed', `!${q('[data-testid=library-document]')}`, 5000);

    await browser.click(q('[data-testid=nav-approvals]'));
    await browser.until('Approvals', `${viewing} === 'Approvals'`, 5000);
    await say('What would you do with them?');
    await browser.until('the approval card', `${q('[data-testid=approval-card]')}?.dataset.state === 'pending'`, 30000);
    assert.equal(await browser.evaluate(`${q('[data-testid=approval-summary]')}.innerText`), 'Approve INV-2041 coded to 6300 Marketing');
    await schemes('desktop-5-approval');
    await browser.click(q('[data-testid=approval-approve]'));
    await sees('the receipt in the answer', 'Done: INV-2041 is approved and coded to 6300 Marketing. Receipt decide-');
    await browser.until('INV-2041 approved on the page', `${viewing} === 'Invoice INV-2041' && ${q('[data-testid=invoice-status]')}?.textContent === 'approved' && ${q('[data-testid=invoice-account]')}?.textContent === '6300 Marketing'`, 15000);
    await dockAgent();

    const note = join(mkdtempSync(join(tmpdir(), 'demo-worker-note-')), 'vendor-note.txt');
    writeFileSync(note, 'Linden Print asks for payment by the 3rd.\n');
    await browser.attachFiles(q('[data-testid=composer-file]'), [note]);
    await browser.until('the upload is saved and attached', `/^uploads\\/vendor-note.*\\.txt$/.test(${q('[data-testid=mention-chip]')}?.dataset.path ?? '')`, 15000);
    await say('Please look at the attached note.');
    await sees('the agent read it', 'Read it: Linden Print asks for payment by the 3rd.');

    await say('Can you create a new file tt.md and open it?');
    await sees('the answer', 'I created tt.md in the workspace and opened it in the viewer.');
    await browser.until('tt.md open in the agent viewer', `${q('[data-dock=chat] [data-testid=library-document]')}?.dataset.path === 'tt.md' && ${q('[data-testid=library-document]')}.innerText.includes('INV-2043 duplicates INV-2041')`, 15000);
    await schemes('desktop-6-agent-file');

    // The browser's session is its own: a fresh HTTP visitor sees none of it.
    const other = await visitor(base);
    assert.ok(!(await other.paths()).includes('tt.md'), 'another session does not see the browser session\'s file');
    assert.equal((await other.invoice('INV-2041')).status, 'pending', 'nor its decision');

    // Brand theme and phone width, after a reload of the same session (the conversation is kept).
    await browser.evaluate(`location.href = ${JSON.stringify(new URL('/?theme=brand', insecureUrl(base)).href)}`);
    await browser.until('brand theme loaded', `[...document.styleSheets].some(sheet => sheet.href?.endsWith('/__test/brand.css'))`, 30000);
    await browser.until('the same conversation after reload', `!!${INPUT} && ${body}.includes('I created tt.md in the workspace')`, 30000);
    await schemes('desktop-7-brand');
    await browser.evaluate(`location.href = ${JSON.stringify(insecureUrl(base))}`);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await browser.until('phone page (the placement the session left: floating)', `!!${INPUT} && innerWidth === 390 && !!${placement}`, 30000);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal scroll on the phone');
    await schemes('phone-1-agent');
    await browser.evaluate(`location.href = ${JSON.stringify(new URL('/?theme=brand', insecureUrl(base)).href)}`);
    await browser.until('phone brand page', `!!${INPUT} && [...document.styleSheets].some(sheet => sheet.href?.endsWith('/__test/brand.css'))`, 30000);
    await schemes('phone-2-brand');
    assert.deepEqual(browser.problems.filter(problem => !/favicon/.test(problem)), [], 'no page errors');
  });
} finally {
  await browser?.close();
  await worker.stop();
}

if (local) {
  await step('an idle session is deleted: its files go, the next visit starts fresh', async () => {
    const short = await startWorker({ DEMO_IDLE_MS: 3000 });
    try {
      const a = await visitor(short.url);
      assert.equal((await write(a.files, 'expires.md', '# Gone soon\n')).kind, 'committed');
      assert.ok((await a.paths()).includes('expires.md'));
      await pause(9000);
      await assert.rejects(a.paths(), /no longer authorized/, 'the old workspace is gone: its binding is refused');
      const paths = await a.reconnect();
      const after = await paths();
      assert.ok(!after.includes('expires.md'), `the idle session's file was deleted: ${after}`);
      assert.ok((await paths('Policies')).includes('Policies/AP policy.md'), 'the same cookie gets a freshly seeded session');
    } finally { await short.stop(); }
  });
}
console.log(`Screenshots in ${evidence}`);
