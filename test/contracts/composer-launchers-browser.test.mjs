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

// The composer config on every launcher in real Chromium (the real FloatingComposer and AppShell over a page of data): a bar with `level` controlled by the page and `avoid`; two launchers with ids
// stacking; the app's own feedback slot in a title row and in a field, the review chip opening below a top anchor, and Esc in order; a screen that hides the bubble (`NavItem.composer`).
// Screenshots (light and dark, 1440 and 390) go to `.cache/evidence/composer-launchers` (or COMPOSER_LAUNCHERS_EVIDENCE).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.COMPOSER_LAUNCHERS_EVIDENCE ?? join(root, '.cache/evidence/composer-launchers');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/composer-launchers-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/composer-launchers.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
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
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(250); await browser.screenshot(`launchers-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };
const BAR = '[data-testid=composer-floating]', TRAY = '[data-testid=agent-tray]', CIRCLE = '[data-testid=composer-circle]', BOX = '[data-testid=composer-circle-box]', PANEL = '[data-testid=composer-circle-panel]', SHEET = '[data-testid=agent-layer]';
const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
const press = async (name = 'Escape') => { await key(name); await wait(150); };
const pointAt = async selector => {
  const cell = await rect(selector);
  const at = { x: cell.x + 10, y: cell.y + 10 };
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
};
const type = text => browser.evaluate(`(() => { const f = document.querySelector('[data-testid=feedback-bubble-input]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(f, ${js(text)}); f.dispatchEvent(new Event('input', { bubbles: true })); })()`);

test('1440 and 390: a bar with `level` controlled by the page and `avoid`: the page sets the level, the person moves it and the page hears it, the bar steps around the drawer tab, the note shows', { skip, timeout: 240000 }, async () => {
  for (const width of [1440, 390]) {
    const wide = width >= 768;
    await open(width, 'scene=level');
    if (wide) {
      const bar = await rect(BAR), tab = await rect('[data-testid=drawer-tab]');
      assert.ok(bar && !overlaps(bar, tab), `${width}: the bar steps left of the drawer tab: ${JSON.stringify({ bar, tab })}`);
      assert.ok(tab.x - bar.right >= 7, `${width}: with a gap`);
      assert.ok(Math.abs(bar.bottom - 880) <= 2, `${width}: 20 px above the foot (at.offset.block): ${JSON.stringify(bar)}`);
      assert.equal(await browser.evaluate(`document.querySelector(${js(BAR)}).dataset.composer`), 'main', 'the id is on the bar');
      assert.ok((await browser.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--composer-reserve-block')`)).length > 0, `${width}: the bar publishes its footprint`);
    }
    await shots2(`${width}-1-bar-folded`);
    // The page sets the level: the bar goes there, and the page is not told about its own change.
    await click('[data-testid=level-open]');
    await browser.until('open', wide ? `!!document.querySelector(${js(TRAY)})` : `!!document.querySelector(${js(SHEET)})`);
    await wait(400);
    assert.deepEqual(await browser.evaluate('window.__levels'), [], `${width}: the page's own change is not echoed to on.level`);
    await shots2(`${width}-2-bar-open`);
    if (wide) {
      await click('[data-testid=level-grown]');
      await browser.until('grown', `document.querySelector(${js(TRAY)})?.dataset.expanded === 'true'`);
      await shots2(`${width}-3-bar-grown`);
      // The person reduces it with the strip: the page hears `folded` and shows it.
      await browser.evaluate(`document.querySelector('[data-testid=agent-tray-reduce]').click()`);
      await browser.until('folded', `document.querySelector('[data-testid=level-readout]').textContent === 'folded'`);
      assert.equal(await browser.evaluate('window.__levels.at(-1)'), 'folded', `${width}: on.level heard the person`);
      assert.equal(await count(TRAY), 0, `${width}: the tray is closed`);
    } else {
      await click('[data-testid=level-folded]');
      await browser.until('closed', `!document.querySelector(${js(SHEET)}) || document.querySelector(${js(SHEET)}).dataset.peek === 'true'`);
    }
    // The note sits on the folded bar of a wide screen (a phone's folded bar is the peek field itself: no launcher to carry it).
    if (wide) {
      await click('[data-testid=busy]');
      await browser.until('note', `!!document.querySelector('[data-testid=composer-launcher-note]')`);
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-launcher-note]').textContent`), 'Assistant · thinking', `${width}: the app's status text on the folded bar`);
      await shots2(`${width}-4-bar-note`);
    }
  }
});

test('1440 and 390: two launchers with ids stack on one corner (a floating bar and a circle), and a toast lands above the stack by reading the published reserve', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    const wide = width >= 768;
    await open(width, 'scene=stack');
    const circle = await rect(`${BOX}[data-composer=pm]`);
    assert.ok(circle, `${width}: the circle is drawn`);
    if (wide) {
      const bar = await rect(BAR);
      assert.equal(await browser.evaluate(`document.querySelector(${js(BAR)}).dataset.composer`), 'main');
      assert.ok(bar.bottom > circle.bottom && !overlaps(bar, circle), `${width}: the circle sits above the bar, no overlap: ${JSON.stringify({ bar, circle })}`);
      assert.ok(bar.y - circle.bottom >= 0 && bar.y - circle.bottom <= 24, `${width}: close above it: ${JSON.stringify({ bar, circle })}`);
    }
    const toast = await rect('[data-testid=toast]');
    assert.ok(toast.bottom <= circle.y, `${width}: the toast is above the highest launcher: ${JSON.stringify({ toast, circle })}`);
    await shots2(`${width}-5-stack`);
  }
});

test('1440 and 390: the feedback slot in a circle\'s title row: the app\'s own control with the level, the phase and the count; it replaces the built-in toggle', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    const wide = width >= 768;
    await open(width, 'scene=title');
    await click(CIRCLE);
    await browser.until('open', wide ? `!!document.querySelector(${js(PANEL)})` : `!!document.querySelector(${js(SHEET)})`);
    await wait(700);
    const control = '[data-testid=composer-controller] [data-testid=app-feedback]';
    assert.equal(await count(control), 1, `${width}: the app's control is in the title row`);
    assert.equal(await browser.evaluate(`document.querySelector(${js(control)}).dataset.where`), 'title');
    assert.equal(await browser.evaluate(`document.querySelector(${js(control)}).dataset.level`), 'open', `${width}: it is given the level`);
    assert.equal(await browser.evaluate(`document.querySelector(${js(control)}).dataset.phase`), 'idle');
    assert.equal(await count('[data-testid=composer-annotate-title]'), 0, `${width}: no built-in toggle next to it`);
    await shots2(`${width}-6-slot-title`);
    // The slot can move the conversation: setLevel('folded') closes the panel.
    await browser.evaluate(`window.__slotCtx.setLevel('folded')`);
    await browser.until('folded', `!document.querySelector(${js(PANEL)}) && !document.querySelector(${js(SHEET)})`);
    assert.equal(await count(BOX), 1, `${width}: the circle is back`);
  }
});

test('1440: the feedback slot in a bar\'s field: the review chip opens below a top anchor and above a bottom one; Esc goes bubble, annotating, then the panel', { skip, timeout: 240000 }, async () => {
  for (const corner of ['top', 'bottom']) {
    await open(1440, `scene=field&corner=${corner}`);
    const bar = await rect(BAR);
    assert.ok(corner === 'top' ? bar.y < 40 : bar.bottom > 860, `${corner}: the bar is anchored there: ${JSON.stringify(bar)}`);
    // The bar at the top stays folded (its field is the anchor of the chip); the bar at the foot opens its window, for the order of Esc.
    if (corner === 'bottom') {
      await click('[data-testid=agent-bar-conversation]');
      await browser.until('tray', `!!document.querySelector(${js(TRAY)})`);
      await wait(400);
    }
    assert.equal(await count('[data-testid=app-feedback][data-where=field]'), 1, `${corner}: the app's control is in the composer's row`);
    assert.equal(await count('[data-testid=composer-annotate]'), 0, `${corner}: the chat's own toggle steps out`);
    await shots2(`1440-7-slot-field-${corner}`);
    await click('[data-testid=app-feedback]');
    await browser.until('annotating', `window.__feedback.getSnapshot().phase === 'active'`);
    await pointAt('[data-testid=orders] tbody tr:nth-child(3) td:nth-child(3)');
    await browser.until('bubble', `!!document.querySelector('[data-testid=feedback-bubble-input]')`);
    await type('This total looks wrong');
    if (corner === 'bottom') {
      // Esc with a note bubble open closes the bubble only: annotating goes on and the panel stays.
      await press();
      assert.equal(await browser.evaluate(`window.__feedback.getSnapshot().phase`), 'active', 'the first Esc closed the bubble: annotating goes on');
      assert.equal(await count(TRAY), 1, 'and the panel stays');
      await pointAt('[data-testid=orders] tbody tr:nth-child(3) td:nth-child(3)');
      await browser.until('bubble again', `!!document.querySelector('[data-testid=feedback-bubble-input]')`);
      await type('This total looks wrong');
    }
    await click('[data-testid=feedback-bubble-save]');
    await browser.until('saved', `window.__feedback.getSnapshot().notes.some(note => note.text)`);
    // With no bubble open, Esc ends annotating (feedback first); the panel is still there.
    await press();
    await browser.until('review', `window.__feedback.getSnapshot().phase === 'review'`);
    assert.equal(await count(TRAY), corner === 'bottom' ? 1 : 0, `${corner}: the panel stays as it was when annotating ends`);
    await browser.until('chip', `!!document.querySelector('[data-testid=feedback-chip-open]')`);
    await click('[data-testid=feedback-chip-open]');
    await browser.until('review panel', `!!document.querySelector('[data-testid=feedback-review]')`);
    const chip = await rect('[data-testid=feedback-chip]'), review = await rect('[data-testid=feedback-review]');
    if (corner === 'top') assert.ok(review.y >= chip.bottom - 1 && review.bottom <= 900, `the review opens below a chip anchored at the top: ${JSON.stringify({ chip, review })}`);
    else assert.ok(review.bottom <= chip.y + 1 && review.y >= 0, `the review opens above a chip at the foot: ${JSON.stringify({ chip, review })}`);
    await shots2(`1440-8-review-${corner}`);
    await click('[data-testid=feedback-review-close]');
    assert.equal(await count('[data-testid=feedback-review]'), 0, `${corner}: the review closes`);
    if (corner === 'bottom') {
      await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
      await press();
      await browser.until('closed', `!document.querySelector(${js(TRAY)})`);
    }
  }
});

test('1440 and 390: NavItem.composer: a screen hides the bubble (the full-page support route), another moves it, and the app\'s own is back elsewhere', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    await open(width, 'scene=nav');
    const go = label => browser.evaluate(`(() => { const e = [...document.querySelectorAll('button, a, [role=tab], [role=menuitem]')].filter(el => el.getClientRects().length).find(el => el.textContent.trim() === ${js(label)} || el.getAttribute('aria-label') === ${js(label)}); e.click(); })()`);
    const home = await rect(BOX);
    assert.ok(home && Math.abs(home.right - (width - 16)) <= 1, `${width}: the app's circle on Orders: ${JSON.stringify(home)}`);
    await shots2(`${width}-9-nav-orders`);
    await go('Support');
    await browser.until('support', `!!document.querySelector('[data-testid=support-page]')`);
    await wait(300);
    assert.equal(await count(BOX), 0, `${width}: the Support screen hides the bubble: ${await browser.evaluate("[...document.querySelectorAll('[data-composer]')].map(e => e.tagName + ':' + e.dataset.testid + ':' + e.hidden + ':' + e.getAttribute('style')).join(' ')")}`);
    assert.equal(await count('[data-testid=agent-layer]'), 0, `${width}: and the sheet`);
    await shots2(`${width}-9-nav-support`);
    await go('Reports');
    await browser.until('reports', `!!document.querySelector('[data-testid=reports-page]')`);
    await wait(300);
    const moved = await rect(BOX);
    assert.ok(moved && home.bottom - moved.bottom >= 60, `${width}: the Reports screen moves the circle up (its own offset): ${JSON.stringify({ home, moved })}`);
    await shots2(`${width}-9-nav-reports`);
    await go('Orders');
    await browser.until('orders', `!!document.querySelector('[data-testid=orders]')`);
    await wait(300);
    const back = await rect(BOX);
    assert.ok(back && Math.abs(back.bottom - home.bottom) <= 1, `${width}: the app's own circle is back: ${JSON.stringify({ home, back })}`);
  }
});
