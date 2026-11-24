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

// `FloatingComposer` options: className, storage, the old drag position, notice timing, renderComposer, composerLayout, the working icon and the model pill. Real Chromium at 1440 and 390, light and dark. Shots: .cache/evidence/floating-composer-options.
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.AMBIENT_COMPOSER_EVIDENCE ?? join(root, '.cache/evidence/floating-composer-options');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/floating-composer-options-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/floating-composer-options.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
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
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(150); await browser.screenshot(`floating-composer-options-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };

const sessionKeys = () => browser.evaluate(`Object.keys(sessionStorage).filter(key => key.includes('sidebar-composer'))`);
const localKeys = () => browser.evaluate(`Object.keys(localStorage).filter(key => key.includes('sidebar-composer'))`);
const MINIMISE = '[data-testid=composer-controller] [data-action=minimise], [data-testid=composer-minimise]';

test('1440 and 390: className reaches the composer box (the floating frame, the folded icon), so a host can place it', { skip, timeout: 180000 }, async () => {
  await open(1440, 'class=host-moved');
  assert.equal(await browser.evaluate(`document.querySelector(${js(FRAME)}).classList.contains('host-moved')`), true, 'the frame carries the host class');
  const frame = await rect(FRAME);
  assert.ok(frame.bottom < 900 - 120, `the host class moved the bar up: ${JSON.stringify(frame)}`);
  await shots2('1440-g1-class');
  await click(MINIMISE);
  await browser.until('folded', `!!document.querySelector(${js(ICON)})`);
  assert.equal(await browser.evaluate(`document.querySelector(${js(ICON)}).parentElement.classList.contains('host-moved')`), true, 'the icon carries it too');
  await open(390, 'class=host-moved');
  await click(MINIMISE);
  await browser.until('folded', `!!document.querySelector(${js(ICON)})`);
  assert.equal(await browser.evaluate(`document.querySelector(${js(ICON)}).parentElement.classList.contains('host-moved')`), true, 'the phone\'s icon carries it');
});

test('1440: storage session keeps the place in this tab only, local (the default) keeps it across visits', { skip, timeout: 180000 }, async () => {
  await open(1440);
  await click(MINIMISE);
  await browser.until('folded', `!!document.querySelector(${js(ICON)})`);
  assert.equal((await localKeys()).some(key => key.includes('composer-place')), true, 'the place is in localStorage by default');
  assert.deepEqual(await sessionKeys(), [], 'and not in sessionStorage');
  await open(1440, 'storage=session');
  await click(MINIMISE);
  await browser.until('folded', `!!document.querySelector(${js(ICON)})`);
  assert.equal((await sessionKeys()).some(key => key.includes('composer-place')), true, 'storage="session" keeps it in sessionStorage');
  assert.deepEqual(await localKeys(), [], 'and not in localStorage');
});

test('1440: an app that had the old bar keeps where the person put it (the old drag position is read once)', { skip, timeout: 180000 }, async () => {
  await open(1440, `legacy=${encodeURIComponent(JSON.stringify({ right: 200, bottom: 300 }))}`);
  const frame = await rect(FRAME);
  assert.ok(Math.abs(frame.right - (1440 - 200)) <= 2, `the old right edge is kept: ${JSON.stringify(frame)}`);
  assert.ok(Math.abs(frame.bottom - (900 - 300)) <= 40, `the old bottom edge is kept (the bar is shorter than the old window): ${JSON.stringify(frame)}`);
  await shots2('1440-g2-migrated');
  assert.equal((await localKeys()).some(key => key.includes('composer-pos')), true, 'it is written as this bar\'s own place');
  await browser.evaluate(`sessionStorage.setItem('boring.ambient.position', JSON.stringify({ right: 16, bottom: 16 }))`);
  await open(1440, 'keep=1');
  const again = await rect(FRAME);
  assert.ok(Math.abs(again.x - frame.x) <= 2 && Math.abs(again.y - frame.y) <= 2, `the bar's own place wins on the next visit: ${JSON.stringify({ frame, again })}`);
  await open(1440, `legacy=${encodeURIComponent(JSON.stringify({ right: 16, bottom: 16 }))}`);
  assert.equal(await browser.evaluate(`document.querySelector(${js(FRAME)}).dataset.corner`), 'br', 'the old default place is the bottom right corner');
});

test('1440 and 390: autoDismissMs fades a notice (an error too, a question never); maxToasts caps how many wait', { skip, timeout: 180000 }, async () => {
  await open(1440, 'dismiss=500');
  await browser.evaluate(`window.__push('done')`);
  await browser.until('a notice', `!!document.querySelector(${js(NOTICE)})`);
  await browser.until('it faded', `!document.querySelector(${js(NOTICE)})`, 4000);
  await browser.evaluate(`window.__push('error')`);
  await browser.until('an error notice', `!!document.querySelector(${js(NOTICE)})`);
  await browser.until('the error faded too (the old toast did)', `!document.querySelector(${js(NOTICE)})`, 4000);
  await browser.evaluate(`window.__push('input')`);
  await browser.until('a question', `!!document.querySelector(${js(NOTICE)})`);
  await wait(1200);
  assert.equal(await count(NOTICE), 1, 'a question waits until it is answered or dismissed');
  await open(390, 'max=2');
  for (const title of ['One', 'Two', 'Three', 'Four']) await browser.evaluate(`window.__push('done', ${js(title)})`);
  await browser.until('notices', `!!document.querySelector(${js(NOTICE)})`);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=notice-more]')?.textContent ?? ''`), /\b1\b/, 'two kept: one shows, one waits');
  await shots2('390-g4-max');
});

test('1440 and 390: renderComposer and composerLayout reach the bar\'s composer', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    await open(width, 'render=1');
      assert.equal(await count('[data-testid=host-composer]') >= 1, true, `${width}: the host's renderComposer draws the field`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=host-composer-layout]').textContent`), 'pill', `${width}: it gets the bar's layout`);
    await open(width, 'layout=card');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer]').dataset.layout`), 'card', `${width}: composerLayout is the host's choice`);
    await open(width);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer]').dataset.layout`), 'pill', `${width}: the bar's own layout by default`);
  }
});

test('1440 and 390: the folded icon shows the agent at work, and the field is not dimmed by its disabled Send', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    await open(width, 'stock=1');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=composer-input]').closest('[data-slot=input-group]')).opacity`), '1', `${width}: an empty draft does not dim the field `);
    await browser.evaluate(`window.__say('Make the list')`);
    await browser.until('the run is on', `document.querySelector('[data-testid=composer-submit]')?.dataset.state === 'stop'`);
    await click(MINIMISE);
    await browser.until('folded', `!!document.querySelector(${js(ICON)})`);
    await browser.until('the icon shows the work', `document.querySelector(${js(ICON)})?.dataset.working === 'true'`, 4000);
    assert.equal(await count('[data-testid=composer-icon-working]'), 1, `${width}: the ring pulses round the icon`);
    await shots2(`${width}-g7-working`);
  }
});

test('1440 and 390: the model pill shows the model\'s name in the narrow bar, not « GP… »', { skip, timeout: 180000 }, async () => {
  for (const width of [1440, 390]) {
    await open(width, 'model=1');
    const fit = await browser.evaluate(`(() => { const e = document.querySelector('[data-testid=composer-model-label]'); return { text: e.textContent, clipped: e.scrollWidth > e.clientWidth + 1, w: e.clientWidth }; })()`);
    assert.equal(fit.clipped, false, `${width}: the pill is not truncated: ${JSON.stringify(fit)}`);
    assert.ok(fit.w >= 56, `${width}: and it has room: ${JSON.stringify(fit)}`);
    await shots2(`${width}-g8-model`);
  }
});
