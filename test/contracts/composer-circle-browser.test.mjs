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

// `launcher: 'circle'` in real Chromium (the real AppShell and FloatingComposer over a page of data): the circle, the panel, Open in full to the app's page and a reload, the 390 px sheet, a crowded
// bottom right (two launchers stacking, a drawer tab they step around, a toast reading the published reserve) and annotating (the panel steps aside, the circle counts the notes, Esc in order).
// Screenshots (light and dark, 1440 and 390) go to `.cache/evidence/composer-circle` (or COMPOSER_CIRCLE_EVIDENCE).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.COMPOSER_CIRCLE_EVIDENCE ?? join(root, '.cache/evidence/composer-circle');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/composer-circle-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/composer-circle.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'pi-chat-mentions', 'pi-chat-attachments', 'pi-chat-slash', 'agent-bar', 'feedback'].map(name => registryCss(item(name))).join('\n')}`;
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
  await browser.until('mounted', `!!document.querySelector('[data-testid=orders]') && document.readyState === 'complete'`);
  await wait(500);
};
const rect = selector => browser.evaluate(`(() => { const e = document.querySelector(${js(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`);
const count = selector => browser.evaluate(`document.querySelectorAll(${js(selector)}).length`);
const click = selector => browser.evaluate(`document.querySelector(${js(selector)}).click()`);
const key = (name, code = name, windowsVirtualKeyCode = 27) => browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode });
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(250); await browser.screenshot(`circle-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };
const CIRCLE = '[data-testid=composer-circle]', BOX = '[data-testid=composer-circle-box]', PANEL = '[data-testid=composer-circle-panel]';
const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;

test('1440: the circle sits at the bottom right with a reserve under it; one tap opens the panel in place, Open in full hands the id to the app, the panel closes, the circle hides; a reload starts at the circle', { skip, timeout: 180000 }, async () => {
  await open(1440);
  const circle = await rect(BOX);
  assert.ok(circle && Math.abs(circle.w - 52) <= 1 && Math.abs(circle.right - 1424) <= 1 && Math.abs(circle.bottom - 884) <= 1, `a 52 px circle, 16 px from the corner: ${JSON.stringify(circle)}`);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(BOX)})).zIndex`), '40', 'launchers are at layer 40, under the app sheets');
  assert.ok((await browser.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--composer-reserve-block')`)).length > 0, 'the page reserve is published');
  const page = await rect('[data-testid=screen-orders]');
  assert.ok(page.bottom >= 880, 'the page runs to the foot of the window');
  assert.equal(await browser.evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-testid=screen-orders]')).paddingBottom)`), 68, 'and keeps 68 px free under the circle (52 + 16)');
  await shots2('1440-1-circle');
  await click(CIRCLE);
  await browser.until('panel', `!!document.querySelector(${js(PANEL)})`);
  await wait(300);
  const panel = await rect(PANEL);
  assert.ok(panel.w >= 380 && panel.h >= 500 && Math.abs(panel.right - 1424) <= 1 && Math.abs(panel.bottom - 884) <= 1, `the window sits where the circle was: ${JSON.stringify(panel)}`);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(PANEL)})).zIndex`), '41', 'panels are one above their launcher');
  assert.equal(await count('[data-testid=agent-bar-conversation], [data-testid=composer-floating]'), 0, 'no folded bar step');
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'composer-input', 'focus is in the field');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-open-full]').disabled`), true, 'Open in full waits for a first message');
  await browser.evaluate(`window.__say('How do I export?')`);
  await browser.until('enabled', `document.querySelector('[data-testid=composer-open-full]').disabled === false`, 8000);
  await shots2('1440-2-panel');
  await click('[data-testid=composer-open-full]');
  await browser.until('page', `!!document.querySelector('[data-testid=support-page]')`);
  assert.deepEqual(await browser.evaluate('window.__opened'), ['demo'], 'the app got the conversation id');
  assert.equal(await count(PANEL), 0, 'the panel closed after the hand-off');
  assert.equal(await count(BOX), 0, 'the circle hides while the page shows');
  await open(1440, '', { keep: true });
  assert.equal(await count(PANEL), 0, 'after a reload nothing is left open');
  assert.equal(await count(CIRCLE), 1, 'the circle is back at rest');
  await click(CIRCLE);
  await browser.until('panel', `!!document.querySelector(${js(PANEL)})`);
  await key('Escape');
  await browser.until('closed', `!document.querySelector(${js(PANEL)})`);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'composer-circle', 'Esc closes the panel and focus returns to the circle');
});

test('390: the circle sits above the tab bar, a tap opens the bottom sheet with Open in full and Close, and the update notice row keeps clear of the circle', { skip, timeout: 180000 }, async () => {
  await open(390, 'notice=1');
  const circle = await rect(BOX);
  const tabBar = await browser.evaluate(`document.querySelector('[aria-label=Navigation]')?.getBoundingClientRect().top ?? null`);
  assert.notEqual(tabBar, null, 'the tab bar is found');
  assert.ok(circle.right >= 373 && circle.bottom <= tabBar + 0.5 && tabBar - circle.bottom <= 20, `bottom right, 16 px above the tabs: ${JSON.stringify({ circle, tabBar })}`);
  const alert = await rect('[data-testid=notice] [role=status]');
  assert.ok(alert && !overlaps(alert, circle), `the notice row ends before the circle: ${JSON.stringify({ alert, circle })}`);
  await shots2('390-1-circle');
  await click(CIRCLE);
  await browser.until('sheet', `!!document.querySelector('[data-testid=agent-layer]')`);
  await wait(700);
  const sheet = await rect('[data-testid=agent-layer]');
  assert.ok(sheet.y > 100 && sheet.bottom >= 840, `a bottom sheet with the page visible above it: ${JSON.stringify(sheet)}`);
  assert.equal(await count('[data-testid=agent-layer-close]'), 1, 'a Close');
  assert.equal(await count('[data-testid=composer-open-full]'), 1, 'and Open in full');
  assert.equal(await count('[data-testid=agent-layer-expand], [data-testid=agent-layer-collapse]'), 0, 'one size');
  await shots2('390-2-sheet');
  await click('[data-testid=agent-layer-close]');
  await browser.until('closed', `!document.querySelector('[data-testid=agent-layer]')`);
  assert.equal(await count(BOX), 1, 'the circle is back');
});

test('1440 and 390: a crowded corner: two launchers stack, step left of the drawer tab, and a toast lands above the stack', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    await open(width, 'scene=crowded');
    const boxes = await browser.evaluate(`[...document.querySelectorAll(${js(BOX)})].map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.composer, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })`);
    assert.equal(boxes.length, 2, `${width}: two launchers`);
    const [support, pm] = ['support', 'pm'].map(id => boxes.find(box => box.id === id));
    assert.ok(Math.abs(support.bottom - (width < 768 ? 828 : 884)) <= 1 + (width < 768 ? 60 : 0) && pm.bottom < support.y, `${width}: the second sits above the first: ${JSON.stringify({ support, pm })}`);
    assert.ok(Math.abs((support.y - pm.bottom) - 12) <= 1, `${width}: 12 px apart`);
    const tab = await rect('[data-testid=drawer-tab]');
    assert.ok(!overlaps(support, tab) && !overlaps(pm, tab), `${width}: both step left of the drawer tab: ${JSON.stringify({ support, pm, tab })}`);
    assert.ok(tab.x - support.right >= 7 && tab.x - pm.right >= 7, `${width}: with a gap`);
    const toast = await rect('[data-testid=toast]');
    assert.ok(toast.bottom <= pm.y - 8 && !overlaps(toast, tab), `${width}: the toast reads the reserve, lands above the stack and clear of the tab: ${JSON.stringify({ toast, pm, tab })}`);
    await shots2(`${width}-3-crowded`);
    await click(`[data-composer=pm] ${CIRCLE}`);
    await browser.until('panel', `!!document.querySelector('[data-testid=composer-circle-panel], [data-testid=agent-layer]')`);
    await wait(600);
    if (width >= 768) {
      const panel = await rect(PANEL);
      assert.ok(!overlaps(panel, tab), `${width}: the panel docks beside the drawer tab too: ${JSON.stringify({ panel, tab })}`);
    }
    await shots2(`${width}-4-crowded-panel`);
  }
});

test('1440: annotating: the panel steps aside to the circle, the circle counts the notes, Esc ends annotating and then closes the panel', { skip, timeout: 180000 }, async () => {
  await open(1440, 'scene=feedback');
  await click(CIRCLE);
  await browser.until('panel', `!!document.querySelector(${js(PANEL)})`);
  assert.equal(await count('[data-testid=composer-annotate]'), 1, 'the pointing tool has its toggle in the field...');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=composer-annotate]')).display`), 'none', '...hidden in the panel: the toggle is in the title row');
  assert.equal(await count('[data-testid=composer-controller] [data-testid=composer-annotate-title]'), 1, 'the title row has the annotate toggle');
  await shots2('1440-5-before-annotating');
  await click('[data-testid=composer-annotate-title]');
  await browser.until('collapsed', `!document.querySelector(${js(PANEL)}) && !!document.querySelector(${js(CIRCLE)}) && !!document.querySelector('[data-testid=feedback-point-bar]')`);
  const cell = await rect('[data-testid=orders] tbody tr:nth-child(2) td:nth-child(3)');
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cell.x + 8, y: cell.y + 8 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cell.x + 8, y: cell.y + 8, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cell.x + 8, y: cell.y + 8, button: 'left', clickCount: 1 });
  await browser.until('bubble', `!!document.querySelector('[data-testid=feedback-bubble-input]')`);
  await browser.evaluate(`(() => { const f = document.querySelector('[data-testid=feedback-bubble-input]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(f, 'This total looks wrong'); f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('[data-testid=feedback-bubble-save]');
  await browser.until('count', `document.querySelector('[data-testid=composer-circle-notes]')?.dataset.count === '1'`);
  await shots2('1440-6-annotating');
  await key('Escape');
  await browser.until('panel back', `!!document.querySelector(${js(PANEL)})`);
  assert.equal(await count('[data-testid=feedback-point-bar]'), 0, 'the first Esc ended annotating...');
  await key('Escape');
  await browser.until('closed', `!document.querySelector(${js(PANEL)})`);
  assert.equal(await count(CIRCLE), 1, '...and the second closed the panel');
});

test('390: annotating on a phone: point mode, the sheet steps aside, a tap pins a note, Done brings the sheet back', { skip, timeout: 180000 }, async () => {
  await open(390, 'scene=feedback');
  await click(CIRCLE);
  await browser.until('sheet', `!!document.querySelector('[data-testid=agent-layer]')`);
  await wait(700);
  assert.equal(await count('[data-testid=composer-controller] [data-testid=composer-annotate-title]'), 1, 'the sheet\'s title row has the annotate toggle');
  await shots2('390-5-before-annotating');
  await click('[data-testid=composer-annotate-title]');
  await browser.until('collapsed', `!document.querySelector('[data-testid=agent-layer]') && !!document.querySelector('[data-testid=feedback-point-bar]')`);
  const cell = await rect('[data-testid=orders] tbody tr:nth-child(2) td:nth-child(3)');
  const at = { x: cell.x + 10, y: cell.y + 10 };
  await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await browser.until('bubble', `!!document.querySelector('[data-testid=feedback-bubble-input]')`);
  await browser.evaluate(`(() => { const f = document.querySelector('[data-testid=feedback-bubble-input]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(f, 'This total looks wrong'); f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('[data-testid=feedback-bubble-save]');
  await browser.until('count', `document.querySelector('[data-testid=composer-circle-notes]')?.dataset.count === '1'`);
  await shots2('390-6-annotating');
  await click('[data-testid=feedback-point-done]');
  await browser.until('sheet back', `!!document.querySelector('[data-testid=agent-layer]')`);
});
