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

// One composer, three places: the shell's bar floats over a page (a grip moves it by pointer and by arrow keys, a corner catches it, the place is remembered), folds to a round icon
// that counts what is unread and rings when a decision waits, and a phone keeps the bar at the bottom. Real Chromium, the real AppShell (`floatingComposer`) and the standalone
// `FloatingComposer` on a plain page, at 1440 and 390, light and dark. Shots go to .cache/evidence/floating-composer (named floating-*). In CI a missing browser fails the test (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.FLOATING_COMPOSER_EVIDENCE ?? join(root, '.cache/evidence/floating-composer');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/floating-composer-'));
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
const dragFrom = async (selector, toX, toY) => {
  const r = await rect(selector), x = r.x + r.w / 2, y = r.y + r.h / 2;
  await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y);
  for (let step = 1; step <= 8; step++) await mouse('mouseMoved', x + (toX - x) * step / 8, y + (toY - y) * step / 8, true);
  await mouse('mouseReleased', toX, toY);
  await wait(150);
};
const tap = async selector => { const r = await rect(selector); const x = r.x + r.w / 2, y = r.y + r.h / 2; await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
const FRAME = '[data-testid=composer-floating]', GRIP = '[data-testid=composer-grip]', ICON = '[data-testid=composer-icon]';
const STRIP = `[...document.querySelectorAll('[data-testid=composer-controller] button')].map(b => b.dataset.action)`;
const inViewport = () => browser.evaluate(`(() => { const r = document.querySelector(${js(FRAME)}).getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; })()`);
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(150); await browser.screenshot(`floating-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };
const float = async () => { await browser.evaluate('window.__layer.setPlace("float")'); await browser.until('floating', `!!document.querySelector(${js(FRAME)})`); };

test('1440: Float detaches the bar over a usable page; the grip moves it by pointer, a corner catches it, arrow keys move it, and the place is remembered after a reload', { skip, timeout: 180000 }, async () => {
  await open(1440);
  assert.equal(await place(), 'bottom', 'starts at the bottom, as today');
  assert.equal(await count(FRAME), 0, 'nothing floats yet');
  const bottom = await rect('[data-testid=agent-composer-box]');
  assert.ok(bottom && bottom.y > 700, `the bar is at the bottom: ${JSON.stringify(bottom)}`);
  assert.deepEqual(await browser.evaluate(STRIP), ['chevron', 'full', 'float', 'minimise'], 'the strip at the bottom gains Float and Minimise');
  await shots2('1440-1-bottom');
  await browser.evaluate(`document.querySelector('[data-testid=composer-controller] [data-action=float]').click()`);
  await browser.until('floating', `!!document.querySelector(${js(FRAME)})`);
  assert.equal(await place(), 'float');
  assert.equal(await stored(PLACE_KEY), 'float', 'the choice is remembered per app and person');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(FRAME)})).position`), 'fixed', 'detached: fixed over the page');
  assert.equal(await count('[data-testid=agent-composer-box] [data-testid=composer-input]'), 1, 'one field');
  const grip = await rect(GRIP);
  assert.ok(grip && grip.w >= 28 && grip.h >= 44, `the grip is a tall rail on the bar's left: ${JSON.stringify(grip)}`);
  assert.equal(await browser.evaluate(`document.querySelector(${js(GRIP)}).getAttribute('aria-label')`), 'Move the assistant', 'named from the labels');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(GRIP)})).cursor`), 'grab');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${js(GRIP)})).touchAction`), 'none');
  assert.deepEqual(await browser.evaluate(STRIP), ['chevron', 'dock', 'minimise'], 'floating strip: Expand, Dock to the bottom, Minimise');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-controller] [data-action=dock]').getAttribute('aria-label')`), 'Dock to the bottom');
  const corner = await rect(FRAME);
  assert.ok(corner.right > 1400 && corner.bottom > 860, `starts in the bottom right corner: ${JSON.stringify(corner)}`);
  // The page stays usable around it and reaches the bottom: the bar takes no room from it.
  await browser.evaluate('window.__clicks = 0');
  await tap('[data-testid=page-button]');
  assert.equal(await browser.evaluate('window.__clicks'), 1, 'the page button still works with the bar floating');
  assert.ok(await browser.evaluate(`document.querySelector('[data-testid=agent-page]').getBoundingClientRect().bottom > 850`), 'the page reaches the bottom');
  await shots2('1440-2-floating');
  // Pointer: drag the grip to the middle of the window; the bar follows by the amount moved and stays there.
  const before = await rect(FRAME);
  await dragFrom(GRIP, 700, 400);
  const moved = await rect(FRAME);
  assert.ok(Math.abs(moved.x - (before.x + (700 - (grip.x + grip.w / 2)))) < 3 && Math.abs(moved.y - (before.y + (400 - (grip.y + grip.h / 2)))) < 3, `dropped where it was let go: ${JSON.stringify({ before, moved })}`);
  assert.deepEqual(JSON.parse(await stored(POS_KEY)), { left: Math.round(moved.x), top: Math.round(moved.y) }, 'a free drop is remembered as it is');
  assert.equal(await browser.evaluate(`document.querySelector(${js(FRAME)}).dataset.corner ?? ''`), '', 'far from a corner: it stays free');
  // A press on the grip without a move changes nothing.
  const g2 = await rect(GRIP); await mouse('mouseMoved', g2.x + 5, g2.y + 20); await mouse('mousePressed', g2.x + 5, g2.y + 20); await mouse('mouseReleased', g2.x + 5, g2.y + 20);
  assert.deepEqual(await rect(FRAME), moved, 'a click on the grip does not move the bar');
  // Reload: the place is remembered.
  await open(1440, '', { keep: true });
  await browser.until('floating again', `!!document.querySelector(${js(FRAME)})`);
  await wait(300);
  const again = await rect(FRAME);
  assert.ok(Math.abs(again.x - moved.x) < 2 && Math.abs(again.y - moved.y) < 2, `remembered after a reload: ${JSON.stringify({ moved, again })}`);
  // Keyboard: the grip takes focus; arrows move 16 px, Shift+arrow 64 px.
  await browser.evaluate(`document.querySelector(${js(GRIP)}).focus()`);
  for (let i = 0; i < 3; i++) await browser.press('ArrowLeft');
  await wait(100);
  const keyed = await rect(FRAME);
  assert.equal(Math.round(keyed.x - again.x), -48, `three arrows left: 48 px: ${JSON.stringify({ again, keyed })}`);
  await browser.press('ArrowUp', { shift: true });
  await wait(100);
  assert.equal(Math.round((await rect(FRAME)).y - keyed.y), -64, 'Shift+Arrow moves 64 px');
  assert.equal(await browser.evaluate(`document.activeElement === document.querySelector(${js(GRIP)})`), true, 'the grip keeps focus while it moves the bar');
  for (let i = 0; i < 30; i++) await browser.press('ArrowRight', { shift: true });
  await wait(100);
  assert.ok(await inViewport(), 'arrow keys stop at the window edge');
  // A corner catches a drop that ends near it.
  await dragFrom(GRIP, 40, 60);
  assert.equal(await browser.evaluate(`document.querySelector(${js(FRAME)}).dataset.corner`), 'tl', 'dropped near the top left: it snaps there');
  assert.deepEqual(JSON.parse(await stored(POS_KEY)), { corner: 'tl' });
  const tl = await rect(FRAME);
  assert.ok(Math.abs(tl.x - 16) < 1.5 && Math.abs(tl.y - 16) < 1.5, `16 px from the corner: ${JSON.stringify(tl)}`);
  await shots2('1440-2b-corner-top-left');
  // A smaller window keeps a free bar inside it.
  await dragFrom(GRIP, 1300, 500);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
  await wait(400);
  assert.ok(await inViewport(), 'a smaller window keeps the bar inside it');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
});

test('1440: the window above the bar grows with Expand, has its own grip, Collapse closes it; Dock to the bottom puts the bar back in the page', { skip, timeout: 120000 }, async () => {
  await open(1440);
  await float();
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('window open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await wait(400);
  assert.equal(await browser.evaluate(`document.querySelector(${js(FRAME)}).contains(document.querySelector('[data-testid=agent-tray]'))`), true, 'the window is part of the floating bar');
  const tray = await rect('[data-testid=agent-tray]'), bar = await rect('[data-testid=agent-composer-box]');
  assert.ok(tray.bottom <= bar.y + bar.h / 2 && tray.h > 150 && tray.h < 600, `a small window above the bar: ${JSON.stringify({ tray, bar })}`);
  assert.equal(await count('[data-testid=composer-grip-tray]'), 1, 'its header has the grip');
  assert.deepEqual(await browser.evaluate(STRIP), ['chevron', 'dock', 'minimise']);
  assert.equal(await count('[data-testid=agent-tray-dock]'), 0, 'no side dock beside a floating bar');
  await shots2('1440-3-floating-grown');
  const before = await rect(FRAME);
  await dragFrom('[data-testid=composer-grip-tray]', 500, 450);
  assert.ok(Math.abs((await rect(FRAME)).x - before.x) > 100, 'the tray grip moves the whole window');
  assert.ok((await rect('[data-testid=agent-tray]')).y >= 0, 'the window stays on screen');
  await click('[data-testid=composer-controller] [data-action=chevron]');
  await browser.until('window closed', `!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await place(), 'float', 'Collapse returns to the bar, still floating');
  // From a top corner the window still fits: the bar keeps room for it.
  await dragFrom(GRIP, 30, 30);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('window open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await wait(400);
  assert.ok((await rect('[data-testid=agent-tray]')).y >= 0, 'from a top corner the window still fits above the bar');
  await click('[data-testid=composer-controller] [data-action=dock]');
  await browser.until('docked', `!document.querySelector(${js(FRAME)})`);
  assert.equal(await place(), 'bottom');
  assert.ok((await rect('[data-testid=agent-composer-box]')).y > 600, 'back at the bottom of the page');
  assert.equal(await count('[data-testid=agent-content-composer] [data-testid=composer-input]'), 1);
});

test('1440: Minimise folds the bar to a round icon: the unread count, the needs-you ring, a tap puts back the bar or the window where it was', { skip, timeout: 180000 }, async () => {
  await open(1440);
  await float();
  await click('[data-testid=composer-controller] [data-action=minimise]');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  assert.equal(await place(), 'icon');
  assert.equal(await count(FRAME), 0, 'the bar is folded away');
  assert.equal(await browser.evaluate(`document.querySelector(${js(ICON)}).getAttribute('aria-label')`), 'Open the assistant');
  const icon = await rect(ICON);
  assert.ok(icon.w >= 44 && icon.h >= 44 && Math.abs(icon.w - icon.h) < 1, `a 44 px or more target: ${JSON.stringify(icon)}`);
  assert.ok(icon.right > 1400 && icon.bottom > 860, 'in the corner the bar was in ' + JSON.stringify(icon));
  assert.equal(await browser.evaluate(`document.activeElement === document.querySelector(${js(ICON)})`), true, 'focus lands on the icon');
  assert.equal(await count('[data-testid=composer-icon] [data-testid=agent-bar-unread]'), 0, 'nothing new: no mark');
  await browser.evaluate('document.activeElement.blur()');
  await shots2('1440-4-icon');
  // A reply arrives while folded: a dot, then a count from two.
  await browser.evaluate(`window.__say('answer')`);
  await browser.until('unread dot', `!!document.querySelector('[data-testid=composer-icon] [data-testid=agent-bar-unread]')`, 8000);
  await browser.evaluate(`window.__say('answer')`);
  await browser.until('unread count', `document.querySelector('[data-testid=composer-icon] [data-testid=agent-bar-unread]')?.dataset.count === '2'`, 8000);
  assert.match(await browser.evaluate(`document.querySelector(${js(ICON)}).getAttribute('aria-label')`), /New reply.*2/, 'the count is in the icon\'s name');
  await shots2('1440-4b-icon-count');
  // A decision that waits rings the icon.
  await browser.evaluate(`window.__say('approval')`);
  await browser.until('ring', `document.querySelector(${js(ICON)})?.dataset.needsYou === 'true'`, 8000);
  await shots2('1440-4c-icon-needs-you');
  // Reload while folded: still an icon; a tap brings the floating bar back.
  await open(1440, '', { keep: true });
  await browser.until('icon again', `!!document.querySelector(${js(ICON)})`);
  await click(ICON);
  await browser.until('back', `!!document.querySelector(${js(FRAME)})`);
  assert.equal(await place(), 'float', 'a tap restores the floating bar');
  assert.equal(await count(ICON), 0);
  await wait(300);
  assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('[data-testid=agent-composer-box] [data-testid=composer-input]')`), true, 'focus goes to the field');
  // A grown window folds with the bar and comes back grown.
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('window open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=composer-controller] [data-action=minimise]');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'the window folds with the bar');
  await click(ICON);
  await browser.until('window back', `!!document.querySelector('[data-testid=agent-tray]') && !!document.querySelector(${js(FRAME)})`);
  assert.equal(await place(), 'float', 'the window comes back, floating');
  // From the bottom, Minimise folds and a tap returns to the bottom.
  await click('[data-testid=composer-controller] [data-action=chevron]');
  await click('[data-testid=composer-controller] [data-action=dock]');
  await browser.until('bottom', `!document.querySelector(${js(FRAME)})`);
  await click('[data-testid=composer-controller] [data-action=minimise]');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  await click(ICON);
  await browser.until('bottom again', `!document.querySelector(${js(ICON)})`);
  assert.equal(await place(), 'bottom');
});

test('1440: without floatingComposer the shell is as it was: no Float, no Minimise, no grip', { skip, timeout: 60000 }, async () => {
  await open(1440, 'plain=1');
  assert.deepEqual(await browser.evaluate(STRIP), ['chevron', 'full']);
  await browser.evaluate('window.__layer.setPlace("float")');
  await wait(200);
  assert.equal(await place(), 'bottom', 'setPlace does nothing');
  assert.equal(await count(FRAME), 0);
});

test('390: no floating mode on a phone: the bar stays at the bottom with its grabber, Minimise gives a round icon above the tab bar, a tap restores', { skip, timeout: 120000 }, async () => {
  await open(390);
  assert.equal(await place(), 'bottom');
  assert.equal(await count('[data-testid=composer-float]'), 0, 'no Float action');
  assert.equal(await count(GRIP), 0, 'no grip');
  await browser.evaluate('window.__layer.setPlace("float")');
  await wait(300);
  assert.equal(await place(), 'bottom', 'a phone never floats: float reads as bottom');
  assert.equal(await count(FRAME), 0);
  const field = await rect('[data-testid=composer-input]');
  assert.ok(field && field.y > 600, `the bar is at the bottom: ${JSON.stringify(field)}`);
  const minimise = await rect('[data-testid=composer-minimise]');
  assert.ok(minimise && minimise.w >= 44 && minimise.h >= 44, `Minimise is a 44 px target: ${JSON.stringify(minimise)}`);
  await shots2('390-1-bottom');
  await browser.evaluate(`document.querySelector('[data-testid=composer-minimise]').click()`);
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  const icon = await rect(ICON);
  assert.ok(icon.w >= 44 && icon.h >= 44, `44 px: ${JSON.stringify(icon)}`);
  assert.ok(icon.right <= 390 && icon.bottom <= 844, 'inside the screen');
  const tabBar = await browser.evaluate(`(() => { const t = document.querySelector('[aria-label=Navigation]'); return t ? t.getBoundingClientRect().top : null; })()`);
  assert.notEqual(tabBar, null, 'the tab bar is found');
  assert.ok(icon.bottom <= tabBar + 0.5, `above the tab bar: ${icon.bottom} vs ${tabBar}`);
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=composer-input]')?.getClientRects().length`), false, 'the field is folded away');
  await browser.evaluate('document.activeElement.blur()');
  await shots2('390-4-icon');
  await browser.evaluate(`window.__say('answer')`);
  await browser.until('unread', `!!document.querySelector('[data-testid=composer-icon] [data-testid=agent-bar-unread]')`, 8000);
  await shots2('390-4b-icon-unread');
  await browser.evaluate(`window.__say('approval')`);
  await browser.until('ring', `document.querySelector(${js(ICON)})?.dataset.needsYou === 'true'`, 8000);
  await shots2('390-4c-icon-needs-you');
  await click(ICON);
  await browser.until('restored', `!document.querySelector(${js(ICON)})`);
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=composer-input]')?.getClientRects().length`), true, 'the bar is back at the bottom');
  assert.equal(await place(), 'bottom');
  assert.equal(await browser.evaluate('window.__layer.state'), 'peek', 'the phone bar comes back at rest (the peek), the conversation is not opened');
});

test('standalone FloatingComposer on a page with no shell: floating at 1440, bottom bar then icon at 390', { skip, timeout: 180000 }, async () => {
  await open(1440, 'standalone=1');
  await browser.until('floating', `!!document.querySelector(${js(FRAME)})`);
  assert.equal(await count('[data-testid=app-shell]'), 0, 'no AppShell on this page');
  const r = await rect(FRAME);
  assert.ok(r.right > 1400 && r.bottom > 860, 'bottom right corner');
  assert.deepEqual(await browser.evaluate(STRIP), ['chevron', 'dock', 'minimise']);
  await browser.evaluate('window.__clicks = 0');
  await tap('[data-testid=page-button]');
  assert.equal(await browser.evaluate('window.__clicks'), 1, 'the host page stays usable');
  await shots2('1440-5-standalone-floating');
  await dragFrom(GRIP, 600, 300);
  assert.ok(Math.abs((await rect(FRAME)).x - 500) < 150, 'it moves by its grip');
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('window open', `!!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await count('[data-testid=agent-tray-dock]'), 0, 'no side dock without a shell');
  await click('[data-testid=composer-controller] [data-action=dock]');
  await browser.until('bottom', `!document.querySelector(${js(FRAME)})`);
  const bar = await rect('[data-testid=agent-composer-box]');
  assert.ok(bar && bar.bottom > 860 && bar.w > 400, `Dock to the bottom: the bar sits at the foot of the window: ${JSON.stringify(bar)}`);
  await click('[data-testid=composer-controller] [data-action=minimise]');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  await shots2('1440-6-standalone-icon');
  await open(390, 'standalone=1');
  assert.equal(await count(FRAME), 0, 'a phone: no floating bar');
  assert.equal(await count(GRIP), 0);
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=composer-input]')?.getClientRects().length`), true, 'the bar is at the bottom');
  await shots2('390-5-standalone-bottom');
  await open(390, 'standalone=1&start=icon');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  await shots2('390-6-standalone-icon');
  await click(ICON);
  await browser.until('restored', `!document.querySelector(${js(ICON)})`);
});

test('French: the new words come from the locale', { skip, timeout: 60000 }, async () => {
  await open(1440, 'fr=1');
  await float();
  const names = await browser.evaluate(`[...document.querySelectorAll('[data-testid=composer-controller] button')].map(b => b.getAttribute('aria-label'))`);
  assert.deepEqual(names.slice(1), ['Ancrer en bas', 'Réduire']);
  assert.equal(await browser.evaluate(`document.querySelector(${js(GRIP)}).getAttribute('aria-label')`), 'Déplacer l’assistant');
  await click('[data-testid=composer-controller] [data-action=minimise]');
  await browser.until('icon', `!!document.querySelector(${js(ICON)})`);
  assert.equal(await browser.evaluate(`document.querySelector(${js(ICON)}).getAttribute('aria-label')`), 'Ouvrir l’assistant');
});
