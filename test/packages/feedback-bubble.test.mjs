import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../../lab/studio/tailwind.mjs';
import { surfacePage } from '../fixtures/feedback-surface/page.mjs';

// D-1967: the note bubble of a note pinned on a surface (pins "host") stays inside the surface's box, flips left near its right edge and up near
// its bottom, is a bottom sheet on a phone, and has a popover surface from the shipped stylesheet alone (the bundle's blocks.css: every registry
// item's `css`, merged and serialized as boring-factory's ui-bundle build does). Shots go to FEEDBACK_BUBBLE_EVIDENCE (CI uploads them as
// `note-bubble-shots`). In CI a missing browser fails the test; it never skips.
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const theme = registry.items.find(entry => entry.name === 'theme');
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const evidence = process.env.FEEDBACK_BUBBLE_EVIDENCE ?? join(root, '.cache/evidence/feedback-bubble');

// boring-factory build/bundle/build.mjs: `merge` and `serialize`.
const merge = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else target[key] = value && typeof value === 'object' ? merge({}, value) : value;
  }
  return target;
};
const serialize = (rules, indent = '') => Object.entries(rules).map(([key, value]) => value && typeof value === 'object'
  ? `${indent}${key} {\n${serialize(value, `${indent}  `)}\n${indent}}` : `${indent}${key}: ${value};`).join('\n');
const shipped = () => { const merged = {}; for (const entry of registry.items) if (entry.css) merge(merged, entry.css); return serialize(merged); };

test('the note bubble stays in the surface, flips at its edges, is a sheet on a phone and has a surface in the shipped CSS', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 600000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  mkdirSync(evidence, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/feedback-bubble-'));
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/feedback-surface/entry.mjs')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': join(root, 'examples/app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx|mjs)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const tokens = `:root {${block(theme.cssVars.light)}\n${block(theme.cssVars.theme)}}\n.dark {${block(theme.cssVars.dark)}}\nbody { background: var(--background); color: var(--foreground); }`;
  const compiler = await compile(`@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n${tokens}\n@theme inline {${block(theme.cssVars.theme)}}\n@layer base { * { @apply border-border; } }\n${registryCss(registry.items.find(entry => entry.name === 'feedback'))}`, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const tailwind = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const plate = readFileSync(join(root, 'test/fixtures/feedback-surface/plate.svg'));
  const page = css => surfacePage().replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">').replace('</head>', `<link rel="stylesheet" href="/${css}.css"></head>`);
  const server = createServer((req, res) => {
    const [path, query] = req.url.split('?');
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    res.setHeader('content-type', type);
    res.end(path === '/entry.js' ? js : path === '/plate.svg' ? plate : path === '/tailwind.css' ? `${tokens}\n${tailwind}` : path === '/shipped.css' ? `${tokens}\n${shipped()}` : page(new URLSearchParams(query).get('css') ?? 'tailwind'));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence });
  const frames = () => browser.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
  const open = async (query, { phone = false } = {}) => {
    await browser.emulate(phone ? 'phone' : 'desktop');
    if (!phone) await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?pins=host&bubble=1&${query}` });
    await browser.until('the fixture loads', `document.getElementById('plate')?.complete && window.fixture`);
    await browser.evaluate(phone ? `window.fixture.session.start({ mode: 'point' })` : 'window.fixture.session.start()');
    await browser.until('comment mode is on', `window.fixture.session.getSnapshot().phase === 'active'`);
  };
  const pinAt = async (fx, fy, { touch = false } = {}) => {
    const at = await browser.evaluate(`(() => { const r = document.getElementById('plate').getBoundingClientRect(); return { x: r.left + ${fx} * r.width, y: r.top + ${fy} * r.height }; })()`);
    if (touch) { await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] }); await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await browser.until('the bubble opens', `window.fixture.session.getSnapshot().bubble && !!document.querySelector('[data-testid="feedback-bubble"]')`);
    await frames(); await frames();
    return at;
  };
  const boxes = () => browser.evaluate(`(() => { const p = document.getElementById('plate').getBoundingClientRect(), b = document.querySelector('[data-testid="feedback-bubble"]').getBoundingClientRect();
    return { plate: { left: p.left, top: p.top, right: p.right, bottom: p.bottom }, bubble: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } }; })()`);
  const inside = (box, why) => {
    const { plate: p, bubble: b } = box;
    assert.ok(b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1 && b.bottom <= p.bottom + 1, `${why}: the bubble ${JSON.stringify(b)} is inside the surface ${JSON.stringify(p)}`);
  };
  try {
    // Desktop 1280x800: a 640x420 surface with a pane beside it. Pins at 60% across, near the right edge, near the bottom.
    for (const mode of ['light', 'dark']) {
      const query = `size=640x420&at=100,120${mode === 'dark' ? '&dark=1' : ''}`;
      await open(query);
      let at = await pinAt(0.6, 0.4);
      let box = await boxes();
      inside(box, `${mode}, pin at 60%`);
      await browser.screenshot(`note-bubble.1280.${mode}.png`);
      await browser.press('Escape');

      await open(query);
      at = await pinAt(0.97, 0.4);
      box = await boxes();
      inside(box, `${mode}, pin near the right edge`);
      assert.ok(box.bubble.right <= at.x + 1, `${mode}: near the right edge the bubble flips left of the point (${box.bubble.right} <= ${at.x})`);
      await browser.screenshot(`note-bubble.1280.${mode}.right-edge.png`);
      await browser.press('Escape');

      await open(query);
      at = await pinAt(0.4, 0.95);
      box = await boxes();
      inside(box, `${mode}, pin near the bottom`);
      assert.ok(box.bubble.bottom <= at.y + 1, `${mode}: near the bottom the bubble flips above the point (${box.bubble.bottom} <= ${at.y})`);
      await browser.screenshot(`note-bubble.1280.${mode}.bottom.png`);
      await browser.press('Escape');
    }

    // A phone (390, touch): a bottom sheet, not a floating bubble over the app's header.
    for (const mode of ['light', 'dark']) {
      await open(`size=350x240&at=20,120${mode === 'dark' ? '&dark=1' : ''}`, { phone: true });
      await pinAt(0.6, 0.4, { touch: true });
      // The drawer slides in; wait until it rests on the bottom edge.
      await browser.until('the sheet rests', `(() => { const n = document.querySelector('[data-testid="feedback-bubble"]'); return n && Math.abs(n.getBoundingClientRect().bottom - innerHeight) <= 2; })()`, 5000).catch(() => undefined);
      const sheet = await browser.evaluate(`(() => { const n = document.querySelector('[data-testid="feedback-bubble"]'), r = n.getBoundingClientRect(); return { slot: n.getAttribute('data-slot'), bottom: r.bottom, view: innerHeight, width: innerWidth, left: r.left, right: r.right }; })()`);
      assert.equal(sheet.slot, 'drawer-popup', `${mode}: at 390 the composer is the kit's drawer, a bottom sheet`);
      assert.ok(Math.abs(sheet.bottom - sheet.view) <= 2 && sheet.left <= 1 && sheet.right >= sheet.width - 1, `${mode}: the sheet sits at the bottom edge, full width: ${JSON.stringify(sheet)}`);
      await browser.screenshot(`note-bubble.390.${mode}.png`);
      await browser.press('Escape');
    }

    const failures = [];
    // The normal CommentBanner (fixed, z-index 2147483000, bottom on a phone) is mounted too: the sheet sits above it, so its Add note button is the hit at its centre.
    try {
      await open('size=350x240&at=20,120&banner=1', { phone: true });
      await browser.until('the banner is up', `!!document.querySelector('[data-testid="feedback-point-bar"]')`);
      await pinAt(0.6, 0.4, { touch: true });
      await browser.until('the sheet rests', `(() => { const n = document.querySelector('[data-testid="feedback-bubble"]'); return !!n && Math.abs(n.getBoundingClientRect().bottom - innerHeight) <= 2; })()`, 5000).catch(() => undefined);
      const hit = await browser.evaluate(`(() => { const b = document.querySelector('[data-testid="feedback-bubble-save"]'), r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const bar = document.querySelector('[data-testid="feedback-point-bar"]').getBoundingClientRect(); return { button: !!top && b.contains(top), overlaps: r.top < bar.bottom && r.bottom > bar.top, label: top ? top.outerHTML.slice(0, 80) : null }; })()`);
      assert.ok(hit.button, `with the banner mounted, the Add note button is the hit at its centre (got ${hit.label}; overlaps the banner: ${hit.overlaps})`);
      await browser.screenshot('note-bubble.390.banner.png');
      await browser.press('Escape');
    } catch (error) { failures.push(`banner: ${error.message}`); await browser.press('Escape').catch(() => undefined); }

    // The surface shrinks (640 to 200 wide) with no window resize, and the host calls session.reposition(): the bubble follows, it does not keep its 280px width.
    try {
      await open('size=640x420&at=100,120');
      await pinAt(0.2, 0.4);
      await browser.evaluate(`(() => { document.getElementById('plate').style.width = '200px'; window.fixture.session.reposition(); })()`);
      await frames(); await frames();
      const shrunk = await boxes();
      inside(shrunk, 'after the surface shrank to 200px wide');
      assert.ok(shrunk.bubble.right - shrunk.bubble.left <= 200 + 1, `the bubble is narrower than the shrunken surface (${shrunk.bubble.right - shrunk.bubble.left}px)`);
      await browser.press('Escape');
    } catch (error) { failures.push(`shrink: ${error.message}`); await browser.press('Escape').catch(() => undefined); }

    assert.deepEqual(failures, [], 'the sheet is above the banner and the bubble follows a shrunk surface');
    // The shipped stylesheet alone (no Tailwind, no kit utility classes): the bubble is a popover surface.
    await open('size=640x420&at=100,120&css=shipped');
    await pinAt(0.6, 0.4);
    const surface = await browser.evaluate(`(() => { const s = getComputedStyle(document.querySelector('[data-testid="feedback-bubble"]'));
      const probe = document.createElement('i'); probe.style.color = 'var(--popover)'; document.body.append(probe); const popover = getComputedStyle(probe).color; probe.remove();
      return { background: s.backgroundColor, popover, border: s.borderTopWidth, shadow: s.boxShadow, radius: s.borderTopLeftRadius }; })()`);
    assert.notEqual(surface.background, 'rgba(0, 0, 0, 0)', `the bubble is not transparent in the shipped CSS: ${JSON.stringify(surface)}`);
    assert.equal(surface.background, surface.popover, 'its background is the popover token');
    assert.notEqual(surface.border, '0px', 'it has a border');
    assert.notEqual(surface.shadow, 'none', 'it has a shadow');
    assert.notEqual(surface.radius, '0px', 'it has a token radius');
    assert.deepEqual(browser.problems, []);
  } finally {
    await browser.close();
    server.close();
  }
});
