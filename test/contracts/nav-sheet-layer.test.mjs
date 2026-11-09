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

// D-1903: on a phone (390, touch) with compactNav="sheet", opening the PM from the sheet's account menu must close the sheet, so a tap on pm-close reaches the PM.
// A real Chromium mounts the real AppShell; the shots go to .cache/evidence/nav-sheet-layer (or EVIDENCE_DIR), which CI uploads as `nav-sheet-layer-shots`.
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EVIDENCE_DIR ?? join(root, '.cache/evidence/nav-sheet-layer');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/nav-sheet-layer-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/nav-sheet-layer.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
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
test('390 touch, compactNav sheet: Account > Improve the app closes the sheet, and a tap on pm-close closes the PM', { skip, timeout: 120000 }, async () => {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await browser.until('shell mounted', `!!document.querySelector('[data-testid=app-shell]') && document.readyState === 'complete'`);
  await wait(300);
  await browser.screenshot('1-shell.png');
  await browser.tap(`document.querySelector('[data-slot=sidebar-trigger]')`);
  await browser.until('the nav sheet', `!!document.querySelector('[data-testid=nav-user]')`);
  await wait(700);
  await browser.screenshot('2-nav-sheet.png');
  await browser.tap(`document.querySelector('[data-testid=nav-user]')`);
  await browser.until('the account menu', `!!document.querySelector('[data-testid=account-improve]')`);
  await wait(400);
  await browser.screenshot('3-account-menu.png');
  // The account menu is a dropdown that overflows the 390 screen to the right (the page widens), so a scroll-into-view would keep moving it: tap it where it stands, as a finger does.
  const at = await browser.evaluate(`(() => { const r = document.querySelector('[data-testid=account-improve]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await browser.until('the PM panel', `document.querySelector('[data-testid=pm-panel]')?.hidden === false`);
  await wait(900);
  await browser.screenshot('4-pm-open.png');
  await browser.tap(`document.querySelector('[data-testid=pm-close]')`);
  await browser.until('the PM closed', `document.querySelector('[data-testid=pm-panel]')?.hidden === true`);
  await wait(500);
  await browser.screenshot('5-pm-closed.png');
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=nav-user]')`), false, 'the nav sheet is closed');
});

