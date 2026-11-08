import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { surfacePage } from '../fixtures/feedback-surface/page.mjs';

// D-1899: a note pinned to a point on a surface (an image the host draws its own marks on). A real Chromium clicks the image in comment
// mode: the note carries the point as fractions of the image, no element is picked there, and with pins "host" the session draws no pinned
// box. Enter on the focused surface drops a note at its centre. In CI a missing browser fails the test; it never skips.
const root = fileURLToPath(new URL('../../', import.meta.url));

test('a click on a surface pins a note at that point; pins "host" draws no box; Enter drops it at the centre', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/feedback-surface-'));
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/feedback-surface/entry.mjs')], bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  const js = bundle.outputFiles[0].text;
  const plate = readFileSync(join(root, 'test/fixtures/feedback-surface/plate.svg'));
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path === '/entry.js' ? 'text/javascript' : path === '/plate.svg' ? 'image/svg+xml' : 'text/html');
    res.end(path === '/entry.js' ? js : path === '/plate.svg' ? plate : surfacePage());
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: work });
  try {
    // Pinned boxes the session drew, through every overlay's shadow root.
    const boxes = () => browser.evaluate(`[...document.querySelectorAll('[data-feedback-overlay]')].flatMap(host => [...host.shadowRoot.querySelectorAll('.box[data-tone="pinned"]')]).length`);
    const frames = () => browser.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
    const clickAt = async (fx, fy) => {
      const at = await browser.evaluate(`(() => { const r = document.getElementById('plate').getBoundingClientRect(); return { x: r.left + ${fx} * r.width, y: r.top + ${fy} * r.height }; })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    };
    const open = async pins => {
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?pins=${pins}` });
      await browser.until('the fixture loads', `document.getElementById('plate')?.complete && window.fixture`);
      await browser.evaluate('window.fixture.session.start()');
      await browser.until('comment mode is on', `window.fixture.session.getSnapshot().phase === 'active'`);
    };

    // pins "host": the click lands a note at (0.25, 0.75), no element picking, no kit box.
    await open('host');
    await clickAt(0.25, 0.75);
    await browser.until('the bubble opens', `window.fixture.session.getSnapshot().bubble`);
    assert.deepEqual(await browser.evaluate('window.fixture.points'), [{ x: 0.25, y: 0.75 }], 'onPoint got the point as fractions of the surface');
    await browser.evaluate(`window.fixture.session.setBubbleText('Chip on the rim'); window.fixture.session.saveBubble()`);
    const kept = await browser.evaluate('window.fixture.session.getSnapshot().notes');
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].point, { x: 0.25, y: 0.75 }, 'the note carries the point');
    assert.equal(kept[0].text, 'Chip on the rim');
    await frames();
    assert.equal(await boxes(), 0, 'pins "host": the session draws no pinned box on the surface');

    // Enter on the focused surface: a second note at the centre.
    await browser.evaluate(`document.getElementById('plate').focus()`);
    await browser.press('Enter');
    await browser.until('a second bubble', `window.fixture.session.getSnapshot().bubble?.number === 2`);
    assert.deepEqual(await browser.evaluate('window.fixture.points.at(-1)'), { x: 0.5, y: 0.5 }, 'Enter drops the note at the centre');
    await browser.press('Escape');
    assert.equal(await browser.evaluate('window.fixture.session.getSnapshot().bubble === undefined'), true, 'Escape closes the new bubble');

    // pins "kit" (the default): the same click draws the kit's box, so the host case above is not vacuous.
    await open('kit');
    await clickAt(0.25, 0.75);
    await browser.until('the bubble opens', `window.fixture.session.getSnapshot().bubble`);
    await frames();
    assert.deepEqual(await browser.evaluate('window.fixture.points'), [{ x: 0.25, y: 0.75 }]);
    assert.ok(await boxes() >= 1, 'pins "kit": the session draws its pinned box');
    assert.deepEqual(browser.problems, []);
  } finally {
    await browser.close();
    server.close();
  }
});
