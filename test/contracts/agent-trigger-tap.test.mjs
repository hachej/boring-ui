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

// D-1812 (coach-max D-863): the AppShell agent trigger (the coach mascot in the header) closes the layer. At half and full the sheet is modal, so the
// page, the trigger included, is inert. Happy-dom has no hit testing, so a real Chromium mounts the real AppShell with a fake controller and taps with
// real input (touch at 390x844, mouse at 1280): a tap on the trigger closes the open layer (half, full), two rapid taps from closed end closed, a tap
// at peek opens half. While the sheet is modal the Close control in it is reachable and named; and the trigger itself must stay in the accessibility
// tree (no aria-hidden or inert ancestor) so a role lookup finds it. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/agent-trigger-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/agent-trigger.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'viewer-frame', 'feedback'].map(name => registryCss(item(name))).join('\n')}`;
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
  browser = await launch('about:blank', { evidence: process.env.EVIDENCE_DIR ?? work });
});
after(async () => { await browser?.close(); await new Promise(done => server ? server.close(done) : done()); });

const wait = ms => new Promise(done => setTimeout(done, ms));
async function mount(width, height, touch) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await browser.until('shell mounted', `document.querySelector('[data-agent-trigger]') && window.__layer && document.readyState === 'complete'`);
  await wait(300);
}
const state = () => browser.evaluate(`window.__layer.state`);
const gone = () => browser.evaluate(`!document.querySelector('[data-slot=drawer-popup]') && !document.querySelector('[data-slot=drawer-backdrop], [data-slot=drawer-overlay]')`);
const centre = () => browser.evaluate(`(() => { const r = document.querySelector('[data-agent-trigger]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
// A tap as the platform delivers it: a finger (touchStart, touchEnd) or a mouse (move, press, release) at the trigger's centre.
async function tap(touch) {
  const { x, y } = await centre();
  if (touch) {
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
}
const open = async at => { await browser.evaluate(`window.__layer.open('agent', '${at}')`); await wait(900); };

for (const [width, height, touch] of [[390, 844, true], [1280, 800, false]]) {
  const label = `${width}x${height} ${touch ? 'touch' : 'mouse'}`;
  const snaps = touch ? ['half', 'full'] : ['open'];

  test(`${label}: a tap on the agent trigger closes the open layer (${snaps.join(', ')})`, { skip, timeout: 120000 }, async () => {
    await mount(width, height, touch);
    assert.equal(await state(), 'closed');
    await tap(touch); await wait(900);
    assert.equal(await state(), touch ? 'half' : 'open', 'a tap on the closed layer opens it');
    await tap(touch); await wait(900);
    assert.equal(await state(), 'closed', 'a tap on the trigger closes it again');
    assert.equal(await gone(), true, 'no sheet, backdrop or overlay remains');
    for (const at of snaps) {
      await open(at);
      assert.equal(await state(), at, `the layer is open at ${at}`);
      await tap(touch); await wait(900);
      assert.equal(await state(), 'closed', `a tap closes the layer from ${at}`);
      assert.equal(await gone(), true, `no sheet, backdrop or overlay remains after closing from ${at}`);
    }
  });

  test(`${label}: two rapid taps from closed end closed`, { skip, timeout: 120000 }, async () => {
    await mount(width, height, touch);
    await tap(touch); await wait(60); await tap(touch); await wait(1000);
    assert.equal(await state(), 'closed');
    assert.equal(await gone(), true, 'no sheet, backdrop or overlay remains');
  });
}

test('390x844 touch: a tap on the trigger at peek opens half', { skip, timeout: 120000 }, async () => {
  await mount(390, 844, true);
  await open('peek');
  assert.equal(await state(), 'peek');
  await tap(true); await wait(900);
  assert.equal(await state(), 'half');
});

test('390x844 touch: while the sheet is modal, Close is reachable and named; the trigger keeps its role and name in the accessibility tree', { skip, timeout: 120000 }, async () => {
  await mount(390, 844, true);
  for (const at of ['half', 'full']) {
    await open(at);
    const seen = await browser.evaluate(`(() => {
      const popup = document.querySelector('[data-slot=drawer-popup]');
      const close = document.querySelector('[data-testid=agent-layer-close]');
      const r = close.getBoundingClientRect();
      const trigger = document.querySelector('[data-agent-trigger]');
      return { inPopup: popup.contains(close), name: close.getAttribute('aria-label'), role: close.tagName === 'BUTTON',
        hit: popup.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        triggerHidden: Boolean(trigger.closest('[inert], [aria-hidden=true]')), triggerName: trigger.getAttribute('aria-label'), triggerRole: trigger.tagName === 'BUTTON' };
    })()`);
    assert.deepEqual({ inPopup: seen.inPopup, role: seen.role, hit: seen.hit }, { inPopup: true, role: true, hit: true }, `Close is a button in the sheet and a tap on it lands on it (${at})`);
    assert.ok(seen.name && seen.name.trim(), `Close has an accessible name (${at})`);
    assert.equal(seen.triggerRole, true);
    assert.equal(seen.triggerName, 'Ton coach');
    assert.equal(seen.triggerHidden, false, `the trigger is not under an aria-hidden or inert ancestor at ${at}: a role lookup (button "Ton coach") must find it`);
    await browser.evaluate(`document.querySelector('[data-testid=agent-layer-close]').click()`); await wait(900);
    assert.equal(await state(), 'closed', `Close closes the layer from ${at}`);
  }
});
