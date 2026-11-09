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

// D-1932 slice 1: AppShell composer="content" at 1280 pins the assistant's one field under the page content and the dock holds only the thread; below the wide breakpoint it is the peek drawer.
// A real Chromium mounts the real AppShell; the shots go to .cache/evidence/composer-content (or EVIDENCE_DIR), which CI uploads as `composer-content-shots`.
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EVIDENCE_DIR ?? join(root, '.cache/evidence/composer-content');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/composer-content-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/composer-content.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'pi-chat-mentions', 'pi-chat-attachments'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
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
const open = async (width, query = '') => {
  const phone = width < 768;
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
  await browser.until('shell mounted', `window.__layer !== undefined && !!document.querySelector('[data-testid=app-shell]') && document.readyState === 'complete'`);
  await wait(400);
};
const count = selector => browser.evaluate(`document.querySelectorAll('${selector}').length`);
const rect = selector => browser.evaluate(`(() => { const e = document.querySelector('${selector}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`);
const inside = (inner, outer) => browser.evaluate(`!!document.querySelector('${inner}') && !!document.querySelector('${outer}')?.contains(document.querySelector('${inner}'))`);
const state = () => browser.evaluate(`document.querySelector('[data-testid=agent-layer]')?.dataset.state`);
const type = async text => {
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.send('Input.insertText', { text });
};
const dropFile = kind => browser.evaluate(`(() => {
  const data = new DataTransfer(); data.items.add(new File(['x'], 'plan.png', { type: 'image/png' }));
  document.querySelector('[data-testid=agent-content] [role=row]').dispatchEvent(new DragEvent('${kind}', { dataTransfer: data, bubbles: true, cancelable: true }));
})()`);

test('1280, composer=content: one composer, in the main column under the content at the chat width; none in the dock', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  assert.equal(await count('[data-testid=composer]'), 1, 'exactly one composer in the page');
  assert.equal(await inside('[data-testid=composer]', '[data-boring=dock-main]'), true, 'inside the main column');
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-layer]'), false, 'not in the dock');
  const composer = await rect('[data-testid=composer-dock]'), main = await rect('[data-boring=dock-main]');
  assert.ok(main.bottom - composer.bottom >= 0 && main.bottom - composer.bottom < 24, `at the bottom of the column, nothing under it but its own padding (${main.bottom - composer.bottom}px)`);
  const field = await rect('[data-testid=composer]');
  assert.ok(field.w <= 721 && field.w > 300, `at the chat's width, not the column's (${field.w}px)`);
  assert.equal(await state(), 'closed', 'the dock is closed');
});

test('1280, composer=content: a send opens the dock on the same thread, closing the dock leaves the field where it was', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  const before = await rect('[data-testid=composer-dock]');
  await type('How much was the bread?');
  await browser.evaluate(`document.querySelector('[data-testid=composer-submit]').click()`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await browser.until('reply', `document.querySelector('[data-testid=agent-layer]').textContent.includes('Noted, fictional answer.')`);
  assert.deepEqual(await browser.evaluate(`window.__sent`), ['How much was the bread?'], 'the one controller sent it');
  assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-layer]'), true, 'the thread is in the dock');
  assert.equal(await count('[data-testid=composer]'), 1, 'still one composer');
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-layer]'), false, 'and not in the dock');
  const after = await rect('[data-testid=composer-dock]');
  assert.ok(Math.abs(after.bottom - before.bottom) <= 1, 'the field kept its place at the bottom');
  await browser.evaluate(`document.querySelector('[data-testid=agent-layer-close]').click()`);
  await browser.until('dock closed', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'closed'`);
  assert.equal(await count('[data-testid=composer]'), 1, 'closing the dock leaves the composer');
  assert.equal(await inside('[data-testid=composer]', '[data-boring=dock-main]'), true);
});

test('1280, composer=content: talkAbout opens the dock and the cited row is a chip in the one composer', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await browser.evaluate(`window.__layer.talkAbout('@meal:2026-10-27/lunch')`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await browser.until('chip', `!!document.querySelector('[data-testid=mention-chip]')`);
  assert.equal(await inside('[data-testid=mention-chip]', '[data-boring=dock-main]'), true, 'the cited row is a chip in the main column composer');
  assert.equal(await count('[data-testid=composer]'), 1);
});

test('1280, composer=content: a file dropped anywhere on the content shows the overlay and becomes the same kind of chip in that composer', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await dropFile('dragover');
  await browser.until('overlay', `!!document.querySelector('[data-testid=content-drop-overlay]')`);
  assert.equal(await inside('[data-testid=content-drop-overlay]', '[data-testid=agent-content]'), true, 'the overlay covers the content');
  await dropFile('drop');
  await browser.until('attachment chip', `!!document.querySelector('[data-testid=attachment]')`);
  assert.equal(await inside('[data-testid=attachment]', '[data-testid=composer]'), true, 'in the composer');
  assert.equal(await count('[data-testid=content-drop-overlay]'), 0, 'the overlay is gone');
  await browser.evaluate(`window.__layer.talkAbout('@meal:2026-10-27/lunch')`);
  await browser.until('chip', `!!document.querySelector('[data-testid=mention-chip]')`);
  const slots = await browser.evaluate(`[...document.querySelectorAll('[data-testid=attachment], [data-testid=mention-chip]')].map(e => e.getAttribute('data-slot'))`);
  assert.equal(new Set(slots).size, 1, `a file and a cited row share one chip (${slots})`);
});

test('1280, the default composer="dock" is unchanged: the one composer is in the dock', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await count('[data-testid=composer]'), 1);
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-layer]'), true);
  assert.equal(await count('[data-testid=agent-content-composer]'), 0, 'no content slot');
});

test('390, composer=content: nothing changes, the peek drawer holds the one composer', { skip, timeout: 120000 }, async () => {
  await open(390, 'composer=content');
  assert.equal(await count('[data-testid=agent-content-composer]'), 0, 'no content slot on a phone');
  await browser.evaluate(`window.__layer.open('agent', 'peek')`);
  await browser.until('peek', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'peek'`);
  await wait(900);
  assert.equal(await count('[data-testid=composer]'), 1);
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-layer]'), true, 'the composer is in the drawer');
});

for (const dark of [false, true]) {
  test(`shoot composer=content, ${dark ? 'dark' : 'light'}: 1280 dock closed, dock open, 390 peek`, { skip, timeout: 120000 }, async () => {
    const name = dark ? 'dark' : 'light', query = `composer=content${dark ? '&dark=1' : ''}`;
    await open(1280, query);
    await browser.screenshot(`composer-content-1280-${name}-dock-closed.png`);
    await browser.evaluate(`window.__layer.open('agent')`);
    await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
    await wait(700);
    await browser.screenshot(`composer-content-1280-${name}-dock-open.png`);
    await open(390, query);
    await browser.evaluate(`window.__layer.open('agent', 'peek')`);
    await browser.until('peek', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'peek'`);
    await wait(900);
    await browser.screenshot(`composer-content-390-${name}-peek.png`);
  });
}
