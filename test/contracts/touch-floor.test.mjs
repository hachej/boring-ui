import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../../lab/studio/tailwind.mjs';

// D-1770: the 44px touch floor needs no scope class. A page with no .pi-chat, .app-shell or .boring-viewer, and a Popover portaled at body, hold small
// controls (a Button copy from before D-1741 with no floor of its own, the current kit Button, Toggle, ToggleGroupItem) and a real Chromium measures them
// with only the `theme` item's CSS loaded: 44 by 44 at 390 touch, the kit's own sizes at 1280 fine, and the kit's own sizes in a data-density="compact"
// frame even on touch. Set EVIDENCE_DIR to also write the screenshots there. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const floored = ['legacy-sm', 'legacy-icon-sm', 'legacy-xs', 'kit-sm', 'kit-icon-sm', 'toggle-sm', 'group-item'];
const ids = [...floored, 'inline']; // inline (D-1767) is a link inside a line of text: data-size="inline" is excluded from the floor

test('small controls are 44px on touch with no scope class, in a portaled popover too, and keep their sizes on a fine pointer and in compact', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/touch-floor-'));
  const shots = process.env.EVIDENCE_DIR; if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/touch-floor.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  // Only the theme item's own CSS: the floor must not depend on a block that scopes it.
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${registryCss(item('theme'))}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: shots ?? work });
  const measure = () => browser.evaluate(`(() => Object.fromEntries(['plain', 'compact', 'popover'].map(where => [where, Object.fromEntries(${JSON.stringify(ids)}.map(id => {
    const node = document.querySelector('[data-testid="' + where + '-' + id + '"]'); const r = node?.getBoundingClientRect();
    return [id, r ? [Math.round(r.width), Math.round(r.height)] : null]; }))])))()`);
  let fine;
  const violations = [];
  try {
    for (const [width, mobile] of [[1280, false], [390, true]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
      await browser.until('fixture mounted', `document.querySelector('[data-testid="popover-content"] [data-testid="popover-legacy-sm"]') !== null && document.readyState === 'complete'`);
      await new Promise(done => setTimeout(done, 500)); // buttons transition their size (transition-all)
      assert.equal(await browser.evaluate(`document.querySelector('#root [data-testid="popover-content"]') === null && document.body.contains(document.querySelector('[data-testid="popover-content"]'))`), true, 'the popover is portaled out of #root');
      assert.equal(await browser.evaluate(`document.querySelector('.pi-chat, .app-shell, .boring-viewer')`), null, 'no scope class on the page');
      const sizes = await measure();
      if (!mobile) {
        fine = sizes;
        // The kit's sizes on a fine pointer: sm and icon-sm 24, xs 20, Toggle sm 32 high, nothing floored.
        assert.deepEqual([sizes.plain['legacy-sm'][1], sizes.plain['legacy-icon-sm'], sizes.plain['legacy-xs'][1], sizes.plain['kit-sm'][1], sizes.plain['kit-icon-sm'], sizes.plain['toggle-sm'][1]], [24, [24, 24], 20, 24, [24, 24], 32], '1280 fine sizes');
        assert.deepEqual(sizes.compact, sizes.plain, '1280 compact frame equals the plain page');
      } else {
        for (const where of ['plain', 'popover']) for (const id of floored) if (!(sizes[where][id]?.[0] >= 44 && sizes[where][id]?.[1] >= 44)) violations.push(`${where} ${id}: ${JSON.stringify(sizes[where][id])} under 44x44`);
        for (const where of ['plain', 'popover']) if (!(sizes[where].inline?.[1] < 30)) violations.push(`${where} inline: ${JSON.stringify(sizes[where].inline)} should stay at text height`);
        // data-density="compact" on a phone is the desktop density: the same sizes as at 1280, no floor.
        assert.deepEqual(sizes.compact, fine.compact, '390 compact frame keeps the desktop sizes');
      }
      if (shots) await browser.screenshot(`floor-${width}-page.png`);
      if (shots) {
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?only=dense` });
        await browser.until('dense row mounted', `document.querySelector('[data-case=dense] button') !== null && document.readyState === 'complete'`);
        await new Promise(done => setTimeout(done, 500));
        const row = await browser.evaluate(`[...document.querySelectorAll('[data-case=dense] button, [data-case=dense] [data-slot]')].map(node => { const r = node.getBoundingClientRect(); return [node.getAttribute('data-testid'), Math.round(r.width), Math.round(r.height)]; })`);
        writeFileSync(join(shots, `dense-block-actions-${width}.json`), JSON.stringify(row));
        await browser.screenshot(`dense-block-actions-${width}.png`);
      }
    }
    assert.deepEqual(violations, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
