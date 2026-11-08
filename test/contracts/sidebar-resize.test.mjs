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

// D-1898: AppShell `resizable`. A real Chromium mounts the real AppShell (test/fixtures/themes/sidebar-resize.jsx) and drives the left pane's rail with
// real input: a mouse drag, the arrow keys, a double-click reset and a reload. Widths are the sidebar gap's box (16rem = 256px by default, 12rem to 28rem
// by default). Shots at 1280x800 light and dark go to SIDEBAR_RESIZE_EVIDENCE (CI uploads them). In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const KEY = 'boring-ui:sidebar-width';
const RAIL = '[data-slot=sidebar-rail]';

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/sidebar-resize-'));
  const evidence = process.env.SIDEBAR_RESIZE_EVIDENCE ?? join(root, ".cache/evidence/sidebar-resize");
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/sidebar-resize.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
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
async function mount(query = '', { width = 1280, touch = false, clear = true } = {}) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: touch });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
  // Headless Chromium does not promise a fine pointer (the CDP media emulation has no pointer feature), so the page is told which pointer this person has:
  // every `(pointer: x)` / `(hover: x)` query answers for a mouse, or for a finger when `touch`.
  // CDP media emulation changes CSS and JS together where this Chromium supports a pointer feature; the shim below is the JS-side fallback.
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: touch ? 'coarse' : 'fine' }, { name: 'hover', value: touch ? 'none' : 'hover' }] });
  if (pointerScript) await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pointerScript });
  pointerScript = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: pointerShim(touch ? 'coarse' : 'fine', touch ? 'none' : 'hover') })).identifier;
  if (clear) { await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?clear=1` }); await browser.until('origin ready', `document.readyState === 'complete'`); await browser.evaluate(`localStorage.clear()`); }
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
  await browser.until('shell mounted', `document.querySelector('[data-testid=app-shell]') !== null && document.readyState === 'complete'`);
  await wait(500);
}
const gap = () => browser.evaluate(`document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width`);
const aria = name => browser.evaluate(`document.querySelector('${RAIL}').getAttribute('${name}')`);
// The key carries the app and the person (the prefix is the kit's): these read and write whatever keys start with it.
const keys = () => browser.evaluate(`Object.keys(localStorage).filter(k => k.startsWith('${KEY}')).sort()`);
const stored = () => browser.evaluate(`(() => { const k = Object.keys(localStorage).find(k => k.startsWith('${KEY}')); return k ? localStorage.getItem(k) : null; })()`);
const setStored = value => browser.evaluate(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('${KEY}')) localStorage.setItem(k, ${JSON.stringify(value)}); })()`);
const transitions = () => browser.evaluate(`[...document.querySelectorAll('[data-slot=sidebar-gap], [data-slot=sidebar-container]')].map(e => e.style.transition)`);
const ctrlB = async () => { for (const type of ['rawKeyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 }); await wait(400); };
const centre = () => browser.evaluate(`(() => { const r = document.querySelector('${RAIL}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const dragBy = async delta => { const box = await centre(); await browser.drag(`document.querySelector('${RAIL}')`, box.x + delta); await wait(300); };
const key = async name => { await browser.evaluate(`document.querySelector('${RAIL}').focus()`); await browser.press(name); await wait(300); };

test('without `resizable` the rail is the same toggle button: no separator, no storage', { skip, timeout: 120000 }, async () => {
  await mount('plain=1');
  assert.equal(await browser.evaluate(`document.querySelector('[role=separator][data-slot=sidebar-rail]') === null`), true);
  assert.equal(await browser.evaluate(`document.querySelector('${RAIL}').tagName`), 'BUTTON');
  assert.equal(await gap(), 256);
  assert.equal(await aria('aria-valuenow'), null);
  assert.equal(await stored(), null);
});

test('the rail is a vertical separator with the width in rem and the default bounds', { skip, timeout: 120000 }, async () => {
  await mount();
  assert.equal(await aria('role'), 'separator');
  assert.equal(await aria('aria-orientation'), 'vertical');
  assert.equal(await aria('aria-valuenow'), '16');
  assert.equal(await aria('aria-valuemin'), '12');
  assert.equal(await aria('aria-valuemax'), '28');
  assert.equal(await aria('tabindex'), '0');
});

test('a drag of the rail sets the width, clamped to 12rem and 28rem', { skip, timeout: 120000 }, async () => {
  await mount();
  await dragBy(100);
  assert.equal(await gap(), 356);
  assert.equal(await aria('aria-valuenow'), '22.3');
  await dragBy(2000);
  assert.equal(await gap(), 448, 'clamped at 28rem');
  await dragBy(-2000);
  assert.equal(await gap(), 192, 'clamped at 12rem');
  assert.equal(await aria('aria-valuenow'), '12');
});

test('the arrow keys resize by 1rem and stop at the bounds; Home and End jump to them', { skip, timeout: 120000 }, async () => {
  await mount();
  await key('ArrowRight');
  assert.equal(await gap(), 272);
  await key('ArrowLeft'); await key('ArrowLeft');
  assert.equal(await gap(), 240);
  await key('End');
  assert.equal(await gap(), 448);
  await key('ArrowRight');
  assert.equal(await gap(), 448, 'clamped at the maximum');
  await key('Home');
  assert.equal(await gap(), 192);
  await key('ArrowLeft');
  assert.equal(await gap(), 192, 'clamped at the minimum');
});

test('min and max narrow the bounds', { skip, timeout: 120000 }, async () => {
  await mount('min=14&max=18');
  assert.equal(await aria('aria-valuemin'), '14');
  assert.equal(await aria('aria-valuemax'), '18');
  await dragBy(1000);
  assert.equal(await gap(), 288);
  await dragBy(-1000);
  assert.equal(await gap(), 224);
});

test('the width survives a reload, and a double-click returns to the theme width and clears it', { skip, timeout: 120000 }, async () => {
  await mount('theme=15.5rem');
  assert.equal(await gap(), 248, 'the theme owns the default');
  await dragBy(80);
  assert.equal(await gap(), 328);
  assert.ok(await stored(), 'stored under the kit key');
  await mount('theme=15.5rem', { clear: false });
  assert.equal(await gap(), 328, 'after a reload');
  const box = await centre();
  for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount });
  await wait(300);
  assert.equal(await gap(), 248, 'back to the theme --sidebar-width');
  assert.equal(await stored(), null, 'the stored value is cleared');
  await mount('theme=15.5rem', { clear: false });
  assert.equal(await gap(), 248, 'a reload keeps the default');
});

test('a stored width outside the bounds is clamped on read, and junk is ignored', { skip, timeout: 120000 }, async () => {
  await mount();
  await key('ArrowRight');
  await setStored('99');
  await mount('', { clear: false });
  assert.equal(await gap(), 448);
  await setStored('not a number');
  await mount('', { clear: false });
  assert.equal(await gap(), 256);
  await setStored('20garbage');
  await mount('', { clear: false });
  assert.equal(await gap(), 256);
});

test('storage that throws does not break the shell or the resize', { skip, timeout: 120000 }, async () => {
  await mount('throw=1');
  assert.equal(await gap(), 256);
  await dragBy(64);
  assert.equal(await gap(), 320);
  await key('ArrowLeft');
  assert.equal(await gap(), 304);
});

test('the stored width is per app and per person: B does not inherit A, another app does not inherit either', { skip, timeout: 120000 }, async () => {
  await mount('user=a@example.test');
  await dragBy(80);
  assert.equal(await gap(), 336);
  await mount('user=b@example.test', { clear: false });
  assert.equal(await gap(), 256, 'person B starts at the theme width');
  await dragBy(-32);
  assert.equal(await gap(), 224);
  await mount('user=a@example.test', { clear: false });
  assert.equal(await gap(), 336, 'person A still has the width A chose');
  await mount('user=a@example.test&app=Autre', { clear: false });
  assert.equal(await gap(), 256, 'the same person in another app');
  await mount('', { clear: false });
  assert.equal(await gap(), 256, 'no person: a key of its own');
  assert.ok((await keys()).length >= 2, 'one key per app and person');
  assert.ok((await keys()).every(k => k.length > 'boring-ui:sidebar-width'.length), 'every key names its app');
});

test('two apps with the same title keep separate widths when they pass an appId, and a renamed title keeps its width', { skip, timeout: 120000 }, async () => {
  await mount('appid=compta-a');
  await dragBy(80);
  assert.equal(await gap(), 336);
  await mount('appid=compta-b', { clear: false });
  assert.equal(await gap(), 256, 'same title, another appId');
  await mount('appid=compta-a&app=Comptabilit%C3%A9', { clear: false });
  assert.equal(await gap(), 336, 'the title changed, the appId did not');
});

test('a drag is cancelled when the person changes mid-drag: nothing is written under the other person', { skip, timeout: 120000 }, async () => {
  await mount('user=a@example.test');
  const held = await browser.drag(`document.querySelector('${RAIL}')`, (await centre()).x + 60, { release: false });
  await browser.evaluate(`window.__setUser('b@example.test')`);
  await wait(300);
  assert.equal(await gap(), 256, 'person B starts at the theme width');
  await held.moveTo((await centre()).x + 120);
  await wait(200);
  assert.equal(await gap(), 256, 'the cancelled drag no longer follows the pointer');
  assert.deepEqual(await transitions(), ['', '']);
  await held.release();
  await wait(200);
  assert.deepEqual(await keys(), [], 'neither person got a width written');
  assert.equal(await gap(), 256);
});

test('SidebarProvider used directly: ResizableSidebarProvider and ResizableRail give the same handle, keys and persistence', { skip, timeout: 120000 }, async () => {
  await mount('standalone=1');
  assert.equal(await aria('role'), 'separator');
  assert.equal(await aria('aria-valuenow'), '16');
  assert.equal(await gap(), 256);
  await key('End');
  assert.equal(await gap(), 448);
  await dragBy(-100);
  assert.equal(await gap(), 348);
  await mount('standalone=1', { clear: false });
  assert.equal(await gap(), 348, 'after a reload');
});

test('a drag cut short leaves no inline transition behind: Ctrl+B mid-drag, and a lost pointer capture', { skip, timeout: 120000 }, async () => {
  await mount();
  let held = await browser.drag(`document.querySelector('${RAIL}')`, (await centre()).x + 60, { release: false });
  assert.deepEqual(await transitions(), ['none', 'none'], 'following the pointer');
  await ctrlB();
  assert.equal(await browser.evaluate(`document.querySelector('[data-slot=sidebar]').getAttribute('data-state')`), 'collapsed');
  assert.deepEqual(await transitions(), ['', ''], 'the handle unmounted mid-drag');
  await held.release();
  await ctrlB();
  assert.equal(await browser.evaluate(`document.querySelector('${RAIL}').getAttribute('role')`), 'separator', 'the handle is back');
  held = await browser.drag(`document.querySelector('${RAIL}')`, (await centre()).x + 60, { release: false });
  assert.deepEqual(await transitions(), ['none', 'none']);
  await browser.evaluate(`(() => { const rail = document.querySelector('${RAIL}'); for (let id = 0; id < 12; id++) { try { rail.releasePointerCapture(id); } catch {} } })()`);
  await wait(200);
  assert.deepEqual(await transitions(), ['', ''], 'pointer capture lost');
  await held.release();
});

test('on a touch device there is no resize handle', { skip, timeout: 120000 }, async () => {
  await mount('', { width: 1280, touch: true });
  assert.equal(await browser.evaluate(`document.querySelector('[role=separator][data-slot=sidebar-rail]') === null`), true);
  await mount('', { width: 390, touch: true, clear: false });
  assert.equal(await browser.evaluate(`document.querySelector('[role=separator][data-slot=sidebar-rail]') === null`), true);
});

test('shots at 1280 light and dark', { skip, timeout: 120000 }, async () => {
  for (const mode of ['light', 'dark']) {
    await mount('');
    await dragBy(64);
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`);
    await wait(300);
    await browser.screenshot(`sidebar-resize.1280.${mode}.png`);
  }
  assert.deepEqual(browser.problems, []);
});
