// Drives the live slice in a real headless Chromium over the DevTools protocol (no extra dependency).
// Needs a provider key (OPENAI_API_KEY by default) and CHROMIUM pointing at a Chromium/headless-shell binary.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLiveSlice } from './server.mjs';

const chromium = process.env.CHROMIUM;
if (!chromium) throw new Error('Set CHROMIUM to a Chromium or chrome-headless-shell binary');
const evidence = process.env.SLICE_EVIDENCE ?? '.cache/evidence/live-slice';
mkdirSync(evidence, { recursive: true });

async function launch(url) {
  const profile = mkdtempSync(join(tmpdir(), 'boring-slice-profile-'));
  const child = spawn(chromium, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    child.stderr.on('data', chunk => { text += chunk; const found = /DevTools listening on (ws:\/\/\S+)/.exec(text); if (found) resolve(found[1]); });
    child.once('exit', code => reject(new Error(`Chromium exited ${code}\n${text}`)));
    setTimeout(() => reject(new Error(`Chromium did not start\n${text}`)), 20000);
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const waiting = new Map(), problems = [];
  let sessionId;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id); waiting.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') problems.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(`console.error: ${message.params.args.map(arg => arg.value ?? arg.description).join(' ')}`);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const until = async (label, expression, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await evaluate(expression).catch(() => undefined);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}\n${await evaluate('document.body.innerText').catch(() => '')}\n${problems.join('\n')}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  };
  // Real pointer and keyboard input through the browser, not synthetic DOM events.
  const click = async selector => {
    const box = await until(`visible ${selector}`, `(() => { const e = ${selector}; if (!e || e.disabled) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const type = async (selector, text) => { await click(selector); await evaluate(`(() => { const e = ${selector}; e.focus(); e.selectionStart = e.selectionEnd = e.value.length; })()`); await send('Input.insertText', { text }); };
  const screenshot = async name => writeFileSync(join(evidence, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  return { evaluate, until, click, type, screenshot, problems, reload: () => send('Page.reload'),
    close: async () => { socket.close(); child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); rmSync(profile, { recursive: true, force: true }); } };
}

const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const SOURCE = `document.querySelector('textarea[aria-label="Fictional notes Markdown source"]')`;
const MESSAGE = `document.querySelector('textarea[aria-label="Message"]')`;
const steps = [];
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const app = await startLiveSlice();
const savedText = async () => {
  const read = await app.resources.read({ target: app.target, revision: { kind: 'latest' } }, app.agent);
  return read.kind === 'available' ? new TextDecoder().decode(read.snapshot.bytes) : null;
};
let browser;
try {
  browser = await launch(app.url);
  await step('page connects to the projection stream', async () => {
    await browser.until('connected', `document.querySelector('[role=status]')?.textContent.includes('connected')`);
    await browser.until('empty document', `!!document.querySelector('[data-testid=no-document]')`);
  });
  await step('real model creates the document through the native tool', async () => {
    await browser.type(MESSAGE, 'Create the document: a fictional packing list titled "Moon picnic" with exactly three bullet items.');
    await browser.click(button('Send'));
    await browser.until('document in editor', `${SOURCE}?.value.includes('Moon picnic')`, 180000);
    await browser.until('assistant reply', `!!document.querySelector('[data-role=assistant]')?.textContent.trim()`, 60000);
    assert.match(await savedText(), /Moon picnic/);
  });
  await browser.screenshot('1-created.png');
  await step('human edits and saves in the browser', async () => {
    await browser.type(SOURCE, '\n- HUMAN-ADDED thermos\n');
    await browser.click(button('Save'));
    const deadline = Date.now() + 15000;
    while (!(await savedText()).includes('HUMAN-ADDED thermos')) { assert.ok(Date.now() < deadline, 'human save did not reach the provider'); await new Promise(resolve => setTimeout(resolve, 100)); }
    await browser.until('clean editor', `${button('Save')}?.disabled === true`);
  });
  await step('real model revises against the human revision without losing it', async () => {
    await browser.type(MESSAGE, 'Add one more bullet item "star map" to the list. Keep everything else exactly.');
    await browser.click(button('Send'));
    await browser.until('revised document in editor', `/star map/i.test(${SOURCE}?.value ?? '')`, 180000);
    const text = await savedText();
    assert.match(text, /star map/i); assert.match(text, /HUMAN-ADDED thermos/);
    assert.match(await browser.evaluate(`${SOURCE}.value`), /HUMAN-ADDED thermos/);
  });
  await browser.screenshot('2-revised.png');
  await step('reload restores transcript and document from the server', async () => {
    await browser.reload();
    await browser.until('document after reload', `/star map/i.test(${SOURCE}?.value ?? '')`);
    assert.ok(await browser.evaluate(`document.querySelectorAll('[data-role=user]').length`) >= 2);
  });
  assert.deepEqual(browser.problems, []);
  const summary = { model: `${app.provider}/${app.modelId}`, steps, finalDocument: await savedText() };
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (browser) await browser.close();
  await app.close();
}
