import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';

// D-1799 / D-1800: the overlays of the real Sheet, Drawer, Dialog and AlertDialog (shadcn/ui) in a real Chromium. No backdrop blur unless
// <html data-overlay-blur="on"> (what AppShell overlayBlur sets), then blur(var(--overlay-blur, 4px)); and `height` on SheetContent, DrawerContent and
// DialogContent: auto is today's look, tall caps at --overlay-height-tall (85dvh) and scrolls inside, full is --overlay-height-full (100dvh; the Dialog
// keeps its 2rem of side margin). In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('overlays: no blur by default, blur with data-overlay-blur="on"; height auto/tall/full at 390 and 1280', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/overlay-knobs-'));
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/overlays.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = registry.items.find(entry => entry.name === 'theme').cssVars;
  const base = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n`;
  const loadStylesheet = async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  };
  const css = (await compile(base, { base: root, loadStylesheet })).build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: work });
  const POPUP = { sheet: '[data-slot=sheet-content]', drawer: '[data-slot=drawer-popup]', dialog: '[data-slot=dialog-content]' };
  const OVERLAY = { sheet: '[data-slot=sheet-overlay]', drawer: '[data-slot=drawer-overlay]', dialog: '[data-slot=dialog-overlay]', alert: '[data-slot=alert-dialog-overlay]' };
  const open = async (query, selector) => {
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?${query}` });
    await browser.until('overlay mounted', `document.querySelector('${selector}') !== null && document.readyState === 'complete'`);
    await new Promise(done => setTimeout(done, 700));
  };
  const device = async (width, mobile) => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
  };
  const filter = selector => browser.evaluate(`getComputedStyle(document.querySelector('${selector}')).backdropFilter`);
  const box = (selector, scroller = selector) => browser.evaluate(`(() => { const popup = document.querySelector('${selector}'); const scroller = document.querySelector('${scroller}'); return { height: popup.offsetHeight, view: innerHeight, scrolls: scroller.scrollHeight > scroller.clientHeight + 1, attr: popup.getAttribute('data-height') }; })()`);
  try {
    await device(1280, false);
    // D-1799: no blur by default on any of the four overlays; the attribute turns it on, with a tunable radius; "off" or any other value is no blur.
    for (const kind of Object.keys(OVERLAY)) {
      await open(`kind=${kind}`, OVERLAY[kind]);
      assert.equal(await filter(OVERLAY[kind]), 'none', `${kind}: no backdrop blur by default`);
      await open(`kind=${kind}&blur=off`, OVERLAY[kind]);
      assert.equal(await filter(OVERLAY[kind]), 'none', `${kind}: data-overlay-blur="off" is no blur`);
      await open(`kind=${kind}&blur=on`, OVERLAY[kind]);
      assert.match(await filter(OVERLAY[kind]), /blur\(4px\)/, `${kind}: data-overlay-blur="on" blurs by 4px`);
      await open(`kind=${kind}&blur=on&blurpx=9px`, OVERLAY[kind]);
      assert.match(await filter(OVERLAY[kind]), /blur\(9px\)/, `${kind}: --overlay-blur retunes the radius`);
    }
    // D-1800: three steps, at a phone and a desktop width.
    for (const [width, mobile] of [[390, true], [1280, false]]) {
      await device(width, mobile);
      const shapes = [['sheet', 'bottom'], ['sheet', 'top'], ['sheet', 'right'], ['sheet', 'left'], ['drawer', ''], ['dialog', '']];
      for (const [kind, side] of shapes) {
        const where = `${kind}${side ? ' ' + side : ''} at ${width}`;
        const q = height => `kind=${kind}${side ? `&side=${side}` : ''}&height=${height}`;
        const scroller = kind === 'drawer' ? '[data-slot=drawer-content]' : POPUP[kind];
        // auto: as before. Short content is as tall as its content, never the cap.
        await open(`${q('auto')}`, POPUP[kind]);
        const auto = await box(POPUP[kind]);
        assert.equal(auto.attr, 'auto', `${where}: data-height defaults to auto`);
        if (!['left', 'right'].includes(side)) assert.ok(auto.height < auto.view * 0.5, `${where}: auto with short content stays short (${auto.height})`);
        // no height prop at all is auto too, and short content is not stretched.
        await open(`kind=${kind}${side ? `&side=${side}` : ''}`, POPUP[kind]);
        assert.equal((await box(POPUP[kind])).attr, 'auto', `${where}: no height prop is data-height="auto"`);
        // tall: capped at 85dvh, the content scrolls inside.
        await open(`${q('tall')}&long=1`, POPUP[kind]);
        const tall = await box(POPUP[kind], scroller);
        assert.equal(tall.attr, 'tall', `${where}: data-height is tall`);
        assert.ok(Math.abs(tall.height - tall.view * 0.85) <= 1, `${where}: tall is 85dvh (${tall.height} of ${tall.view})`);
        assert.equal(tall.scrolls, true, `${where}: tall scrolls inside`);
        // the token retunes it.
        await open(`${q('tall')}&long=1&tokens=1`, POPUP[kind]);
        const tuned = await box(POPUP[kind], scroller);
        assert.ok(Math.abs(tuned.height - tuned.view * 0.5) <= 1, `${where}: --overlay-height-tall retunes tall (${tuned.height})`);
        // full: the viewport (the Dialog keeps 2rem of margin; a left or right sheet is already full height).
        await open(`${q('full')}`, POPUP[kind]);
        const full = await box(POPUP[kind]);
        assert.equal(full.attr, 'full', `${where}: data-height is full`);
        assert.ok(Math.abs(full.height - (kind === 'dialog' ? full.view - 32 : full.view)) <= 1, `${where}: full fills the screen (${full.height} of ${full.view})`);
        await open(`${q('full')}&tokens=1`, POPUP[kind]);
        const retuned = await box(POPUP[kind]);
        if (!['left', 'right'].includes(side)) assert.ok(Math.abs(retuned.height - (kind === 'dialog' ? retuned.view * 0.7 - 32 : retuned.view * 0.7)) <= 1, `${where}: --overlay-height-full retunes full (${retuned.height})`);
      }
    }
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
