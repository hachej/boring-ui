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

// `composer="explore"` in real Chromium (the real AppShell over a page of data): closed, the page has its whole width and the Ask toggle is at the bottom right inside the safe areas; open, the panel pushes the page (1440), overlays it (900) or is a bottom sheet (390), in both themes. Shots go to .cache/evidence/explore-composer. In CI a missing browser fails the test (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EXPLORE_COMPOSER_EVIDENCE ?? join(root, '.cache/evidence/explore-composer');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/explore-composer-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/explore-composer.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'pi-chat-mentions', 'pi-chat-attachments', 'pi-chat-slash', 'agent-bar'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
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
const js = value => JSON.stringify(value);
const open = async (width, query = '', { keep = false } = {}) => {
  const phone = width < 768;
  await browser.send('Page.navigate', { url: 'about:blank' });
  await browser.until('previous page left', `location.href === 'about:blank'`);
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 844 : 900, deviceScaleFactor: 1, mobile: phone });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${keep ? 'keep=1&' : ''}${query}` });
  await browser.until('mounted', `!!document.querySelector('[data-testid=page-button]') && document.readyState === 'complete'`);
  await wait(400);
};
const rect = selector => browser.evaluate(`(() => { const e = document.querySelector(${js(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`);
const count = selector => browser.evaluate(`document.querySelectorAll(${js(selector)}).length`);
const click = selector => browser.evaluate(`document.querySelector(${js(selector)}).click()`);
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(200); await browser.screenshot(`explore-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };
const TOGGLE = '[data-testid=explore-toggle]', PANEL = '[data-testid=explore-panel]', PAGE = '[data-testid=orders]';

test('1440: closed, the page keeps its whole width and the Ask toggle sits at the bottom right; open, the panel pushes the page, which stays usable', { skip, timeout: 120000 }, async () => {
  await open(1440);
  const closed = await rect(PAGE);
  assert.equal(await count(PANEL), 0, 'closed by default');
  assert.equal(await count('[data-testid=agent-composer-box], [data-testid=composer-icon]'), 0, 'no bar, no icon');
  const toggle = await rect(TOGGLE);
  assert.ok(toggle && toggle.right >= 1439 && toggle.bottom <= 900 && toggle.bottom >= 800, `bottom right: ${JSON.stringify(toggle)}`);
  assert.ok(toggle.h <= 48 && toggle.w <= 120, `a small tab: ${JSON.stringify(toggle)}`);
  await shots2('1440-1-closed');
  await click(TOGGLE);
  await browser.until('open', `!!document.querySelector(${js(PANEL)})`);
  await wait(300);
  const open1 = await rect(PAGE), panel = await rect(PANEL);
  assert.ok(open1.w < closed.w - 300, `the page narrowed to make room: ${closed.w} -> ${open1.w}`);
  assert.ok(panel.right >= 1439 && panel.w >= 320 && panel.h >= 800, `a full-height right column: ${JSON.stringify(panel)}`);
  assert.ok(open1.x + open1.w <= panel.x + 1, 'the page and the panel do not overlap');
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'composer-input', 'focus is in the field');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=explore-context-label]').textContent`), 'You are looking at');
  await shots2('1440-2-open');
  await browser.evaluate('window.__clicks = 0');
  await click('[data-testid=page-button]');
  assert.equal(await browser.evaluate('window.__clicks'), 1, 'the page still works beside the panel');
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.until('closed', `!document.querySelector(${js(PANEL)})`);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'explore-toggle', 'focus is back on the toggle');
});

test('1440: a widened panel is remembered across a reload', { skip, timeout: 120000 }, async () => {
  await open(1440);
  await click(TOGGLE);
  await browser.until('open', `!!document.querySelector(${js(PANEL)})`);
  await browser.evaluate(`document.querySelector('[data-testid=explore-resize]').focus()`);
  for (let step = 0; step < 4; step++) await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await wait(200);
  const wider = await rect(PANEL);
  assert.equal(Math.round(wider.w), 384 + 4 * 24, `four steps wider: ${wider.w}`);
  await open(1440, '', { keep: true });
  assert.equal(await count(PANEL), 0, 'a new visit starts closed');
  await click(TOGGLE);
  await browser.until('open', `!!document.querySelector(${js(PANEL)})`);
  assert.equal(Math.round((await rect(PANEL)).w), 384 + 4 * 24, 'the remembered width');
});

test('900: below 1100 the panel overlays the page, which keeps its width', { skip, timeout: 120000 }, async () => {
  await open(900);
  const closed = await rect(PAGE);
  await click(TOGGLE);
  await browser.until('open', `!!document.querySelector(${js(PANEL)})`);
  await wait(300);
  const page = await rect(PAGE), panel = await rect(PANEL);
  assert.equal(Math.round(page.w), Math.round(closed.w), 'the page does not move');
  assert.ok(panel.right >= 899 && panel.x > 400 && panel.h >= 880, `a right panel over the page: ${JSON.stringify(panel)}`);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(PANEL)})).position`), 'fixed');
  await shots2('900-1-overlay');
});

test('390: closed there is no bar; the toggle sits above the tab bar at the bottom right; open is a bottom sheet with a grabber and a close button', { skip, timeout: 120000 }, async () => {
  await open(390);
  assert.equal(await count('[data-testid=agent-layer]'), 0, 'no peek bar');
  const toggle = await rect(TOGGLE);
  const tabBar = await browser.evaluate(`document.querySelector('[aria-label=Navigation]')?.getBoundingClientRect().top ?? null`);
  assert.notEqual(tabBar, null, 'the tab bar is found');
  assert.ok(toggle.right >= 389 && toggle.bottom <= tabBar + 0.5, `bottom right, above the tabs: ${JSON.stringify({ toggle, tabBar })}`);
  assert.ok(toggle.h >= 44, `a 44 px target on a phone: ${toggle.h}`);
  await shots2('390-1-closed');
  await click(TOGGLE);
  await browser.until('sheet', `!!document.querySelector('[data-testid=agent-layer]')`);
  await wait(700);
  const sheet = await rect('[data-testid=agent-layer]');
  assert.ok(sheet.y > 200 && sheet.bottom >= 840, `a bottom sheet, the page visible above it: ${JSON.stringify(sheet)}`);
  assert.equal(await count('[data-slot=drawer-swipe-handle]'), 1, 'a grabber');
  assert.equal(await count('[data-testid=agent-layer-close]'), 1, 'a close button');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=explore-context-title]').textContent`), 'Orders, last 30 days');
  await shots2('390-2-sheet');
  await click('[data-testid=agent-layer-close]');
  await browser.until('closed', `!document.querySelector('[data-testid=agent-layer]')`);
});

test('1440 and 390: a reply that arrives while closed shows as a dot on the toggle, a waiting decision as the ring', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    await open(width);
    await browser.evaluate(`window.__say('answer')`);
    await browser.until('unread', `!!document.querySelector('[data-testid=explore-place] [data-testid=agent-bar-unread]')`, 8000);
    const dot = await rect('[data-testid=explore-place] [data-testid=agent-bar-unread]');
    assert.ok(dot.w >= 5 && dot.x < (await rect(TOGGLE)).x + 8, 'the dot sits on the tab\'s corner');
    await shots2(`${width}-3-unread`);
    await browser.evaluate(`window.__say('approval')`);
    await browser.until('ring', `document.querySelector(${js(TOGGLE)})?.dataset.needsYou === 'true'`, 8000);
    await shots2(`${width}-4-needs-you`);
  }
});

test('1440: in French the toggle says Demander and the line Vous regardez', { skip, timeout: 120000 }, async () => {
  await open(1440, 'fr=1');
  assert.equal(await browser.evaluate(`document.querySelector(${js(TOGGLE)}).textContent`), 'Demander');
  await click(TOGGLE);
  await browser.until('open', `!!document.querySelector(${js(PANEL)})`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=explore-context-label]').textContent`), 'Vous regardez');
  await shot('1440-5-fr', false);
});

test('1440: without a context the line is not drawn', { skip, timeout: 120000 }, async () => {
  await open(1440, 'context=0');
  await click(TOGGLE);
  await browser.until('open', `!!document.querySelector(${js(PANEL)})`);
  assert.equal(await count('[data-testid=explore-context]'), 0);
});
