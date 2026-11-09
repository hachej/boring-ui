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

// D-2010: AppShell `rail="hover"` with a pin. A real Chromium mounts the real AppShell (test/fixtures/themes/sidebar-pin.jsx) and drives it with real input: hover, Tab, the pin click, Space, Ctrl+B and a reload.
// The pane is open when `[data-slot=sidebar]` is `expanded`; the page edge is the screen box. Shots at 1280x800 light and dark go to SIDEBAR_PIN_EVIDENCE (CI uploads them). In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const KEY = 'boring-ui:sidebar-pin';
const PIN = '[data-testid=sidebar-pin]';

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/sidebar-pin-'));
  const evidence = process.env.SIDEBAR_PIN_EVIDENCE ?? join(root, ".cache/evidence/sidebar-pin");
  mkdirSync(evidence, { recursive: true });
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/sidebar-pin.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
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
  browser = await launch('about:blank', { evidence });
});
after(async () => { await browser?.close(); await new Promise(done => server ? server.close(done) : done()); });

const wait = ms => new Promise(done => setTimeout(done, ms));
let pointerScript = null;
const pointerShim = (pointer, hover) => `(() => { const real = window.matchMedia.bind(window); window.matchMedia = query => { const list = real(query); const m = /^\\(\\s*(any-)?(pointer|hover)\\s*:\\s*(\\w+)\\s*\\)$/.exec(String(query).trim()); if (m) Object.defineProperty(list, 'matches', { get: () => m[3] === (m[2] === 'pointer' ? '${pointer}' : '${hover}') }); return list; }; })()`;
async function mount(query = '', { width = 1280, touch = false, clear = true } = {}) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: touch });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
  // Headless Chromium does not promise a fine pointer (the CDP media emulation has no pointer feature), so the page is told which pointer this person has:
  // every `(pointer: x)` / `(hover: x)` query answers for a mouse, or for a finger when `touch`.
  // CDP media emulation changes CSS and JS together where this Chromium supports a pointer feature; the shim below is the JS-side fallback.
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: touch ? 'coarse' : 'fine' }, { name: 'hover', value: touch ? 'none' : 'hover' }] });
  if (pointerScript) await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pointerScript });
  pointerScript = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: pointerShim(touch ? 'coarse' : 'fine', touch ? 'none' : 'hover') })).identifier;
  if (clear) { await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?clear=1` }); await browser.until('origin ready', `document.readyState === 'complete'`); await browser.evaluate(`localStorage.clear()`); }
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
  await browser.until('shell mounted', `document.querySelector('[data-testid=app-shell]') !== null && document.readyState === 'complete'`);
  await wait(500);
}

const SIDEBAR = '[data-slot=sidebar]';
const state = () => browser.evaluate(`document.querySelector('${SIDEBAR}').getAttribute('data-state')`);
const left = () => browser.evaluate(`document.querySelector('[data-testid=screen-Comptes]').getBoundingClientRect().left`);
const pin = prop => browser.evaluate(`(() => { const e = document.querySelector('${PIN}'); return e && ${prop}; })()`);
const away = async () => { await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 }); await wait(800); };
const over = async () => { await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 40, y: 400 }); await wait(800); };
const stored = () => browser.evaluate(`(() => { const k = Object.keys(localStorage).find(k => k.startsWith('${KEY}')); return k ? localStorage.getItem(k) : null; })()`);
const ctrlB = async () => { for (const type of ['rawKeyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 }); await wait(400); };
const tab = async () => { await browser.press('Tab'); await wait(400); };
const pressed = () => pin(`e.getAttribute('aria-pressed')`);
const name = () => pin(`e.getAttribute('aria-label')`);

test('unpinned: the hover rail is folded, opens under the pointer and shows a named pin that is not pressed', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  assert.equal(await state(), 'collapsed');
  assert.equal(await pin('getComputedStyle(e).opacity'), '0', 'folded: the pin is not shown');
  await over();
  assert.equal(await state(), 'expanded');
  assert.equal(await pin('getComputedStyle(e).opacity'), '1');
  assert.equal(await name(), 'Épingler le volet');
  assert.equal(await pressed(), 'false');
  assert.equal(await pin('e.tagName'), 'BUTTON');
  await away();
  assert.equal(await state(), 'collapsed', 'back to folded when the pointer leaves');
});

test('the pin is reached by keyboard: Tab opens the pane on it, Space pins, the page reflows beside the pane', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  const folded = await left();
  await tab();
  assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('${PIN}')`), true, 'the first Tab stop is the pin');
  assert.equal(await state(), 'expanded', 'focus opens the pane');
  assert.equal(await left(), folded, 'open by focus overlays the page (it does not reflow)');
  await browser.press(' ');
  await wait(400);
  assert.equal(await pressed(), 'true');
  assert.equal(await name(), 'Épingler le volet', 'one stable name in both states');
  const pinned = await left();
  assert.ok(pinned > folded + 100, 'pinned: the page starts beside the open pane, ' + pinned + ' vs ' + folded);
  await browser.evaluate(`document.activeElement.blur()`);
  await away();
  assert.equal(await state(), 'expanded', 'pinned: stays open with neither hover nor focus');
});

test('a click on the pin keeps the pane open; unpinning folds it when the pointer leaves', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  const folded = await left();
  await over();
  await browser.click(`document.querySelector('${PIN}')`);
  await wait(400);
  assert.equal(await pressed(), 'true');
  assert.equal(await stored(), '1');
  await away();
  assert.equal(await state(), 'expanded');
  const pinned = await left();
  assert.ok(pinned > folded + 100);
  await over();
  await browser.click(`document.querySelector('${PIN}')`);
  await wait(400);
  assert.equal(await pressed(), 'false');
  assert.equal(await name(), 'Épingler le volet', 'one stable name in both states');
  assert.equal(await state(), 'expanded', 'still under the pointer');
  assert.equal(await stored(), '0');
  await away();
  assert.equal(await state(), 'collapsed', 'unpinned: folds when the pointer and focus leave');
  assert.equal(await left(), folded);
});

test('the pin survives a reload, per app and per person', { skip, timeout: 120000 }, async () => {
  await mount('app=Alpha&user=a@example.test');
  await over();
  await browser.click(`document.querySelector('${PIN}')`);
  await wait(300);
  assert.ok((await browser.evaluate(`Object.keys(localStorage)`)).includes('boring-ui:sidebar-pin:Alpha:a%40example.test'));
  await mount('app=Alpha&user=a@example.test', { clear: false });
  await away();
  assert.equal(await state(), 'expanded', 'pinned after the reload with no hover');
  assert.equal(await pressed(), 'true');
  await mount('app=Alpha&user=b@example.test', { clear: false });
  await away();
  assert.equal(await state(), 'collapsed', 'another person is not pinned');
  await mount('app=Beta&user=a@example.test', { clear: false });
  await away();
  assert.equal(await state(), 'collapsed', 'another app is not pinned');
});

test('Ctrl+B toggles the pin', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  await ctrlB();
  assert.equal(await state(), 'expanded', 'pinned by Ctrl+B');
  assert.equal(await stored(), '1');
  await ctrlB();
  assert.equal(await state(), 'collapsed', 'unpinned by Ctrl+B with the pointer away');
  assert.equal(await stored(), '0');
  await over();
  await ctrlB();
  await away();
  assert.equal(await state(), 'expanded');
  assert.equal(await pressed(), 'true');
});

test('rail="icon" has no pin, and a throwing store does not break the pin', { skip, timeout: 120000 }, async () => {
  await mount('plain=1');
  assert.equal(await browser.evaluate(`document.querySelector('${PIN}') === null`), true);
  assert.equal(await browser.evaluate(`document.querySelector('[data-slot=sidebar-trigger]') !== null`), true);
  await mount('throw=1');
  await over();
  await browser.click(`document.querySelector('${PIN}')`);
  await away();
  assert.equal(await state(), 'expanded', 'pinned for this visit');
});

const dialogOpen = () => browser.evaluate(`document.querySelector('[data-slot=dialog-content]') !== null`);
const ownSidebar = () => browser.evaluate(`document.querySelector('[data-testid=own-sidebar]') !== null`);
const closeDialog = async () => { await browser.click(`document.querySelector('[data-slot=dialog-close]')`); await wait(600); };

test('pinned means open through everything: a portaled dialog, a click in the page, focus leaving; the screen sidebar stays rendered', { skip, timeout: 120000 }, async () => {
  await mount('dialog=1');
  await over();
  assert.equal(await ownSidebar(), true, 'rendered while expanded');
  await browser.click(`document.querySelector('${PIN}')`);
  await away();
  assert.equal(await ownSidebar(), true, 'pinned: rendered with the pointer away');
  await browser.click(`document.querySelector('[data-testid=open-dialog]')`);
  await wait(500);
  assert.equal(await dialogOpen(), true);
  assert.equal(await state(), 'expanded', 'open under a dialog');
  await closeDialog();
  assert.equal(await dialogOpen(), false);
  await browser.click(`document.querySelector('[data-testid=screen-Comptes]')`);
  await wait(400);
  assert.equal(await state(), 'expanded', 'a click in the page leaves it open');
  assert.equal(await ownSidebar(), true, 'its sidebar content is still rendered');
  await browser.evaluate(`document.activeElement.blur()`);
  await wait(300);
  assert.equal(await state(), 'expanded');
});

test('unpinned: the pane does not fold under a dialog opened from it, and folds once it is closed with the pointer and focus outside', { skip, timeout: 120000 }, async () => {
  await mount('dialog=1');
  await over();
  await browser.click(`document.querySelector('[data-testid=open-dialog]')`);
  await wait(500);
  assert.equal(await dialogOpen(), true);
  await away();
  await wait(400);
  assert.equal(await state(), 'expanded', 'the dialog is open: the portal took the pointer and focus, the pane waits');
  assert.equal(await dialogOpen(), true);
  await closeDialog();
  await away();
  await wait(400);
  assert.equal(await dialogOpen(), false);
  assert.equal(await state(), 'collapsed', 'closed, pointer and focus outside: folded');
});

test('Tab in, pin then unpin with Space: moving the pointer in and out keeps the pane open while the focus stays inside', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  await tab();
  await browser.press(' ');
  await wait(300);
  await browser.press(' ');
  await wait(400);
  assert.equal(await pressed(), 'false');
  assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('${PIN}')`), true);
  await over();
  await away();
  assert.equal(await state(), 'expanded', 'the focus is still inside: the pointer leaving does not fold');
  await browser.evaluate(`document.activeElement.blur()`);
  await wait(400);
  assert.equal(await state(), 'collapsed', 'focus and pointer both outside: folded');
});

test('a finger: the folded pin on a touch screen is tappable, opens the pane and pins it', { skip, timeout: 120000 }, async () => {
  await mount('', { touch: true });
  assert.equal(await state(), 'collapsed');
  assert.equal(await pin('getComputedStyle(e).opacity'), '1', 'coarse pointer: the pin is shown');
  await browser.tap(`document.querySelector('${PIN}')`);
  await wait(500);
  assert.equal(await pressed(), 'true', 'the tap reached the pin');
  assert.equal(await state(), 'expanded');
});

test('pinned, a dialog open from the pane, the pointer away: Ctrl+B unpins but the pane and the dialog stay until it closes', { skip, timeout: 120000 }, async () => {
  await mount('dialog=1');
  await over();
  await browser.click(`document.querySelector('${PIN}')`);
  await browser.click(`document.querySelector('[data-testid=open-dialog]')`);
  await wait(500);
  assert.equal(await dialogOpen(), true);
  await away();
  await ctrlB();
  assert.equal(await pressed(), 'false', 'Ctrl+B unpinned');
  assert.equal(await dialogOpen(), true, 'the dialog is still open');
  assert.equal(await ownSidebar(), true, 'the screen sidebar is still rendered');
  assert.equal(await state(), 'expanded');
  await closeDialog();
  await away();
  await wait(400);
  assert.equal(await state(), 'collapsed', 'closed, pointer and focus outside: folded');
});

for (const editor of ['editor-area', 'editor-rich']) test(`Ctrl+B inside ${editor === 'editor-area' ? 'a textarea' : 'a contenteditable'} is the editor's own: it reaches the editor and does not toggle the pin`, { skip, timeout: 120000 }, async () => {
  await mount('editor=1');
  await over();
  await browser.click(`document.querySelector('${PIN}')`);
  await away();
  assert.equal(await pressed(), 'true');
  await browser.evaluate(`document.querySelector('[data-testid=${editor}]').focus()`);
  await ctrlB();
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=${editor}]').dataset.bold ?? null`), '1', 'the editor got its Ctrl+B');
  assert.equal(await pressed(), 'true', 'the pin did not toggle');
  assert.equal(await state(), 'expanded');
});

// D-2010 hover intent: the pane opens after HOVER_REVEAL_MS (150) with the pointer on the rail and folds HOVER_FOLD_MS (300) after it left.
const watchState = () => browser.evaluate(`(() => { const el = document.querySelector('${SIDEBAR}'); window.__seen = []; new MutationObserver(() => window.__seen.push(el.getAttribute('data-state'))).observe(el, { attributes: true, attributeFilter: ['data-state'] }); })()`);
const seen = () => browser.evaluate(`window.__seen`);
const move = (x, y) => browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
const rect = selector => browser.evaluate(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { left: r.left, width: r.width, height: r.height }; })()`);

test('a pointer passing over the rail for under 150ms does not open the pane; held for 150ms or more it does; it folds 300ms after leaving', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  await watchState();
  await move(40, 400);
  await wait(60);
  await move(900, 500);
  await wait(900);
  assert.equal((await seen()).includes('expanded'), false, 'a passing pointer never opened it: ' + JSON.stringify(await seen()));
  await move(40, 400);
  await wait(30);
  assert.equal(await state(), 'collapsed', 'not yet: the intent is still being read');
  await wait(500);
  assert.equal(await state(), 'expanded', 'held: open');
  await move(900, 500);
  await wait(100);
  assert.equal(await state(), 'expanded', 'just left: not folded yet');
  await wait(800);
  assert.equal(await state(), 'collapsed', 'folded after the pointer stayed away');
});

test('keyboard focus opens the pane at once, not after the hover delay', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  await browser.press('Tab');
  await wait(60);
  assert.equal(await state(), 'expanded');
});

test('unpinned, the hover reveal floats over the page on the sidebar surface with a shadow; pinned, the page sits beside the pane', { skip, timeout: 120000 }, async () => {
  await mount();
  await away();
  const folded = await rect('[data-testid=screen-Comptes]');
  await over();
  assert.equal(await state(), 'expanded');
  assert.deepEqual(await rect('[data-testid=screen-Comptes]'), folded, 'the page keeps its left and width while the pane floats over it');
  const inner = prop => browser.evaluate(`getComputedStyle(document.querySelector('${SIDEBAR} [data-slot=sidebar-inner]')).${prop}`);
  assert.notEqual(await inner('boxShadow'), 'none', 'a shadow lifts the floating pane');
  assert.notEqual(await inner('backgroundColor'), 'rgba(0, 0, 0, 0)', 'on the sidebar surface');
  await browser.click(`document.querySelector('${PIN}')`);
  await away();
  const pinned = await rect('[data-testid=screen-Comptes]');
  assert.ok(pinned.left > folded.left + 100 && pinned.width < folded.width - 100, 'pinned: the page reflows beside the pane');
  assert.equal(await inner('boxShadow'), 'none', 'pinned: no floating shadow');
});

test('the pin shows pressed, keeps the collapse toggle\'s footprint and its tooltip names the shortcut', { skip, timeout: 120000 }, async () => {
  await mount();
  await over();
  const unpressed = await pin('getComputedStyle(e).backgroundColor');
  const box = await pin('(r => ({ width: r.width, height: r.height }))(e.getBoundingClientRect())');
  assert.equal(await pin('e.title'), 'Épingler le volet · Ctrl+B');
  await browser.click(`document.querySelector('${PIN}')`);
  await away();
  assert.equal(await pressed(), 'true');
  assert.notEqual(await pin('getComputedStyle(e).backgroundColor'), unpressed, 'pinned looks pressed, not only through aria-pressed');
  assert.equal(await pin('e.title'), 'Désépingler le volet · Ctrl+B');
  assert.equal(await name(), 'Épingler le volet', 'the visible name stays');
  await mount('plain=1');
  const toggle = await rect('[data-slot=sidebar-trigger]');
  assert.ok(Math.abs(toggle.width - box.width) <= 1 && Math.abs(toggle.height - box.height) <= 1, `same box as the collapse toggle: ${JSON.stringify(box)} vs ${JSON.stringify(toggle)}`);
});

test('shots at 1280 light and dark (collapsed, revealed on hover, the pin focused, pinned) and at 390 touch (no hover reveal, the phone sheet opens)', { skip, timeout: 180000 }, async () => {
  for (const mode of ['light', 'dark']) {
    await mount('');
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`);
    await away();
    await browser.screenshot(`sidebar-pin.1280.${mode}.collapsed.png`);
    await over();
    await browser.screenshot(`sidebar-pin.1280.${mode}.hover.png`);
    await away();
    await tab();
    assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('${PIN}')`), true);
    await browser.screenshot(`sidebar-pin.1280.${mode}.focused.png`);
    await browser.press(' ');
    await wait(400);
    await browser.evaluate(`document.activeElement.blur()`);
    await away();
    assert.equal(await pressed(), 'true');
    await browser.screenshot(`sidebar-pin.1280.${mode}.pinned.png`);
  }
  for (const mode of ['light', 'dark']) {
    await mount('sheet=1&dialog=1', { width: 390, touch: true });
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-rail=hover]') === null && document.querySelector('${PIN}') === null`), true, 'a phone has no hover rail and no pin');
    await browser.screenshot(`sidebar-pin.390.${mode}.closed.png`);
    await browser.tap(`document.querySelector('[data-slot=sidebar-trigger]')`);
    await wait(700);
    assert.equal(await browser.evaluate(`document.querySelector('[data-mobile=true]') !== null`), true, 'the phone sheet opens');
    await browser.screenshot(`sidebar-pin.390.${mode}.sheet.png`);
  }
  assert.deepEqual(browser.problems, []);
});
