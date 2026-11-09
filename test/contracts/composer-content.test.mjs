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
  // Leave the previous page before resizing: resizing a phone page with its drawer open closes the drawer, whose `history.back()` (it lets go
  // of its Back entry) lands after a navigation that started meanwhile and cancels it, leaving the old page in place.
  await browser.send('Page.navigate', { url: 'about:blank' });
  await browser.until('previous page left', `location.href === 'about:blank'`);
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
  // The old document answers readyState complete until the navigation commits: wait for the new URL, not only for a mounted shell.
  const search = JSON.stringify(query ? '?' + query : '');
  try {
    await browser.until('shell mounted', `location.search === ${search} && window.__layer !== undefined && !!document.querySelector('[data-testid=app-shell]') && document.readyState === 'complete'`);
  } catch (error) {
    // Name the condition that never held, so a timeout says why.
    const seen = await browser.evaluate(`JSON.stringify({ search: location.search, wanted: ${search}, layer: window.__layer !== undefined, shell: !!document.querySelector('[data-testid=app-shell]'), ready: document.readyState })`).catch(() => 'unreadable');
    throw new Error(`${error.message}\nseen: ${seen}`);
  }
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

test('1280, composer=content: a send opens the reply as a tray, Dock moves the same thread to the pane, closing the dock goes back to the tray', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  const before = await rect('[data-testid=composer-dock]');
  await type('How much was the bread?');
  await browser.evaluate(`document.querySelector('[data-testid=composer-submit]').click()`);
  await browser.until('tray open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.until('reply', `document.querySelector('[data-testid=agent-tray]').textContent.includes('Noted, fictional answer.')`);
  assert.deepEqual(await browser.evaluate(`window.__sent`), ['How much was the bread?'], 'the one controller sent it');
  assert.equal(await state(), 'closed', 'not straight in the dock');
  assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-tray]'), true, 'the thread is in the tray');
  assert.equal(await count('[data-testid=composer]'), 1, 'still one composer');
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-tray]'), false, 'and not in the tray');
  const after = await rect('[data-testid=composer-dock]');
  assert.ok(Math.abs(after.bottom - before.bottom) <= 1, 'the field kept its place at the bottom');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-dock]').click()`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'the tray is gone');
  assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-layer]'), true, 'the thread is in the dock');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-layer]').textContent.includes('Noted, fictional answer.')`), true, 'the same thread');
  assert.equal(await count('[data-testid=composer]'), 1);
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-layer]'), false, 'no second composer in the dock');
  await browser.evaluate(`document.querySelector('[data-testid=agent-layer-close]').click()`);
  await browser.until('dock closed', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'closed'`);
  assert.equal(await count('[data-testid=composer]'), 1, 'closing the dock leaves the composer');
  assert.equal(await inside('[data-testid=composer]', '[data-boring=dock-main]'), true);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('tray again', `!!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await state(), 'closed', 'closing the dock went back to the tray mode');
});

test('1280, composer=content: talkAbout opens the tray and the cited row is a chip in the one composer', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await browser.evaluate(`window.__layer.talkAbout('@meal:2026-10-27/lunch')`);
  await browser.until('tray open', `!!document.querySelector('[data-testid=agent-tray]')`);
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

test('1280, the default composer="dock" is unchanged: the one composer is in the dock, no tray', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await count('[data-testid=composer]'), 1);
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-layer]'), true);
  assert.equal(await count('[data-testid=agent-content-composer]'), 0, 'no content slot');
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'no tray');
});

test('390, composer=content: nothing changes, the peek drawer holds the one composer', { skip, timeout: 120000 }, async () => {
  await open(390, 'composer=content');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-content-composer]')?.childElementCount ?? 0`), 0, 'nothing drawn in the content slot on a phone');
  await browser.evaluate(`window.__layer.open('agent', 'peek')`);
  await browser.until('peek', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'peek'`);
  await wait(900);
  assert.equal(await count('[data-testid=composer]'), 1);
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-layer]'), true, 'the composer is in the drawer');
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'no tray on a phone');
});

const resize = async width => {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 844 : 800, deviceScaleFactor: 1, mobile: width < 768 });
  await wait(600);
};

test('composer=content: a screen keeps its local state across the breakpoint, both ways', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await browser.evaluate(`document.querySelector('[data-testid=counter]').click(); document.querySelector('[data-testid=counter]').click()`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=counter]').textContent`), 'Count 2');
  await resize(390);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=counter]')?.textContent`), 'Count 2', 'kept going to the phone');
  await resize(1280);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=counter]')?.textContent`), 'Count 2', 'and coming back');
  assert.equal(await count('[data-testid=composer]'), 1);
});

test('composer=content: the focused field keeps focus, its selection and its draft across the breakpoint', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await type('Bread and cheese');
  await browser.evaluate(`(() => { const input = document.querySelector('[data-testid=composer-input]'); input.setSelectionRange(6, 9); })()`);
  await resize(390);
  await browser.evaluate(`window.__layer.open('agent', 'peek')`);
  await wait(900);
  await resize(1280);
  const kept = await browser.evaluate(`(() => { const input = document.querySelector('[data-testid=composer-input]'); return { focused: document.activeElement === input, value: input.value }; })()`);
  assert.equal(kept.value, 'Bread and cheese', 'the draft survives');
  // Focus is only carried when the field had it at the crossing: focus it in the drawer, then cross.
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus(); document.querySelector('[data-testid=composer-input]').setSelectionRange(6, 9)`);
  await resize(390);
  await browser.evaluate(`window.__layer.open('agent', 'peek')`);
  await wait(900);
  await browser.evaluate(`(() => { const input = document.querySelector('[data-testid=composer-input]'); input.focus(); input.setSelectionRange(6, 9); })()`);
  await resize(1280);
  const crossed = await browser.evaluate(`(() => { const input = document.querySelector('[data-testid=composer-input]'); return { focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd }; })()`);
  assert.deepEqual(crossed, { focused: true, start: 6, end: 9 }, 'focus and selection carried across');
});

test('1280, composer=content: sending a voice message opens the tray on the same thread like a typed one', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content&voice=1');
  assert.equal(await state(), 'closed');
  await browser.evaluate(`document.querySelector('[data-testid=fake-voice]').click()`);
  await browser.until('tray open', `!!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await state(), 'closed', 'not the dock');
  assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-tray]'), true, 'the thread is in the tray');
});

const sendFromField = async text => {
  await type(text);
  await browser.evaluate(`document.querySelector('[data-testid=composer-submit]').click()`);
  await browser.until('tray open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await wait(500);
};
const activeIn = selector => browser.evaluate(`!!document.activeElement && document.activeElement !== document.body && !!document.querySelector('${selector}')?.contains(document.activeElement)`);

test('1280, composer=content: the tray sits above the field at its width, the content shrinks above it, the cited row is in view, the header has Dock, Agrandir, Réduire', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content&rows=30');
  await browser.evaluate(`(() => { document.querySelector('[data-testid=screen-week]').scrollTop = 0; document.querySelector('[data-testid=cite-30]').focus({ preventScroll: true }); })()`);
  const pageBefore = await rect('[data-testid=screen-week]');
  await browser.evaluate(`document.querySelector('[data-testid=cite-30]').click()`);
  await browser.until('tray open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await wait(700);
  const tray = await rect('[data-testid=agent-tray]'), body = await rect('[data-testid=agent-tray-body]'), field = await rect('[data-testid=composer]');
  const column = await rect('[data-testid=agent-content]'), page = await rect('[data-testid=screen-week]'), row = await rect('[data-testid=cite-30]');
  assert.ok(Math.abs(body.w - field.w) <= 1, `the tray is the field's width (${body.w} vs ${field.w})`);
  assert.ok(tray.bottom <= field.y + 1, 'above the field');
  const wanted = Math.min(column.h * 0.35, 360);
  assert.ok(Math.abs(tray.h - wanted) <= 3, `min(35% of the content, 360px): ${tray.h} vs ${wanted}`);
  assert.ok(page.h < pageBefore.h - 100 && page.bottom <= tray.y + 1, 'the content column shrank above the tray instead of being covered');
  assert.ok(row.y >= page.y - 1 && row.bottom <= tray.y + 1, 'the cited row was scrolled into view above the tray');
  assert.equal(await count('[data-testid=composer]'), 1, 'one composer');
  assert.equal(await inside('[data-testid=composer]', '[data-testid=agent-tray]'), false, 'the field below is the only input');
  const labels = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-tray-header] button')].map(button => button.getAttribute('aria-label'))`);
  assert.equal(labels.length, 3, `three header controls (${labels})`);
  assert.ok(labels[0].startsWith('Dock on') && labels[1] === 'Expand' && labels[2] === 'Collapse', `Dock, Agrandir, Réduire (${labels})`);
  assert.ok((await browser.evaluate(`document.querySelector('[data-testid=agent-tray-header] h2').textContent`)).length > 0, 'the thread title');
});

test('1280, composer=content: Agrandir fills the main column, Réduire goes back to the bare field with focus on it and keeps the thread', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await sendFromField('How much was the bread?');
  const small = await rect('[data-testid=agent-tray]');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-grow]').focus(); document.querySelector('[data-testid=agent-tray-grow]').click()`);
  await wait(500);
  const column = await rect('[data-testid=agent-content]'), field = await rect('[data-testid=composer-dock]'), big = await rect('[data-testid=agent-tray]');
  assert.ok(big.h > small.h * 1.5 && Math.abs(big.y - column.y) <= 2 && big.bottom <= field.y + 1, `the tray fills the column above the field (${big.h} from ${small.h})`);
  assert.equal(await state(), 'closed', 'not a modal, not the dock');
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'agent-tray-grow', 'focus stays on Agrandir');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-reduce]').click()`);
  await browser.until('tray gone', `!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'composer-input', 'Réduire returns focus to the field');
  assert.equal(await count('[data-testid=composer]'), 1);
  await type('And the cheese?');
  await browser.evaluate(`document.querySelector('[data-testid=composer-submit]').click()`);
  await browser.until('tray back', `!!document.querySelector('[data-testid=agent-tray]')`);
  const text = await browser.evaluate(`document.querySelector('[data-testid=agent-tray]').textContent`);
  assert.ok(text.includes('How much was the bread?') && text.includes('And the cheese?'), 'the next send reopens the same thread');
});

test('1280, composer=content: Esc goes back to the bare field, but not while a menu is open or an IME is composing', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await sendFromField('How much was the bread?');
  await browser.evaluate(`(() => { const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.id = 'fake-menu'; document.body.append(menu); })()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(300);
  assert.equal(await count('[data-testid=agent-tray]'), 1, 'an open menu keeps Esc');
  await browser.evaluate(`document.getElementById('fake-menu').remove()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.until('tray gone', `!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await count('[data-testid=composer]'), 1);
});

test('1280, composer=content: Dock puts focus on a dock control, never on the body; the choice is the default for the next send, after a reload', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await sendFromField('How much was the bread?');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-dock]').focus(); document.querySelector('[data-testid=agent-tray-dock]').click()`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await wait(300);
  assert.equal(await activeIn('[data-testid=agent-layer]'), true, 'focus is on a dock control');
  await open(1280, 'composer=content&keep=1');
  await type('And the cheese?');
  await browser.evaluate(`document.querySelector('[data-testid=composer-submit]').click()`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'the remembered choice (dock) is the default for the next send');
  await browser.evaluate(`document.querySelector('[data-testid=agent-layer-close]').click()`);
  await open(1280, 'composer=content&keep=1');
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('tray', `!!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await state(), 'closed', 'closing the dock went back to the tray, and that is remembered');
});

test('1280, composer="dock" has no tray; 390 has no tray (the peek drawer)', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=dock');
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await count('[data-testid=agent-tray]'), 0);
  await open(390, 'composer=content');
  await browser.evaluate(`window.__layer.talkAbout('@meal:2026-10-27/lunch')`);
  await browser.until('drawer', `['half', 'peek'].includes(document.querySelector('[data-testid=agent-layer]')?.dataset.state)`);
  assert.equal(await count('[data-testid=agent-tray]'), 0);
});

test('1280, composer=content: the tray-or-dock choice is kept per app (D-1919 keys), not for the whole origin', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content&app=alpha');
  await sendFromField('How much was the bread?');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-dock]').click()`);
  await browser.until('alpha dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  const stored = await browser.evaluate(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('boring-ui:sidebar-agent-mode')).map(key => [key, localStorage.getItem(key)])))`);
  assert.equal(stored, JSON.stringify({ 'boring-ui:sidebar-agent-mode-screen:alpha': 'dock' }), `the dock choice is stored under the app (${await browser.evaluate('location.search')})`);
  await open(1280, 'composer=content&keep=1&app=beta');
  await type('And the cheese?');
  await browser.evaluate(`document.querySelector('[data-testid=composer-submit]').click()`);
  await browser.until('tray open', `!!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await state(), 'closed', 'another app on the same origin starts with the tray');
  await open(1280, 'composer=content&keep=1&app=alpha');
  await type('And the cheese?');
  await browser.evaluate(`document.querySelector('[data-testid=composer-submit]').click()`);
  await browser.until('alpha dock open again', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'the first app kept its choice');
});

test('1280, composer=content: the tray Dock puts the thread in the docked side pane even after the dock was floated', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await sendFromField('How much was the bread?');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-dock]').click()`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await browser.evaluate(`document.querySelector('[data-testid=agent-layer-float]').click()`);
  await browser.until('floating', `document.querySelector('[data-testid=agent-layer]')?.dataset.placement === 'floating'`);
  await browser.evaluate(`document.querySelector('[data-testid=agent-layer-close]').click()`);
  await browser.until('closed', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'closed'`);
  await sendFromField('And the cheese?');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-dock]').click()`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-layer]').dataset.placement`), 'docked', 'docked, not floating');
});

test('1280, composer=content: Esc from a host dock beside the content (outside the tray and the field) leaves the tray and the focus alone', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await sendFromField('How much was the bread?');
  await browser.evaluate(`(() => { const side = document.createElement('button'); side.id = 'host-dock'; side.textContent = 'host'; document.body.append(side); side.focus(); })()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(300);
  assert.equal(await count('[data-testid=agent-tray]'), 1, 'the tray stays');
  assert.equal(await browser.evaluate(`document.activeElement?.id`), 'host-dock', 'focus stays where it was');
});

test('1280, composer=content: each person has their own tray-or-dock choice, applied when the account switches without a remount, and focus lands on the field', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content&person=b@example.org');
  await sendFromField('How much was the bread?');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-dock]').click()`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await open(1280, 'composer=content&keep=1&person=a@example.org');
  await sendFromField('And the cheese?');
  assert.equal(await state(), 'closed', 'person A has no stored choice: the tray');
  await browser.evaluate(`document.querySelector('[data-testid=agent-tray-grow]').focus()`);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid === 'agent-tray-grow'`), true, 'focus is on Agrandir');
  await browser.evaluate(`window.__person('b@example.org')`);
  await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, "person B's stored choice (dock) is applied after the switch");
  await wait(300);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid === 'composer-input'`), true, 'focus moved to the one field, not the body');
  await browser.evaluate(`window.__person('a@example.org')`);
  await browser.until('tray', `!!document.querySelector('[data-testid=agent-tray]') || document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'closed'`);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('tray', `!!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await state(), 'closed', "back to person A's choice (the tray)");
});

for (const dark of [false, true]) {
  test(`shoot composer=content, ${dark ? 'dark' : 'light'}: 1280 dock closed, dock open, 390 peek`, { skip, timeout: 120000 }, async () => {
    const name = dark ? 'dark' : 'light', query = `composer=content${dark ? '&dark=1' : ''}`;
    await open(1280, query);
    await browser.screenshot(`composer-content-1280-${name}-dock-closed.png`);
    await open(1280, query + '&rows=12');
    await browser.evaluate(`document.querySelector('[data-testid=screen-week]').scrollTop = 0; document.querySelector('[data-testid=cite-12]').focus({ preventScroll: true })`);
    await browser.evaluate(`document.querySelector('[data-testid=cite-12]').click()`);
    await browser.until('tray open', `!!document.querySelector('[data-testid=agent-tray]')`);
    await wait(700);
    await browser.screenshot(`composer-content-1280-${name}-tray.png`);
    await browser.evaluate(`document.querySelector('[data-testid=agent-tray-grow]').click()`);
    await wait(500);
    await browser.screenshot(`composer-content-1280-${name}-tray-grown.png`);
    await browser.evaluate(`document.querySelector('[data-testid=agent-tray-reduce]').click()`);
    await browser.until('tray gone', `!document.querySelector('[data-testid=agent-tray]')`);
    await browser.evaluate(`window.__layer.open('agent')`);
    await browser.until('tray', `!!document.querySelector('[data-testid=agent-tray]')`);
    await browser.evaluate(`document.querySelector('[data-testid=agent-tray-dock]').click()`);
    await browser.until('dock open', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
    await wait(700);
    await browser.screenshot(`composer-content-1280-${name}-tray-docked.png`);
    await browser.screenshot(`composer-content-1280-${name}-dock-open.png`);
    await open(390, query);
    await browser.evaluate(`window.__layer.open('agent', 'peek')`);
    await browser.until('peek', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'peek'`);
    await wait(900);
    await browser.screenshot(`composer-content-390-${name}-peek.png`);
  });
}
