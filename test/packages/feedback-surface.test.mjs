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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/feedback-surface/entry.mjs')], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': join(root, 'examples/app-shell') }, define: { 'process.env.NODE_ENV': '"production"' } });
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
    const open = async (pins, extra = '') => {
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?pins=${pins}${extra}` });
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

    // Send keeps the point: click, save the note, Done, Send. The saved draft, the report text and its strict parse all hold it, and
    // the save route's own request check accepts it.
    await open('host');
    await clickAt(0.25, 0.75);
    await browser.until('the bubble opens', `window.fixture.session.getSnapshot().bubble`);
    await browser.evaluate(`window.fixture.session.setBubbleText('Chip on the rim'); window.fixture.session.saveBubble()`);
    await browser.evaluate('window.fixture.session.done()');
    await browser.until('the review is open', `window.fixture.session.getSnapshot().phase === 'review'`);
    const attached = await browser.evaluate('window.fixture.session.attach()');
    assert.equal(attached.kind, 'inline', 'no mention route: the report text goes in the message');
    assert.match(attached.text, /\[point 0\.25,0\.75\] Chip on the rim/, 'the sent report text holds the point');
    const sent = await browser.evaluate('window.fixture.saved');
    assert.equal(sent.length, 1, 'Send saved once');
    assert.deepEqual(sent[0].draft.notes[0].point, { x: 0.25, y: 0.75 }, 'the saved draft holds the point');
    const checked = await browser.evaluate('window.fixture.checkSent()');
    assert.equal(checked.accepted, true, `the save route accepts a note with a point: ${checked.reason}`);
    assert.equal(checked.parsed, true, `the report parses back strictly: ${JSON.stringify(checked.notes)}`);
    assert.deepEqual(checked.notes[0].point, { x: 0.25, y: 0.75 }, 'the parsed report holds the point');

    // Touch: a tap pins a note; a drag, a drag that comes back and a cancelled gesture do not (the picker's tap slop, no pointercancel).
    const plateAt = (fx, fy) => browser.evaluate(`(() => { const r = document.getElementById('plate').getBoundingClientRect(); return { x: r.left + ${fx} * r.width, y: r.top + ${fy} * r.height }; })()`);
    const finger = (type, at) => browser.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: at.x, y: at.y }] });
    const noNote = async why => {
      await frames();
      assert.deepEqual(await browser.evaluate('({ notes: window.fixture.session.getSnapshot().notes.length, bubble: window.fixture.session.getSnapshot().bubble === undefined, points: window.fixture.points.length })'), { notes: 0, bubble: true, points: 0 }, why);
    };
    await open('host');
    const start = await plateAt(0.25, 0.75);
    await finger('touchStart', start);
    await finger('touchMove', { x: start.x + 40, y: start.y + 30 });
    await finger('touchEnd', start);
    await noNote('a drag across the surface is not a tap: no note');
    await finger('touchStart', start);
    await finger('touchMove', { x: start.x + 40, y: start.y });
    await finger('touchMove', start);
    await finger('touchEnd', start);
    await noNote('a drag that came back to where it started is still a drag: no note');
    await finger('touchStart', start);
    await finger('touchCancel', start);
    await noNote('a cancelled gesture is no tap: no note');
    await finger('touchStart', start);
    await finger('touchMove', { x: start.x + 4, y: start.y + 3 });
    await finger('touchEnd', start);
    await browser.until('a tap within the slop opens a note', `window.fixture.session.getSnapshot().bubble`);
    assert.equal(await browser.evaluate('window.fixture.points.length'), 1, 'one tap, one note');
    const tapped = await browser.evaluate('window.fixture.points[0]');
    assert.ok(Math.abs(tapped.x - 0.25) < 0.02 && Math.abs(tapped.y - 0.75) < 0.02, `the tap pinned near (0.25, 0.75): ${JSON.stringify(tapped)}`);

    // Transforms: a surface mirrored with scaleX(-1). A click on the drawn spot that is local (0.25, 0.75) reports (0.25, 0.75), not the
    // viewport fractions (0.75, 0.75); the bubble (the registry's NoteBubble, mounted once here) opens beside the drawn point.
    await open('host', '&mirror=1&bubble=1');
    await clickAt(0.75, 0.75);
    await browser.until('the bubble opens', `window.fixture.session.getSnapshot().bubble`);
    assert.deepEqual(await browser.evaluate('window.fixture.points'), [{ x: 0.25, y: 0.75 }], 'a mirrored surface: the point is local to the element, not to the viewport');
    await browser.until('NoteBubble is drawn', `document.querySelector('[data-testid="feedback-bubble"]')`);
    const placed = await browser.evaluate(`(() => {
      const plate = document.getElementById('plate').getBoundingClientRect(), bubble = document.querySelector('[data-testid="feedback-bubble"]').getBoundingClientRect();
      // Drawn position of local (0.25, 0.75) under scaleX(-1): from the right edge.
      const x = plate.right - 0.25 * plate.width, y = plate.top + 0.75 * plate.height;
      return { x, y, left: bubble.left, top: bubble.top, width: innerWidth };
    })()`);
    assert.ok(Math.abs(placed.left - Math.min(placed.x, placed.width - 288)) <= 2, `the bubble's left edge is at the drawn point: ${JSON.stringify(placed)}`);
    assert.ok(placed.top >= placed.y && placed.top <= placed.y + 24, `the bubble sits just below the drawn point: ${JSON.stringify(placed)}`);
    assert.deepEqual(browser.problems, []);
  } finally {
    await browser.close();
    server.close();
  }
});
