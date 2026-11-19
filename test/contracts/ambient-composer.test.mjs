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

// `AmbientChat` over the one composer: for the props the composer takes it is the floating composer (same bar, window, icon, remembered place); `onStateChange` and a controlled `state`
// mirror its levels; the old toasts are its notices; a prop it does not take keeps the old window. Real Chromium at 1440 and 390, light and dark. Shots: .cache/evidence/ambient-composer.
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.AMBIENT_COMPOSER_EVIDENCE ?? join(root, '.cache/evidence/ambient-composer');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/ambient-composer-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/ambient-composer.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
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
const place = () => browser.evaluate('window.__layer.place');
const stored = key => browser.evaluate(`localStorage.getItem(${js(key)})`);
const POS_KEY = 'boring-ui:sidebar-composer-pos:harbor:visitor%40example.test';
const PLACE_KEY = 'boring-ui:sidebar-composer-place:harbor:visitor%40example.test';
const mouse = (type, x, y, held = false) => browser.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !held ? 'none' : 'left', buttons: type === 'mouseReleased' || (type === 'mouseMoved' && !held) ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
// A real press on the grip, a path of moves, a release: pointer events all the way.
const dragFrom = async (selector, toX, toY) => {
  const r = await rect(selector), x = r.x + r.w / 2, y = r.y + r.h / 2;
  await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y);
  for (let step = 1; step <= 8; step++) await mouse('mouseMoved', x + (toX - x) * step / 8, y + (toY - y) * step / 8, true);
  await mouse('mouseReleased', toX, toY);
  await wait(150);
};
const tap = async selector => { const r = await rect(selector); const x = r.x + r.w / 2, y = r.y + r.h / 2; await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
const FRAME = '[data-testid=composer-floating]', ICON = '[data-testid=composer-icon]', NOTICE = '[data-testid=notice]';
const LEGACY = '[data-testid=ambient-header]';
const changes = () => browser.evaluate('window.__changes');
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(150); await browser.screenshot(`ambient-composer-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };

test('1440: AmbientChat with props the composer takes is the one composer, floating; the state callback and the controlled state follow its levels', { skip, timeout: 180000 }, async () => {
  await open(1440);
  assert.equal(await count(LEGACY), 0, 'not the old window');
  assert.equal(await count(FRAME), 1, 'the floating composer');
  assert.equal(await browser.evaluate(`document.querySelector('[data-boring=ambient-chat]').dataset.variant`), 'contrast', 'the old root marker stays');
  assert.equal(await browser.evaluate(`document.querySelector('[data-boring=ambient-chat]').classList.contains('dark')`), true, 'contrast is the default: a dark bar on any page');
  const bar = await rect(FRAME);
  assert.ok(bar.right > 1400 && bar.bottom > 860, `bottom right: ${JSON.stringify(bar)}`);
  await browser.evaluate('window.__clicks = 0');
  const target = await rect('[data-testid=page-button]');
  await tap('[data-testid=page-button]');
  assert.equal(await browser.evaluate('window.__clicks'), 1, `the page stays usable under the bar (${JSON.stringify(target)})`);
  await shots2('1440-1-bar');
  await browser.evaluate(`document.querySelector('[data-testid=composer-controller] [data-action=chevron]').click()`);
  await browser.until('the conversation is open', `window.__changes.includes('expanded')`);
  assert.deepEqual(await changes(), ['expanded'], 'opening the conversation is reported as expanded');
  await shots2('1440-2-window');
  await browser.evaluate(`document.querySelector('[data-testid=composer-controller] [data-action=minimise]').click()`);
  await browser.until('folded', `!!document.querySelector(${js(ICON)})`);
  assert.deepEqual(await changes(), ['expanded', 'minimized'], 'folding to the icon is reported as minimized');
  await shots2('1440-3-icon');
  // The host moves it: its own `state` wins, and is not echoed back as a change of the person's.
  await browser.evaluate(`window.__set('bar')`);
  await browser.until('the bar is back', `!document.querySelector(${js(ICON)}) && !!document.querySelector(${js(FRAME)})`);
  await wait(900);
  assert.deepEqual(await changes(), ['expanded', 'minimized'], 'a change the host asked for is not reported');
  await browser.evaluate(`window.__set('minimized')`);
  await browser.until('folded by the host', `!!document.querySelector(${js(ICON)})`);
  await click(ICON);
  await browser.until('restored by the person', `!document.querySelector(${js(ICON)})`);
  assert.notEqual((await changes()).at(-1), 'minimized', 'the icon brings the bar (or the window it was) back, and says so');
});

test('1440: a background conversation\'s toast is the composer\'s notice, Open brings that conversation, a question stays until dismissed', { skip, timeout: 180000 }, async () => {
  await open(1440);
  await browser.evaluate(`window.__push('done')`);
  await browser.until('a notice', `!!document.querySelector(${js(NOTICE)})`);
  assert.match(await browser.evaluate(`document.querySelector(${js(NOTICE)}).textContent`), /Nightly export: Done/);
  assert.equal(await browser.evaluate(`document.querySelector(${js(NOTICE)}).dataset.noticeKind`), 'success');
  const notice = await rect('[data-testid=composer-notices]'), frame = await rect(FRAME);
  assert.ok(notice.y + notice.h <= frame.y + 1, `the notice stands above the bar: ${JSON.stringify({ notice, frame })}`);
  await shots2('1440-4-notice');
  await click('[data-testid=notice-action]');
  await browser.until('the conversation is open', `window.__changes.includes('expanded')`);
  assert.equal(await count(NOTICE), 0, 'opening dismisses it');
  await browser.evaluate(`window.__push('input')`);
  await browser.until('a question', `!!document.querySelector(${js(NOTICE)})`);
  assert.equal(await browser.evaluate(`document.querySelector(${js(NOTICE)}).dataset.noticeKind`), 'warning');
});

test('1440: a prop the composer does not take (onOpenFull) keeps the old window, unchanged', { skip, timeout: 180000 }, async () => {
  await open(1440, 'gap=1');
  assert.equal(await count(LEGACY), 1, 'the old window');
  assert.equal(await count(FRAME), 0, 'not the composer');
});

test('390: on a phone the bar is at the bottom with its grabber, a notice stands above it inside the screen, Minimise folds it to the icon', { skip, timeout: 180000 }, async () => {
  await open(390);
  assert.equal(await count(LEGACY), 0);
  assert.equal(await count('[data-testid=composer-input]') >= 1, true, 'the field is there');
  const field = await rect('[data-testid=composer-input]');
  assert.ok(field.y > 600 && field.right <= 390.5, `at the bottom, inside the screen: ${JSON.stringify(field)}`);
  await shots2('390-1-bar');
  await browser.evaluate(`window.__push('done')`);
  await browser.until('a notice', `!!document.querySelector(${js(NOTICE)})`);
  const notice = await rect(NOTICE);
  assert.ok(notice.x >= 0 && notice.right <= 390.5 && notice.y >= 0 && notice.y + notice.h <= field.y + 1, `the notice is inside the screen and above the field: ${JSON.stringify({ notice, field })}`);
  await shots2('390-2-notice');
  await click('[data-testid=notice-dismiss]');
  await click('[data-testid=composer-minimise]');
  await browser.until('folded', `!!document.querySelector(${js(ICON)})`);
  assert.equal((await changes()).at(-1), 'minimized');
  await shots2('390-3-icon');
});
