import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../../lab/studio/tailwind.mjs';

// D-1902: a tabs-mode AppShell at 390 whose nav items carry a `sidebar`: the header's leading button opens it in a left sheet, choosing a row closes it,
// an item without a sidebar gets no button. A real Chromium mounts the real AppShell; the shots go to .cache/evidence/screen-sidebar (or EVIDENCE_DIR),
// which CI uploads as `screen-sidebar-shots`. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EVIDENCE_DIR ?? join(root, '.cache/evidence/screen-sidebar');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/screen-sidebar-'));
  const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
    builder.onResolve({ filter: /^@hachej\/boring-feedback\/ui$/ }, () => ({ path: join(root, 'packages/feedback/src/ui/index.ts') }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/screen-sidebar.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'viewer-frame', 'feedback'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => [...source.split(/[\s"'`]+/), ...source.split(/[\s"`]+/)]));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  port = server.address().port;
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  browser = await launch('about:blank', { evidence: shots });
});
after(async () => { await browser?.close(); await new Promise(done => server ? server.close(done) : done()); });

const wait = ms => new Promise(done => setTimeout(done, ms));
const open = async (id, dark = false) => {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?id=${id}${dark ? '&dark=1' : ''}` });
  await browser.until('shell mounted', `window.__nav && document.querySelector('[data-testid=app-shell]') && document.readyState === 'complete'`);
  await wait(300);
};
const has = selector => browser.evaluate(`!!document.querySelector('${selector}')`);
const click = selector => browser.evaluate(`document.querySelector('${selector}').click()`);

test('the rule: every nav item with a sidebar has a phone path at 390, every item without one has none', { skip, timeout: 120000 }, async () => {
  await open('library');
  const nav = await browser.evaluate(`window.__nav`);
  assert.ok(nav.some(entry => entry.hasSidebar) && nav.some(entry => !entry.hasSidebar), 'the fixture has both kinds of item');
  for (const { id, hasSidebar } of nav) {
    await open(id);
    assert.equal(await has('[data-testid=screen-sidebar-button]'), hasSidebar, `${id}: a sidebar item has a header button, the others none`);
    if (!hasSidebar) continue;
    const box = await browser.evaluate(`(() => { const r = document.querySelector('[data-testid=screen-sidebar-button]').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
    assert.ok(box.w >= 44 && box.h >= 44, `${id}: the button is at least 44px (${box.w}x${box.h})`);
    const icon = await browser.evaluate(`document.querySelector('[data-testid=screen-sidebar-button] svg').getBoundingClientRect().width`);
    assert.ok(icon >= 12 && icon <= 28, `${id}: the button's icon has a normal size (${icon}px)`);
    await click('[data-testid=screen-sidebar-button]');
    await browser.until(`${id} sheet`, `!!document.querySelector('[data-testid=screen-sidebar-sheet]')`);
  }
});

test('the button is named from the item and the sidebar, and the sheet is as wide as the sidebar sheet of compactNav="sheet"', { skip, timeout: 120000 }, async () => {
  await open('library');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=screen-sidebar-button]').getAttribute('aria-label')`), 'Library: Videos');
  await open('channels');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=screen-sidebar-button]').getAttribute('aria-label')`), 'Channels: Panel');
  await open('library');
  await click('[data-testid=screen-sidebar-button]');
  await browser.until('sheet', `!!document.querySelector('[data-testid=screen-sidebar-sheet]')`);
  await wait(500);
  const width = await browser.evaluate(`document.querySelector('[data-testid=screen-sidebar-sheet]').getBoundingClientRect().width`);
  assert.ok(Math.abs(width - 390 * 0.75) <= 1, `75% of 390 (${width})`);
});

test('open the sheet, pick a row, the sheet closes; the search field keeps it open', { skip, timeout: 120000 }, async () => {
  await open('library');
  await click('[data-testid=screen-sidebar-button]');
  await browser.until('rows', `!!document.querySelector('[data-testid=row-1]')`);
  await click('[data-testid=sidebar-search]');
  await wait(400);
  assert.equal(await has('[data-testid=screen-sidebar-sheet]'), true, 'the search field keeps the sheet');
  await click('[data-testid=row-1]');
  await browser.until('sheet closed', `!document.querySelector('[data-testid=screen-sidebar-sheet]')`);
});

for (const dark of [false, true]) {
  test(`shoot the library at 390, ${dark ? 'dark' : 'light'}: closed and open`, { skip, timeout: 120000 }, async () => {
    await open('library', dark);
    await browser.screenshot(`screen-sidebar-390-${dark ? 'dark' : 'light'}-closed.png`);
    await click('[data-testid=screen-sidebar-button]');
    await browser.until('sheet', `!!document.querySelector('[data-testid=screen-sidebar-sheet]')`);
    await wait(900);
    await browser.screenshot(`screen-sidebar-390-${dark ? 'dark' : 'light'}-open.png`);
  });
}
