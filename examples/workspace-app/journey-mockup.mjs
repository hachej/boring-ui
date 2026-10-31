// Port of the canvas spike's mock-up, theme and hostile-frame probes, now through the built-in artifact kind and real feedback session.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const { misses } = await import('../../lab/studio/scripted-model.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/feat-mockup-html-kind';
mkdirSync(evidence, { recursive: true });
const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-mockup-')) });
const INPUT = q('[data-testid=composer-input]');
const FRAME = q('[data-testid=mockup-run-frame]');
let browser;
try {
  browser = await launch(`${insecureUrl(app.url)}`, { evidence });
  const inside = expression => browser.frameEvaluate(FRAME, expression);
  const send = async text => { await browser.type(INPUT, text); await browser.click(q('[data-testid=composer-submit]')); };
  const ready = async () => { await browser.until('mock-up frame', `!!${FRAME}`, 30000); await pause(600); };
  await browser.until('chat live', `!!${INPUT} && !${INPUT}.disabled`, 30000);
  // Present at desktop, then enter the phone sheet before interacting with the mock-up.
  await send('Make the booking HTML and present it.');
  await ready();
  assert.equal(await browser.evaluate(`${FRAME}.getAttribute('sandbox')`), 'allow-scripts');
  assert.equal(await browser.evaluate(`${FRAME}.getAttribute('allow')`), '');
  assert.equal(await browser.evaluate(`${FRAME}.contentDocument`), null, 'the host cannot read the frame');
  assert.equal(await browser.evaluate(`${q('[data-testid=artifact-panel-type]')}.textContent`), 'HTML mock-up');
  await browser.emulate('phone');
  await pause(400);
  if (!(await browser.evaluate(`!!${FRAME}`))) await browser.tap(qa('[data-testid=artifact-card][data-state=ready]') + '.at(-1)');
  await ready();
  await inside(`document.getElementById('toggle').click()`);
  assert.equal(await inside(`document.getElementById('reminder-state').textContent`), 'Off', 'the artifact script runs only in its frame');

  for (const size of ['phone-390', 'desktop-1440']) {
    if (size.startsWith('desktop')) {
      await browser.emulate('desktop');
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await ready();
    }
    for (const scheme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await pause(400);
      const host = await browser.evaluate(`getComputedStyle(${q('[data-boring=mockup-viewer]')}).getPropertyValue('--primary').trim()`);
      const actual = await inside(`getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()`);
      assert.ok(host.length, 'the host defines its theme');
      assert.equal(actual, host, `${size} ${scheme}: host theme inside the frame`);
      assert.equal(await inside(`document.getElementById('reminder-state').textContent`), 'Off', 'theme changes do not restart artifact scripts');
      const style = await inside(`({ color: getComputedStyle(document.getElementById('calendar')).backgroundColor, width: document.documentElement.scrollWidth, viewport: innerWidth })`);
      assert.notEqual(style.color, 'rgba(0, 0, 0, 0)', 'Tailwind bg-primary was compiled');
      assert.ok(style.width <= style.viewport, 'mock-up has no horizontal overflow');
      assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'host has no horizontal overflow');
      await browser.screenshot(`${size}-${scheme}-mockup.png`);
    }
    if (size.startsWith('phone')) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
      await pause(300);
      assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'host has no overflow at 360px');
      assert.ok(await inside('document.documentElement.scrollWidth <= innerWidth'), 'mock-up has no overflow at 360px');
    }
  }
  await send('Show the sandbox probe');
  await ready();
  await pause(800);
  const hostile = JSON.parse(await inside('document.getElementById("out").textContent'));
  assert.equal(hostile.origin, 'null');
  for (const name of ['parentDocument', 'topLocation', 'cookie', 'localStorage', 'indexedDB']) assert.match(hostile[name], /^blocked: SecurityError$/, name);
  assert.match(hostile.fetchHost, /^blocked:/);
  assert.equal(hostile.externalImage, 'blocked');
  await inside(`(() => { location.href = 'https://example.com/'; return true; })()`);
  await pause(300);
  const location = await inside('location.href').catch(() => 'blocked');
  assert.notEqual(location, 'https://example.com/', 'host frame-src prevents self-navigation');
  writeFileSync(join(evidence, 'hostile.json'), JSON.stringify(hostile, null, 2));
  assert.deepEqual(misses, []);
  assert.deepEqual(browser.problems, []);
  console.log(`PASS HTML mock-up journey; screenshots in ${evidence}`);
} finally {
  await browser?.screenshot('last-state.png');
  await browser?.close();
  await app.close();
}
