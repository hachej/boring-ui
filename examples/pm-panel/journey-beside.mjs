// The PM beside the app: a cross-origin host page frames `?pm=standalone` next to the app. Montrer in the PM frame points in the app frame, the
// pin comes back as a chip, and the send is one native submission. The host's tokens reach only the PM frame, and only from an allowlisted origin.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.cache/evidence/pm-one/beside';
mkdirSync(evidence, { recursive: true });
const app = await startPmPanel({ oneLine: true });
const appOrigin = new URL(app.url).origin;
const tokens = { '--primary': 'rgb(200, 30, 90)', '--background': 'url(https://example.invalid/x)', '--evil': 'red' };
const hostPage = hosts => `<!doctype html><title>Fictional host</title><body style="margin:0;display:flex;height:100vh;background:#223">
<iframe id="pm" title="PM" style="width:420px;border:0" src="${app.url}?pm=standalone&pmHosts=${encodeURIComponent(hosts)}"></iframe>
<iframe id="app" title="App" style="width:360px;height:720px;border:0;margin:auto" src="${app.url}"></iframe>
<script>addEventListener('message', event => { if (event.data?.boring === 'pm-ready') event.source.postMessage({ boring: 'pm-theme', theme: 'dark', tokens: ${JSON.stringify(tokens)} }, event.origin); });</script>`;
let allowed = '';
const host = createServer((_, response) => { response.setHeader('content-type', 'text/html'); response.end(hostPage(allowed)); });
await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
const hostUrl = `http://127.0.0.1:${host.address().port}/`;
assert.notEqual(new URL(hostUrl).origin, appOrigin, 'the host must be cross-origin to the app');

let browser;
/** Evaluates in a frame's isolated world (the same DOM), found by whether its address asks for the standalone PM. */
const inFrame = async (which, expression) => {
  const { frameTree } = await browser.send('Page.getFrameTree');
  const frame = frameTree.childFrames?.find(child => child.frame.url.includes('pm=standalone') === (which === 'pm'))?.frame;
  assert.ok(frame, `${which} frame`);
  const { executionContextId } = await browser.send('Page.createIsolatedWorld', { frameId: frame.id });
  const { result, exceptionDetails } = await browser.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(`${which}: ${JSON.stringify(exceptionDetails).slice(0, 500)}`);
  return result.value;
};
const until = async (which, label, expression, timeout = 15000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await inFrame(which, expression).catch(() => false)) return;
    if (Date.now() > end) { await browser.screenshot(`timeout-${label.replace(/\W+/g, '-')}.png`); throw new Error(`Timed out: ${which}: ${label}`); }
    await pause(100);
  }
};
/** A real mouse click at the element's centre, in the top page's coordinates. */
const click = async (which, selector) => {
  const inner = await inFrame(which, `(() => { const r = ${q(selector)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const box = await browser.evaluate(`(() => { const r = document.getElementById('${which}').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
  const at = { x: inner.x + box.x, y: inner.y + box.y };
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...at });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...at });
};
const primary = `getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()`;

try {
  browser = await launch('about:blank', { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // A host that is not on the list gets no style.
  await browser.send('Page.navigate', { url: hostUrl });
  await until('pm', 'standalone PM', `!!${q('[data-testid=pm-standalone]')} && !!${q('[data-testid=composer-input]')}`, 30000);
  await pause(500);
  assert.notEqual(await inFrame('pm', primary), tokens['--primary'], 'an unlisted parent must not style the PM');

  allowed = new URL(hostUrl).origin;
  await browser.send('Page.navigate', { url: hostUrl });
  await until('pm', 'standalone PM', `!!${q('[data-testid=composer-input]')} && !${q('[data-testid=composer-input]')}.disabled`, 30000);
  await until('app', 'app card', `!!${q('[data-testid=card-a]')}`);
  await until('pm', 'host tokens', `${primary} === ${JSON.stringify(tokens['--primary'])}`);
  assert.equal(await inFrame('pm', `document.documentElement.classList.contains('dark')`), true, 'host theme');
  assert.notEqual(await inFrame('pm', `getComputedStyle(document.documentElement).getPropertyValue('--background').trim()`), tokens['--background'], 'a token that loads a resource is refused');
  assert.equal(await inFrame('pm', `getComputedStyle(document.documentElement).getPropertyValue('--evil').trim()`), '', 'an unknown token is refused');
  assert.notEqual(await inFrame('app', primary), tokens['--primary'], 'the app frame keeps its own look');
  for (const icon of ['tasks', 'history', 'library', 'new']) assert.ok(await inFrame('pm', `!!${q(`[data-testid=workspace-bar-${icon}]`)}`) || icon === 'tasks', `icon ${icon}`);
  assert.equal(await inFrame('pm', `!!${q('[data-testid=app-shell]')}`), false, 'standalone shows no shell');
  await browser.screenshot('beside-ready.png');

  await until('pm', 'Montrer enabled', `!!${q('[data-testid=pm-show]')} && !${q('[data-testid=pm-show]')}.disabled`);
  await click('pm', '[data-testid=pm-show]');
  await until('pm', 'point strip', `!!${q('[data-testid=pm-strip]')}`);
  await click('app', '[data-testid=card-a]');
  await until('pm', 'chip beside', `!!${q('[data-testid=pm-beside-chips]')} && ${q('[data-testid=pm-beside-chips]')}.innerText.length > 0`);
  await browser.screenshot('beside-pin.png');
  await click('pm', '[data-testid=pm-done]');
  await until('pm', 'review chip', `!!${q('[data-testid=pm-chip]')}`);
  await until('pm', 'send enabled', `!${q('[data-testid=composer-submit]')}.disabled`);
  const before = app.submits.length;
  await click('pm', '[data-testid=composer-submit]');
  await until('pm', 'sent pin', `!!${q('[data-testid=pm-sent-message]')}`, 12000);
  assert.equal(app.submits.length, before + 1, 'one native submission');
  const sent = JSON.stringify(app.submits.at(-1).body);
  assert.match(sent, /pm\.points@1/);
  assert.match(sent, /image\/png/);
  const chip = await inFrame('pm', `(() => { const c = ${q('[data-testid=pm-inline-selection]')}, s = getComputedStyle(c); return [s.color, s.backgroundColor]; })()`);
  assert.notEqual(chip[0], chip[1], `a sent pin is readable: ${chip}`);
  await browser.screenshot('beside-sent.png');
  assert.deepEqual(browser.problems, []);
  console.log('PASS: PM frame beside app frame, pointing across frames, one native submission, host tokens allowlisted');
} catch (error) {
  await browser?.screenshot('failure.png');
  throw error;
} finally { await browser?.close(); await app.close(); host.close(); }
