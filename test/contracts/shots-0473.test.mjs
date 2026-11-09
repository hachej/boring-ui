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

// D-1962: sign-off shots of kit 0.4.73, taken in real Chromium and uploaded by CI as `shots-0473-signoff`: the WorkspaceBar host panel open and closed through `command`
// (D-1930, 1280 and 390), the left pane's resize handle at rest, hover, drag, min and max (D-1898, 1280), and the real AppShell phone menu with the touch « … » (D-1904, 390).
// Each shot only asserts that its element rendered. No behaviour is tested here. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.SHOTS_0473_EVIDENCE ?? join(root, '.cache/evidence/shots-0473');
const RAIL = '[data-slot=sidebar-rail]';

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/shots-0473-'));
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
  const bundles = {};
  const sources = [];
  for (const name of ['shots-0473', 'sidebar-resize']) {
    const bundle = await build({ entryPoints: [join(root, `test/fixtures/themes/${name}.jsx`)], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
    bundles[name] = bundle.outputFiles[0].text;
    sources.push(...Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8')));
  }
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'pi-app', 'viewer-frame', 'feedback'].filter(item).map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const entry = url.searchParams.get('entry') ?? 'shots-0473';
    res.setHeader('content-type', url.pathname === '/app.js' ? 'text/javascript' : url.pathname === '/app.css' ? 'text/css' : 'text/html');
    res.end(url.pathname === '/app.js' ? bundles[entry] : url.pathname === '/app.css' ? css : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js?entry=${entry}"></script></body></html>`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  port = server.address().port;
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  browser = await launch('about:blank', { evidence: shots });
});
after(async () => { await browser?.close(); await new Promise(done => server ? server.close(done) : done()); });

const wait = ms => new Promise(done => setTimeout(done, ms));
const exists = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}) !== null`);
// Fine pointer at 1280, a finger (coarse pointer, touch) at 390, as the other shot steps do. `entry` picks the fixture bundle.
// Headless Chromium does not promise a fine pointer, so the page is also told which pointer this person has (as sidebar-resize.test.mjs does): without it the rail is not a resize handle.
let pointerScript = null;
const pointerShim = (pointer, hover) => `(() => { const real = window.matchMedia.bind(window); window.matchMedia = query => { const list = real(query); const m = /^\\(\\s*(any-)?(pointer|hover)\\s*:\\s*(\\w+)\\s*\\)$/.exec(String(query).trim()); if (m) Object.defineProperty(list, 'matches', { get: () => m[3] === (m[2] === 'pointer' ? '${pointer}' : '${hover}') }); return list; }; })()`;
async function open(query, width, touch, ready, entry = 'shots-0473') {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: touch ? 844 : 800, deviceScaleFactor: 1, mobile: touch });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: touch ? 'coarse' : 'fine' }, { name: 'hover', value: touch ? 'none' : 'hover' }] });
  if (pointerScript) await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pointerScript });
  pointerScript = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: pointerShim(touch ? 'coarse' : 'fine', touch ? 'none' : 'hover') })).identifier;
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 700 });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?entry=${entry}&${query}` });
  await browser.until('fixture mounted', `document.readyState === 'complete' && ${ready}`);
  await wait(500);
}
const shot = async (name, selector) => { assert.equal(await exists(selector), true, `${name}: ${selector} rendered`); await browser.screenshot(`${name}.png`); };

test('workspacebar: the host panel open and closed through command, 1280 and 390, light and dark', { skip, timeout: 180000 }, async () => {
  for (const [width, touch] of [[1280, false], [390, true]]) for (const mode of ['light', 'dark']) {
    await open(`case=bar&theme=${mode}`, width, touch, `!!window.__command && !!document.querySelector('[data-testid=workspace-bar-tasks]')`);
    await browser.evaluate(`window.__command('tasks')`);
    await browser.until('panel open', `!!document.querySelector('[data-testid=workspace-tasks]')`);
    await wait(700);
    await shot(`workspacebar-open-${width}-${mode}`, '[data-testid=workspace-tasks]');
    await browser.evaluate(`window.__command('tasks')`);
    await browser.until('panel closed', `!document.querySelector('[data-testid=workspace-tasks]')`);
    await wait(700);
    await shot(`workspacebar-closed-${width}-${mode}`, '[data-testid=workspace-bar-tasks]');
  }
});

// The bounds are read from the code under test, so a change to the kit's minimum renames the file instead of mislabelling it.
const bound = name => Number(/const (?:MIN|MAX)_REM = (\d+)/.exec(readFileSync(join(root, 'registry/app-shell/sidebar-resize.tsx'), 'utf8').split('\n').find(line => line.startsWith(`const ${name}_REM`)))[1]);
test('resize handle: rest, hover, drag, min and max at 1280, light and dark', { skip, timeout: 180000 }, async () => {
  const MIN = bound('MIN'), MAX = bound('MAX');
  const handle = `document.querySelector('${RAIL}')`;
  const centre = () => browser.evaluate(`(() => { const r = ${handle}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const gap = () => browser.evaluate(`document.querySelector('[data-slot=sidebar-gap]').getBoundingClientRect().width`);
  const saved = name => readFileSync(join(shots, `${name}.png`));
  for (const mode of ['light', 'dark']) {
    const fresh = async () => {
      await open('', 1280, false, `${handle} !== null`, 'sidebar-resize'); await browser.evaluate(`localStorage.clear()`);
      await open('', 1280, false, `${handle} !== null`, 'sidebar-resize'); await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`); await wait(200);
      assert.equal(await browser.evaluate(`${handle}.getAttribute('role')`), 'separator', 'the rail is the resize handle');
    };
    const widths = {};
    const take = async (state, expected) => {
      widths[state] = await gap();
      assert.equal(widths[state], expected, `${state} ${mode}: left pane width`);
      await shot(`resize-handle-${state}-1280-${mode}`, RAIL);
    };
    await fresh();
    await take('rest', 256);
    await browser.hover(handle); await wait(300);
    assert.equal(await browser.evaluate(`${handle}.matches(':hover')`), true, 'the pointer is over the handle');
    await take('hover', 256);
    await fresh();
    const held = await browser.drag(handle, (await centre()).x + 64, { release: false }); await wait(300);
    await take('drag', 320);
    await held.release();
    await fresh();
    await browser.drag(handle, (await centre()).x - 2000); await wait(400);
    await take(`min-${MIN}rem`, MIN * 16);
    await fresh();
    await browser.drag(handle, (await centre()).x + 2000); await wait(400);
    await take(`max-${MAX}rem`, MAX * 16);
    const different = [...new Set([widths.rest, widths.drag, widths[`min-${MIN}rem`], widths[`max-${MAX}rem`]])];
    assert.equal(different.length, 4, `rest, drag, min and max widths differ: ${JSON.stringify(widths)}`);
    // Rest and hover share a width, so their files must differ in the handle's own style; every state's file is distinct.
    const files = ['rest', 'hover', 'drag', `min-${MIN}rem`, `max-${MAX}rem`].map(state => saved(`resize-handle-${state}-1280-${mode}`).toString('base64'));
    assert.equal(new Set(files).size, 5, `${mode}: the five resize shots are pairwise different`);
  }
});

test('phone menu: the real AppShell nav sheet at 390 (touch) with the row « … » and a count, light and dark', { skip, timeout: 180000 }, async () => {
  for (const mode of ['light', 'dark']) {
    await open(`case=phone&theme=${mode}`, 390, true, `!!document.querySelector('[data-slot=sidebar-trigger]')`);
    await browser.tap(`document.querySelector('[data-slot=sidebar-trigger]')`);
    await browser.until('the nav sheet rows', `!!document.querySelector('[data-slot=sidebar-menu-action]')`);
    await wait(700);
    await shot(`phone-menu-390-${mode}`, '[data-slot=sidebar-menu-action]');
  }
  assert.deepEqual(browser.problems, []);
});
