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

// The window-content props of `AmbientChat` on the one composer: header tools and actions, Dock and Open in full chat, thumbs on replies, an artifact opened inside the window or in the host,
// and the conversation embedded in a container. Each driven through the real `AmbientChat`, in real Chromium at 1440 and 390, light and dark. Shots: .cache/evidence/ambient-gaps.
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.AMBIENT_GAPS_EVIDENCE ?? join(root, '.cache/evidence/ambient-gaps');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/ambient-gaps-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/ambient-gaps.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
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
const shot = async (name, dark) => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`); await wait(150); await browser.screenshot(`ambient-gaps-${name}-${dark ? 'dark' : 'light'}.png`); };
const shots2 = async name => { for (const dark of [false, true]) await shot(name, dark); await browser.evaluate(`document.documentElement.classList.remove('dark')`); };

const FRAME = '[data-testid=composer-floating]', ICON = '[data-testid=composer-icon]', LEGACY = '[data-testid=ambient-header]', PANE = '[data-testid=composer-pane]';
const CHEVRON = '[data-action=chevron]';
const log = () => browser.evaluate('window.__log');
const openConversation = async () => {
  await browser.evaluate(`document.querySelector(${js(CHEVRON)}).click()`);
  await browser.until('the conversation is open', `document.body.textContent.includes('The launch plan is ready')`);
  await wait(300);
};
const card = '[data-testid=artifact-card][data-state=ready]';

test('1440: header tools and actions, Open in full chat and Dock are in the window\'s title row (or its menu) and fire; thumbs rate a reply', { skip, timeout: 180000 }, async () => {
  await open(1440, 'actions=1');
  assert.equal(await count(LEGACY), 0, 'not the old window');
  assert.equal(await count(FRAME), 1, 'the one composer, floating');
  await openConversation();
  const header = '[data-testid=agent-tray-header]';
  assert.equal(await count(`${header} [data-testid=host-tool]`), 1, 'the host tool is in the window\'s title row');
  await click('[data-testid=host-tool]');
  await click('[data-testid=agent-layer-action-export]');
  assert.deepEqual(await log(), ['tool', 'export']);
  assert.equal(await count(`${header} [data-testid=agent-layer-action-open-full]`), 1, 'Open in full chat is a button in the title row');
  await shots2('1440-1-actions');
  await click('[data-testid=agent-layer-action-open-full]');
  assert.equal((await log()).at(-1), 'full:demo', 'Open in full chat hands over the conversation id');
  await click('[data-testid=agent-layer-more]');
  await browser.until('the menu is open', `!!document.querySelector('[data-testid=agent-layer-action-dock]')`);
  assert.equal(await count('[data-testid=agent-layer-action-archive]'), 1, 'a host action placed in the menu is there');
  await shots2('1440-2-menu');
  await click('[data-testid=agent-layer-action-dock]');
  assert.equal((await log()).at(-1), 'dock');
  assert.equal(await count('[data-testid=feedback-up]'), 1, 'thumbs under the finished reply');
  await click('[data-testid=feedback-up]');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=feedback-up]').getAttribute('aria-pressed')`), 'true');
  assert.equal((await log()).at(-1), 'feedback:up:The launch plan');
  await click('[data-testid=feedback-up]');
  assert.equal((await log()).at(-1), 'feedback:null:The launch plan', 'pressing the chosen thumb takes the rating back');
  await click('[data-testid=feedback-down]');
  assert.equal((await log()).at(-1), 'feedback:down:The launch plan');
  await shots2('1440-3-thumbs');
});

test('1440: an artifact card opens the host\'s panel inside the floating window\'s pane, beside the bar; its close and full screen work', { skip, timeout: 180000 }, async () => {
  await open(1440, 'panel=1');
  assert.equal(await count(PANE), 0, 'no pane before a card is opened');
  await openConversation();
  await click(card);
  await browser.until('the panel opened', `!!document.querySelector('${PANE} [data-testid=host-panel]')`);
  const pane = await rect(PANE), frame = await rect(FRAME);
  assert.ok(pane.w > 400 && pane.right <= frame.x + 1 && pane.x >= 0 && pane.bottom <= 900, `the window is beside the bar, inside the screen: ${JSON.stringify({ pane, frame })}`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=host-artifact-title]').textContent`), 'Launch plan');
  assert.equal(await browser.evaluate('window.__panel.follow'), true, 'the panel follows the newest version');
  assert.equal(await browser.evaluate('window.__panel.versions.length'), 1);
  assert.equal(await count('[data-testid=composer-floating] [data-testid=composer-input]'), 1, 'the bar and its field stay');
  await shots2('1440-4-panel');
  await browser.evaluate('window.__panel.onFullscreenChange(true)');
  await browser.until('full screen', `document.querySelector('${PANE}').dataset.fullscreen === 'true'`);
  const full = await rect(PANE);
  assert.ok(full.w >= 1439 && full.h >= 899, `the pane takes the screen: ${JSON.stringify(full)}`);
  await shots2('1440-5-panel-fullscreen');
  await browser.evaluate('window.__panel.onFullscreenChange(false)');
  await browser.until('back in the window', `document.querySelector('${PANE}').dataset.fullscreen !== 'true'`);
  await click('[data-testid=host-artifact-close]');
  await browser.until('the panel closed', `!document.querySelector('${PANE}')`);
});

test('1440: with artifactTarget="host" the card opens in the host, not in the window', { skip, timeout: 180000 }, async () => {
  await open(1440, 'host=1&panel=1');
  await openConversation();
  await click(card);
  await browser.until('the host was asked', `window.__log.includes('host-open:Launch plan')`);
  assert.equal(await count(PANE), 0, 'nothing opens in the window');
});

test('1440: embedded draws the conversation in its container, not floating', { skip, timeout: 180000 }, async () => {
  await open(1440, 'embedded=1');
  assert.equal(await count(FRAME), 0, 'no floating bar');
  assert.equal(await count(ICON), 0, 'no icon');
  assert.equal(await count(LEGACY), 0, 'not the old window');
  const host = await rect('[data-testid=embed-host]');
  const field = await rect('[data-testid=embed-host] [data-testid=composer-input]');
  assert.ok(field && field.x >= host.x && field.right <= host.right + 1 && field.bottom <= host.bottom + 1, `the field is inside the container: ${JSON.stringify({ host, field })}`);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=embed-host]').textContent`), /The launch plan is ready/, 'the thread shows');
  const target = await rect('[data-testid=page-button]');
  assert.ok(target.h > 0);
  await shots2('1440-6-embedded');
});

test('390: header actions and Open in full chat are in the sheet\'s title row, Dock in its menu; an artifact opens full screen and closes', { skip, timeout: 180000 }, async () => {
  await open(390, 'actions=1&panel=1');
  assert.equal(await count(LEGACY), 0);
  await openConversation();
  assert.equal(await count('[data-testid=agent-layer-header] [data-testid=host-tool]'), 1, 'the host tool is in the sheet\'s title row');
  await click('[data-testid=agent-layer-action-export]');
  assert.equal((await log()).at(-1), 'export');
  const header = await rect('[data-testid=agent-layer-header]');
  assert.ok(header.right <= 390.5 && header.x >= 0, `the title row fits the screen: ${JSON.stringify(header)}`);
  await shots2('390-1-actions');
  await click('[data-testid=agent-layer-action-open-full]');
  assert.equal((await log()).at(-1), 'full:demo');
  await click('[data-testid=agent-layer-more]');
  await browser.until('the sheet is open', `!!document.querySelector('[data-testid=agent-layer-action-dock]')`);
  await shots2('390-2-menu');
  await click('[data-testid=agent-layer-action-dock]');
  assert.equal((await log()).at(-1), 'dock');
  assert.equal(await count('[data-testid=feedback-up]'), 1, 'thumbs under the reply');
  await click(card);
  await browser.until('the panel is open', `!!document.querySelector('[data-testid=agent-preview] [data-testid=host-panel]')`);
  const pane = await rect('[data-testid=agent-preview]');
  assert.ok(pane.x >= 0 && pane.right <= 390.5 && pane.w > 380, `the panel is a full-screen sheet: ${JSON.stringify(pane)}`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=host-panel]').dataset.sheet`), 'true');
  await shots2('390-3-panel');
  await click('[data-testid=host-artifact-close]');
  await browser.until('the panel closed', `!document.querySelector('[data-testid=agent-preview]')`);
});

test('390: embedded fills its container inside the screen', { skip, timeout: 180000 }, async () => {
  await open(390, 'embedded=1');
  assert.equal(await count(FRAME) + await count(ICON), 0, 'nothing floats');
  const host = await rect('[data-testid=embed-host]');
  const field = await rect('[data-testid=embed-host] [data-testid=composer-input]');
  assert.ok(host.right <= 390.5 && field && field.right <= host.right + 1 && field.bottom <= host.bottom + 1, `inside the container and the screen: ${JSON.stringify({ host, field })}`);
  await shots2('390-4-embedded');
});

test('1440: French words for the window\'s own controls', { skip, timeout: 180000 }, async () => {
  await open(1440, 'actions=1&fr=1');
  await openConversation();
  await click('[data-testid=agent-layer-more]');
  await browser.until('the menu is open', `!!document.querySelector('[data-testid=agent-layer-action-dock]')`);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=agent-layer-action-dock]').textContent`), /Ancrer la discussion/);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-layer-action-open-full]').getAttribute('aria-label')`), 'Ouvrir dans la discussion complète');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=feedback-up]').getAttribute('aria-label')`), 'Bonne réponse');
});
