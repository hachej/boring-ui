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

// D-1898: AppShell `resizable`. A real Chromium mounts the real AppShell (test/fixtures/themes/sidebar-open.jsx) and drives the left pane's rail with
// real input: a mouse drag, the arrow keys, a double-click reset and a reload. Widths are the sidebar gap's box (16rem = 256px by default, 12rem to 28rem
// by default). Shots at 1280x800 light and dark go to SIDEBAR_OPEN_EVIDENCE (CI uploads them). In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const KEY = 'boring-ui:sidebar-open';

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/sidebar-open-'));
  const evidence = process.env.SIDEBAR_OPEN_EVIDENCE ?? join(root, ".cache/evidence/sidebar-open");
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/sidebar-open.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
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
const state = () => browser.evaluate(`document.querySelector('[data-slot=sidebar][data-state]')?.getAttribute('data-state') ?? null`);
const keys = () => browser.evaluate(`Object.keys(localStorage).filter(k => k.startsWith('${KEY}')).sort()`);
const ctrlB = async () => { for (const type of ['rawKeyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 }); await wait(400); };
const trigger = async () => { await browser.evaluate(`document.querySelector('[data-sidebar=trigger]').click()`); await wait(400); };
const key = (app, person) => `${KEY}:${encodeURIComponent(app)}:${encodeURIComponent(person)}`;

test('1280, fresh storage: a screen with a sidebar opens the left pane; one without it collapses to the rail', { skip, timeout: 120000 }, async () => {
  await mount('item=Liste');
  assert.equal(await state(), 'expanded');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=own-sidebar]').getBoundingClientRect().width > 0`), true);
  assert.deepEqual(await keys(), [], 'nothing is written on mount');
  await mount('item=Notes');
  assert.equal(await state(), 'collapsed');
  assert.deepEqual(await keys(), [], 'nothing is written on mount');
});

test('the choice is kept: collapse then reload stays collapsed, expand then reload stays expanded', { skip, timeout: 120000 }, async () => {
  await mount('item=Liste&user=a@example.test');
  await ctrlB();
  assert.equal(await state(), 'collapsed');
  assert.deepEqual(await keys(), [key('Compta', 'a@example.test')]);
  assert.equal(await browser.evaluate(`localStorage.getItem(${JSON.stringify(key('Compta', 'a@example.test'))})`), '0');
  await mount('item=Liste&user=a@example.test', { clear: false });
  assert.equal(await state(), 'collapsed');
  await trigger();
  assert.equal(await state(), 'expanded');
  await mount('item=Notes&user=a@example.test', { clear: false });
  assert.equal(await state(), 'expanded', 'the stored choice beats the first-visit default of a screen without a sidebar');
  assert.equal(await browser.evaluate(`localStorage.getItem(${JSON.stringify(key('Compta', 'a@example.test'))})`), '1');
});

test('D-1919: the choice is kept per layout, a fold in the workspace rail does not fold a screen-layout pane', { skip, timeout: 120000 }, async () => {
  const own = `document.querySelector('[data-testid=own-sidebar]')?.getBoundingClientRect().width > 0`;
  await mount('item=Liste&user=a@example.test');
  await ctrlB();
  assert.equal(await state(), 'collapsed', 'folded in the workspace layout');
  await mount('layout=screen&item=Liste&user=a@example.test', { clear: false });
  assert.equal(await state(), 'expanded', 'the screen layout does not read the workspace fold');
  assert.equal(await browser.evaluate(own), true, 'its sidebar content shows');
  await ctrlB();
  assert.equal(await state(), 'collapsed', 'folded in the screen layout');
  await mount('layout=screen&item=Liste&user=a@example.test', { clear: false });
  assert.equal(await state(), 'collapsed', 'the screen fold is kept');
  await mount('item=Liste&user=a@example.test', { clear: false });
  assert.equal(await state(), 'collapsed', 'the workspace choice is its own');
});

test('another person on the same browser gets their own default, and a switch never writes into the other key', { skip, timeout: 120000 }, async () => {
  await mount('item=Liste&user=a@example.test');
  await ctrlB();
  assert.equal(await state(), 'collapsed');
  await browser.evaluate(`window.__setUser('b@example.test')`);
  await wait(400);
  assert.equal(await state(), 'expanded', 'person B starts from the first-visit default');
  assert.deepEqual(await keys(), [key('Compta', 'a@example.test')], 'switching writes nothing');
  await browser.evaluate(`window.__setUser('a@example.test')`);
  await wait(400);
  assert.equal(await state(), 'collapsed', 'person A gets their own choice back');
  assert.equal(await browser.evaluate(`localStorage.getItem(${JSON.stringify(key('Compta', 'a@example.test'))})`), '0');
});

test('a stable appId names the app in the key', { skip, timeout: 120000 }, async () => {
  await mount('item=Liste&user=a@example.test&appid=compta-app&app=Titre');
  await ctrlB();
  assert.deepEqual(await keys(), [key('compta-app', 'a@example.test')]);
});

test('navigating between screens does not re-apply the first-visit default', { skip, timeout: 120000 }, async () => {
  await mount('item=Notes');
  assert.equal(await state(), 'collapsed');
  await browser.evaluate(`window.__go('Liste')`);
  await wait(400);
  assert.equal(await state(), 'collapsed', 'no stored choice: decided at mount only');
  await ctrlB();
  assert.equal(await state(), 'expanded');
  await browser.evaluate(`window.__go('Notes')`);
  await wait(400);
  assert.equal(await state(), 'expanded', 'a stored choice is not overridden by the screen');
});

test('junk in storage is ignored', { skip, timeout: 120000 }, async () => {
  await mount('item=Liste&user=a@example.test');
  const name = JSON.stringify(key('Compta', 'a@example.test'));
  for (const junk of ['true', '2', '']) {
    await browser.evaluate(`localStorage.setItem(${name}, ${JSON.stringify(junk)})`);
    await mount('item=Liste&user=a@example.test', { clear: false });
    assert.equal(await state(), 'expanded', `"${junk}" falls back to the default`);
  }
});

test('storage that throws does not break the shell or the toggle', { skip, timeout: 120000 }, async () => {
  await mount('item=Liste&throw=1');
  assert.equal(await state(), 'expanded');
  await ctrlB();
  assert.equal(await state(), 'collapsed');
  assert.deepEqual(browser.problems.filter(problem => !/storage unavailable/.test(String(problem))), []);
});

test('below 1280 the default is today\'s; a phone keeps the sheet', { skip, timeout: 120000 }, async () => {
  await mount('item=Liste', { width: 1024 });
  assert.equal(await state(), 'collapsed', 'workspace layout: the rail');
  await mount('layout=screen&item=Notes', { width: 1024 });
  assert.equal(await state(), 'expanded', 'screen layout: open as before');
  await mount('item=Liste', { width: 390, touch: true });
  assert.equal(await browser.evaluate(`document.querySelector('[data-slot=sidebar-gap]') === null`), true, 'no sidebar on a phone with tabs');
  assert.deepEqual(await keys(), []);
});

test('the screen layout keeps its open pane at 1280 whatever the item', { skip, timeout: 120000 }, async () => {
  await mount('layout=screen&item=Notes');
  assert.equal(await state(), 'expanded');
});

test('shots at 1280 light and dark', { skip, timeout: 120000 }, async () => {
  for (const mode of ['light', 'dark']) {
    await mount('item=Liste');
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`);
    await wait(300);
    await browser.screenshot(`sidebar-open.1280.${mode}.png`);
  }
  assert.deepEqual(browser.problems, []);
});
