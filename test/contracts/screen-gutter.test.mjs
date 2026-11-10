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

// D-2030: one screen margin. A real Chromium mounts the real AppShell (test/fixtures/themes/screen-gutter.jsx) and measures where the header title's text starts
// against where the body's text starts, for a padded ScreenBody and a bled list, at 1280 fine and 390 touch, in default and compact density.
// Shots at 1280 and 390, light and dark, go to SCREEN_GUTTER_EVIDENCE (CI uploads them). In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/screen-gutter-'));
  const evidence = process.env.SCREEN_GUTTER_EVIDENCE ?? join(root, ".cache/evidence/screen-gutter");
  mkdirSync(evidence, { recursive: true });
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/screen-gutter.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'viewer-frame', 'feedback'].map(name => registryCss(item(name))).join('\n')}`;
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
  browser = await launch('about:blank', { evidence });
});
after(async () => { await browser?.close(); await new Promise(done => server ? server.close(done) : done()); });

const wait = ms => new Promise(done => setTimeout(done, ms));
let pointerScript = null;
const pointerShim = (pointer, hover) => `(() => { const real = window.matchMedia.bind(window); window.matchMedia = query => { const list = real(query); const m = /^\\(\\s*(any-)?(pointer|hover)\\s*:\\s*(\\w+)\\s*\\)$/.exec(String(query).trim()); if (m) Object.defineProperty(list, 'matches', { get: () => m[3] === (m[2] === 'pointer' ? '${pointer}' : '${hover}') }); return list; }; })()`;
async function mount(query = '', { width = 1280, touch = false } = {}) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: touch });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
  // Headless Chromium does not promise a fine pointer (the CDP media emulation has no pointer feature), so the page is told which pointer this person has:
  // every `(pointer: x)` / `(hover: x)` query answers for a mouse, or for a finger when `touch`.
  // CDP media emulation changes CSS and JS together where this Chromium supports a pointer feature; the shim below is the JS-side fallback.
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: touch ? 'coarse' : 'fine' }, { name: 'hover', value: touch ? 'none' : 'hover' }] });
  if (pointerScript) await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pointerScript });
  pointerScript = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: pointerShim(touch ? 'coarse' : 'fine', touch ? 'none' : 'hover') })).identifier;
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
  await browser.until('shell mounted', `document.querySelector('[data-testid=app-shell]') !== null && document.readyState === 'complete'`);
  await wait(500);
}


// The left of the first line of text under `selector`.
const textX = selector => browser.evaluate(`(() => { const root = document.querySelector('${selector}'); const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }); const node = walker.nextNode(); const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().left; })()`);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1, `${message}: ${actual} vs ${expected}`);

const views = [{ name: '1280 fine', width: 1280, touch: false }, { name: '390 touch', width: 390, touch: true }];
for (const view of views) for (const density of ['default', 'compact']) for (const screen of ['Padded', 'Bled']) {
  const gutter = density === 'compact' ? 12 : 16;
  test(`${view.name}, ${density} density, ${screen === 'Padded' ? 'a padded body' : 'a bled list'}: the header title and the body text start on the same screen gutter (${gutter}px)`, { skip, timeout: 120000 }, async () => {
    await mount(`screen=${screen}${density === 'compact' ? '&density=compact' : ''}`, view);
    // The screen box starts beside the open sidebar at 1280, so the gutter is measured from its left edge.
    const edge = await browser.evaluate(`document.querySelector('[data-testid=screen-${screen}]').getBoundingClientRect().left`);
    const title = await textX('[data-testid=header-title]');
    const body = await textX(`[data-testid=screen-${screen}]`);
    near(title - edge, gutter, 'the header title sits on the gutter');
    near(body - edge, gutter, 'the body text sits on the gutter');
    near(title, body, 'title and body share one left edge');
  });
}

test('the gutter is a token with a fallback: a root that sets --screen-gutter moves the title and the body together', { skip, timeout: 120000 }, async () => {
  await mount('screen=Padded');
  const edge = await browser.evaluate(`document.querySelector('[data-testid=screen-Padded]').getBoundingClientRect().left`);
  await browser.evaluate(`document.documentElement.style.setProperty('--screen-gutter', '2rem')`);
  await wait(200);
  near(await textX('[data-testid=header-title]') - edge, 32, 'title');
  near(await textX('[data-testid=screen-Padded]') - edge, 32, 'body');
});

for (const view of views) test(`${view.name}: a bled list's selected row runs edge to edge while its text sits on the gutter, under a divider`, { skip, timeout: 120000 }, async () => {
  await mount('screen=Bled', view);
  const box = await browser.evaluate(`(() => { const body = document.querySelector('[data-testid=screen-Bled]').getBoundingClientRect(); const row = document.querySelector('[data-testid=row-selected]').getBoundingClientRect(); return { bodyLeft: body.left, bodyRight: body.right, left: row.left, right: row.right, divider: getComputedStyle(document.querySelector('[data-testid=row-selected]')).borderBottomWidth, fill: getComputedStyle(document.querySelector('[data-testid=row-selected]')).backgroundColor }; })()`);
  near(box.left, box.bodyLeft, 'the selected row starts at the body edge (x=0 on the phone, the sidebar edge on desktop)');
  near(box.right, box.bodyRight, 'the selected row ends at the body edge');
  assert.ok(parseFloat(box.divider) > 0, `the row has a divider: ${box.divider}`);
  assert.ok(box.fill !== 'rgba(0, 0, 0, 0)' && box.fill !== 'transparent', `the selected row has a fill: ${box.fill}`);
  near(await textX('[data-testid=row-selected]') - box.bodyLeft, 16, 'the selected row text sits on the gutter');
});

test('390 touch: a back button before the title leaves a small gap, not the bare gutter', { skip, timeout: 120000 }, async () => {
  await mount('screen=Padded&back=1', views[1]);
  const back = await browser.evaluate(`document.querySelector('[data-testid=header-back]').getBoundingClientRect().right`);
  const gap = await textX('[data-testid=header-title]') - back;
  assert.ok(gap > 0 && gap <= 16, `the gap between the back button and the title is small and positive: ${gap}`);
});

test('the stub tab icons are sized by the kit (size-4), not giant circles', { skip, timeout: 120000 }, async () => {
  await mount('screen=Padded', views[0]);
  const size = await browser.evaluate(`Math.max(...[...document.querySelectorAll('[data-testid=app-shell] svg[data-icon]')].map(svg => svg.getBoundingClientRect().width))`);
  assert.ok(size > 0 && size <= 20, `nav icons are at most 20px: ${size}`);
});

test('shots at 1280 and 390, light and dark (padded body and bled list)', { skip, timeout: 180000 }, async () => {
  for (const view of views) for (const mode of ['light', 'dark']) for (const screen of ['Padded', 'Bled']) {
    await mount(`screen=${screen}`, view);
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`);
    await wait(200);
    await browser.screenshot(`screen-gutter.${view.width}.${mode}.${screen.toLowerCase()}.png`);
  }
  // D-2045: compact density, and a back button before the title on the phone.
  await mount('screen=Padded&density=compact', views[0]);
  await browser.screenshot('screen-gutter.1280.light.compact.padded.png');
  await mount('screen=Padded&back=1', views[1]);
  await browser.screenshot('screen-gutter.390.light.back.padded.png');
  assert.deepEqual(browser.problems, []);
});
