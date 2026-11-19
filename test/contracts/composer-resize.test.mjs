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

// The open conversation's top edge is a handle (`shell-composer-resize`): a drag or the keys set the window's height, it is clamped, remembered per app and person, and dropped by Full and Dock;
// the floating window resizes too and stays in the viewport; a phone has no handle. Real Chromium, the real AppShell, real pointer and key input at 1440 and 1280 (and 390), light and dark.
// Shots go to .cache/evidence/composer-resize (named resize-*). In CI a missing browser fails the test (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.COMPOSER_RESIZE_EVIDENCE ?? join(root, '.cache/evidence/composer-resize');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/composer-resize-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/float-composer.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
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
const dragFrom = async (selector, toX, toY, at = 0.5) => {
  const r = await rect(selector), x = r.x + r.w / 2, y = r.y + r.h * at;
  await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y);
  for (let step = 1; step <= 8; step++) await mouse('mouseMoved', x + (toX - x) * step / 8, y + (toY - y) * step / 8, true);
  await mouse('mouseReleased', toX, toY);
  await wait(150);
};
const tap = async selector => { const r = await rect(selector); const x = r.x + r.w / 2, y = r.y + r.h / 2; await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
const FRAME = '[data-testid=composer-floating]', GRIP = '[data-testid=composer-grip]', ICON = '[data-testid=composer-icon]';
const STRIP = `[...document.querySelectorAll('[data-testid=composer-controller] button')].map(b => b.dataset.action)`;
const inViewport = () => browser.evaluate(`(() => { const r = document.querySelector(${js(FRAME)}).getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; })()`);
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(150); await browser.screenshot(`resize-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };
const float = async () => { await browser.evaluate('window.__layer.setPlace("float")'); await browser.until('floating', `!!document.querySelector(${js(FRAME)})`); };

const HANDLE = '[data-testid=composer-resize]', TRAY = '[data-testid=agent-tray]';
const HEIGHT_KEY = 'boring-ui:sidebar-composer-height:harbor:visitor%40example.test';
const trayH = async () => Math.round((await rect(TRAY)).h);
const attr = name => browser.evaluate(`document.querySelector(${js(HANDLE)}).getAttribute(${js(name)})`);
const key = async (name, { shift = false } = {}) => {
  const codes = { Home: 36, End: 35 };
  if (!codes[name]) return browser.press(name, { shift });
  const base = { key: name, code: name, windowsVirtualKeyCode: codes[name], modifiers: shift ? 8 : 0 };
  await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
};
const openTray = async (width, { keep = false, floating = false } = {}) => {
  await open(width, '', { keep });
  if (floating) await float();
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('window open', `!!document.querySelector(${js(TRAY)})`);
  await wait(500);
};
// The handle's middle sits on the window's top border; a press there starts the drag.
const dragBy = async dy => {
  const r = await rect(HANDLE), x = r.x + r.w * 0.2, y = r.y + r.h / 2;
  await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y);
  for (let step = 1; step <= 8; step++) await mouse('mouseMoved', x + 10, y + dy * step / 8, true);
  await mouse('mouseReleased', x + 10, y + dy);
  await wait(200);
};

for (const width of [1440, 1280]) {
  test(`${width}: dragging the top edge of the open window makes it taller or shorter, within a minimum and the header; keys step it; a double-click resets; it is remembered after a reload`, { skip, timeout: 240000 }, async () => {
    await openTray(width);
    assert.equal(await count(HANDLE), 1, 'one handle on the open window');
    assert.equal(await attr('role'), 'separator');
    assert.equal(await attr('aria-orientation'), 'horizontal');
    assert.equal(await attr('aria-label'), 'Resize the conversation', 'named from the labels');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(HANDLE)})).cursor`), 'ns-resize');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(HANDLE)})).touchAction`), 'none');
    const start = await trayH();
    assert.ok(Math.abs(start - 270) <= 2, `the default is 30dvh of 900: ${start}`);
    assert.equal(Number(await attr('aria-valuenow')), start, 'aria-valuenow is the height');
    const min = Number(await attr('aria-valuemin')), max = Number(await attr('aria-valuemax'));
    assert.ok(min >= 200 && min < start && max > 600, `a minimum and a maximum: ${min}..${max}`);
    const strip = await rect('[data-testid=composer-controller] [data-action=chevron]');
    assert.equal(await browser.evaluate(`document.elementFromPoint(${strip.x + strip.w / 2}, ${strip.y + strip.h / 2}).closest('button')?.dataset.action ?? null`), 'chevron', 'the strip stays on top of the handle: its button is what a press there reaches');
    await shots2(`${width}-1-default`);

    await dragBy(-100);
    const taller = await trayH();
    assert.ok(Math.abs(taller - (start + 100)) <= 3, `dragging up 100 px grows the window by 100: ${start} -> ${taller}`);
    assert.equal(Number(await attr('aria-valuenow')), taller);
    assert.equal(await stored(HEIGHT_KEY), String(taller), 'remembered per app and person');
    await shots2(`${width}-3-tall`);
    await dragBy(60);
    const shorter = await trayH();
    assert.ok(Math.abs(shorter - (taller - 60)) <= 3, `dragging down 60 px shrinks it by 60: ${taller} -> ${shorter}`);
    assert.equal(await count('[data-testid=agent-tray-body]'), 1);
    await dragBy(-2000);
    const top = await trayH();
    assert.equal(top, Number(await attr('aria-valuemax')), `clamped at the maximum: ${top}`);
    assert.ok((await rect(TRAY)).y >= (await rect('[data-testid=agent-content]')).y, 'never above the content column (the header)');
    await dragBy(2000);
    assert.equal(await trayH(), min, 'clamped at the minimum');
    await shots2(`${width}-2-small`);
    assert.equal(await browser.evaluate('getComputedStyle(document.body).userSelect'), 'auto', 'no text selection kept after the drag');

    await browser.evaluate(`document.querySelector(${js(HANDLE)}).focus()`);
    await key('ArrowUp');
    assert.equal(await trayH(), min + 24, 'ArrowUp: +24');
    await key('ArrowUp', { shift: true });
    assert.equal(await trayH(), min + 24 + 96, 'Shift+ArrowUp: +96');
    await key('ArrowDown');
    assert.equal(await trayH(), min + 96, 'ArrowDown: -24');
    await key('End');
    assert.equal(await trayH(), max, 'End: the maximum');
    await key('Home');
    assert.equal(await trayH(), min, 'Home: the minimum');
    await key('ArrowUp', { shift: true });
    await key('Enter');
    assert.equal(await trayH(), start, 'Enter: back to the default');
    assert.equal(await stored(HEIGHT_KEY), null, 'the default is not stored');

    await dragBy(-120);
    const kept = await trayH();
    await browser.evaluate(`window.__layer.close()`);
    await browser.until('window closed', `!document.querySelector(${js(TRAY)})`);
    await open(width, '', { keep: true });
    await click('[data-testid=agent-bar-conversation]');
    await browser.until('window open', `!!document.querySelector(${js(TRAY)})`);
    await wait(500);
    assert.equal(await trayH(), kept, 'the height is restored after a reload');
    await browser.evaluate(`document.querySelector(${js(HANDLE)}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await wait(150);
    assert.equal(await trayH(), start, 'a double-click resets it');
  });

  test(`${width}: Expand and Collapse still move between levels; Full and Dock drop the dragged height; the strip's buttons still work`, { skip, timeout: 180000 }, async () => {
    await openTray(width);
    const start = await trayH();
    await dragBy(-120);
    const dragged = await trayH();
    const reopen = async () => {
      await click('[data-testid=composer-controller] [data-action=chevron]');
      await browser.until('window closed', `!document.querySelector(${js(TRAY)})`);
      await click('[data-testid=agent-bar-conversation]');
      await browser.until('window open', `!!document.querySelector(${js(TRAY)})`);
      await wait(500);
    };
    await reopen();
    assert.equal(await trayH(), dragged, 'the strip chevron closes and reopens; the height is the same');
    await click('[data-testid=composer-controller] [data-action=more]');
    await wait(500);
    const grown = await trayH();
    assert.ok(grown > dragged && Math.abs(grown - 630) <= 3, `Expand goes to the grown level (70dvh), not the dragged height: ${grown}`);
    assert.equal(await count(HANDLE), 1, 'the grown window has the handle');
    await reopen();
    assert.equal(await trayH(), dragged, 'Collapse and reopen return to the tray level at the dragged height');
    await click('[data-testid=composer-controller] [data-action=full]');
    await wait(500);
    assert.equal(await stored(HEIGHT_KEY), null, 'Full drops the dragged height');
    await click('[data-testid=agent-full-back]');
    await wait(500);
    assert.equal(await trayH(), 630, 'back from Full is the grown level');
    await reopen();
    assert.ok(Math.abs(await trayH() - start) <= 2, `after Full the tray is at its default again: ${await trayH()}`);
    await dragBy(-90);
    assert.ok(await stored(HEIGHT_KEY));
    await click('[data-testid=composer-controller] [data-action=split]');
    await wait(500);
    assert.equal(await stored(HEIGHT_KEY), null, 'Dock drops the dragged height');
    await browser.evaluate(`Object.keys(localStorage).filter(name => name.startsWith('boring-ui:sidebar-agent')).forEach(name => localStorage.removeItem(name))`);
  });
}

test('1440: the floating window resizes from its top edge and stays inside the viewport, also from a top corner', { skip, timeout: 240000 }, async () => {
  await openTray(1440, { floating: true });
  const start = await trayH();
  assert.equal(await count(HANDLE), 1, 'the floating window has the handle');
  await shots2('floating-1-default');
  await dragBy(-120);
  const taller = await trayH();
  assert.ok(Math.abs(taller - (start + 120)) <= 3, `up grows the floating window: ${start} -> ${taller}`);
  await shots2('floating-2-tall');
  await dragBy(-3000);
  assert.ok((await rect(TRAY)).y >= 0 && await inViewport(), 'at its maximum the window is still inside the viewport');
  await shots2('floating-3-max');
  await browser.evaluate(`document.querySelector(${js(HANDLE)}).focus()`);
  await key('Home');
  assert.equal(Number(await attr('aria-valuenow')), Number(await attr('aria-valuemin')));
  await key('ArrowUp', { shift: true });
  const strip = await rect('[data-testid=composer-controller] [data-action=dock]');
  assert.ok(strip, 'the strip buttons are there');
  await click('[data-testid=composer-controller] [data-action=chevron]');
  await browser.until('window closed', `!document.querySelector(${js(TRAY)})`);
  await dragFrom(GRIP, 30, 30);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('window open', `!!document.querySelector(${js(TRAY)})`);
  await wait(500);
  await browser.evaluate(`document.querySelector(${js(HANDLE)}).focus()`);
  await key('End');
  await wait(400);
  assert.ok((await rect(TRAY)).y >= 0 && await inViewport(), 'from a top corner at the maximum the window and the bar are inside the viewport');
  await wait(100);
});

test('1440: a smaller window brings a tall window back inside the viewport; the remembered height follows', { skip, timeout: 120000 }, async () => {
  await openTray(1440);
  await dragBy(-2000);
  const before = await trayH();
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false });
  await wait(500);
  const after = await trayH();
  assert.ok(after < before && (await rect(TRAY)).y >= (await rect('[data-testid=agent-content]')).y, `re-clamped on resize: ${before} -> ${after}`);
  assert.equal(after, Number(await attr('aria-valuemax')));
  assert.equal(await stored(HEIGHT_KEY), String(after));
});

for (const floating of [false, true]) {
  test(`1440: the handle shows a 2 px line and a grip bar on hover and on keyboard focus (${floating ? 'floating' : 'tray'})`, { skip, timeout: 120000 }, async () => {
    await openTray(1440, { floating });
    const marks = () => browser.evaluate(`[...document.querySelector(${js(HANDLE)}).children].map(e => Number(getComputedStyle(e).opacity))`);
    assert.deepEqual(await marks(), [0, 0], 'nothing drawn at rest');
    const r = await rect(HANDLE);
    await mouse('mouseMoved', r.x + r.w * 0.2, r.y + r.h / 2);
    await wait(300);
    assert.deepEqual(await marks(), [1, 1], 'hover: the line and the grip');
    await shots2(`${floating ? 'floating' : '1440'}-4-hover`);
    await mouse('mouseMoved', 5, 5);
    await wait(300);
    assert.deepEqual(await marks(), [0, 0]);
    await browser.evaluate(`document.querySelector(${js(HANDLE)}).focus()`);
    await key('ArrowUp');
    await mouse('mouseMoved', 5, 5);
    await wait(300);
    assert.deepEqual(await marks(), [1, 1], 'keyboard focus: the line and the grip');
    await shots2(`${floating ? 'floating' : '1440'}-5-focus`);
  });
}

test('390: a phone has no resize handle; the grabber keeps driving the sheet', { skip, timeout: 120000 }, async () => {
  await open(390);
  await click('[data-testid=agent-bar-conversation]');
  await wait(600);
  assert.equal(await count(HANDLE), 0, 'no handle on a phone');
  assert.equal(await count('[data-slot=drawer-swipe-handle]'), 1, 'the grabber is there');
});

test('French: the handle is named from the locale', { skip, timeout: 60000 }, async () => {
  await open(1440, 'fr=1');
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('window open', `!!document.querySelector(${js(TRAY)})`);
  assert.equal(await attr('aria-label'), 'Redimensionner la conversation');
});
