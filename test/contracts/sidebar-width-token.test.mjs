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

// D-1789: the sidebar width is a theme token. A real Chromium mounts the real SidebarProvider and Sidebar (shadcn/ui/sidebar.tsx) with the app-shell
// item's CSS: the default is 256px, an app's unlayered `:root { --sidebar-width: 15.5rem }` (no !important) gives 248px, a SidebarProvider `style`
// still wins, and the icon width and mobile width are tokens too. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('--sidebar-width is a theme token: default 256px, a theme :root wins without !important, a provider style wins over both', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/sidebar-width-'));
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/sidebar-width.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const base = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n`;
  const loadStylesheet = async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  };
  const candidates = sources.flatMap(source => source.split(/[\s"'`]+/));
  // The full kit CSS (theme and app-shell items), and the shadcn sidebar alone: the same utilities, no item css.
  const css = (await compile(base + ['theme', 'app-shell'].map(name => registryCss(item(name))).join('\n'), { base: root, loadStylesheet })).build(candidates);
  const bare = (await compile(base, { base: root, loadStylesheet })).build(candidates);
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : path === '/bare.css' ? bare : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: work });
  const width = async (query, selector = '[data-slot=sidebar-gap]') => {
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?${query}` });
    await browser.until('fixture mounted', `document.querySelector('${selector}') !== null && document.readyState === 'complete'`);
    await new Promise(done => setTimeout(done, 600));
    return browser.evaluate(`document.querySelector('${selector}').getBoundingClientRect().width`);
  };
  const device = async (w, mobile) => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
  };
  try {
    await device(1280, false);
    for (const bare of ['', '&bare=1']) {
      const tag = bare ? 'sidebar primitive alone' : 'with the app-shell css';
      assert.equal(await width(`x=1${bare}`), 256, `${tag}: default sidebar is 256px`);
      assert.equal(await width(`theme=15.5rem${bare}`), 248, `${tag}: a theme :root --sidebar-width of 15.5rem gives 248px without !important`);
      assert.equal(await width(`provider=20rem${bare}`), 320, `${tag}: a SidebarProvider style gives 320px`);
      assert.equal(await width(`theme=15.5rem&provider=20rem${bare}`), 320, `${tag}: a provider style wins over the theme`);
      // The icon rail is --sidebar-row (the wrapper's --control-h) + 1rem: 36 + 16 on a fine pointer, and it follows a --control-h set on an ancestor.
      assert.equal(await width(`open=0${bare}`), 52, `${tag}: icon rail on a fine pointer is 2.25rem + 1rem`);
      assert.equal(await width(`open=0&ch=3rem${bare}`), 64, `${tag}: the icon rail follows an ancestor --control-h (3rem + 1rem)`);
      assert.equal(await width(`open=0&theme=5rem${bare}`), 52, `${tag}: --sidebar-width does not touch the icon rail`);
    }
    await device(1280, true);
    for (const bare of ['', '&bare=1']) {
      assert.equal(await width(`open=0${bare}`), 60, `coarse pointer${bare}: icon rail is max(control-h, 2.75rem) + 1rem`);
      assert.equal(await width(`open=0&ch=3rem${bare}`), 64, `coarse pointer${bare}: a larger ancestor --control-h still wins`);
    }
    // The phone sheet is 75% of the screen up to the Sheet's 24rem cap, exactly as on main (its 18rem inline value never applied), unless the token is set.
    for (const bare of ['', '&bare=1']) {
      await device(390, true);
      assert.equal(await width(`sheet=1${bare}`, '[data-mobile=true]'), 292.5, `mobile sheet${bare}: default is 75% of 390`);
      await device(767, true);
      assert.equal(await width(`sheet=1${bare}`, '[data-mobile=true]'), 384, `mobile sheet${bare}: default at 767 is the 24rem cap`);
      await device(500, true);
      assert.equal(await width(`sheet=1&tm=20rem${bare}`, '[data-mobile=true]'), 320, `mobile sheet${bare}: a theme :root --sidebar-width-mobile of 20rem gives 320px`);
    }
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
