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

// D-1978 slice 1: the agent bar and the status line. A real Chromium mounts the public `agent-bar` block (test/fixtures/themes/agent-bar.jsx, with a fake
// microphone and a fake transcriber) at 390 touch and 1280 fine, light and dark, and drives it with real input: type and send, tap the mic (listening),
// stop, cancel, hold to talk and release, slide off, the quoted chip, the status line. Shots go to .cache/evidence/agent-bar (or EVIDENCE_DIR), which CI uploads
// as `agent-bar-shots`. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EVIDENCE_DIR ?? join(root, '.cache/evidence/agent-bar');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/agent-bar-'));
  const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/agent-bar.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'agent-bar'].map(name => registryCss(item(name))).join('\n')}`;
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
let touch = false;
const open = async (width, theme, query = '') => {
  touch = width < 768;
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: touch ? 844 : 800, deviceScaleFactor: 1, mobile: touch });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
  const search = `${query}${query ? '&' : ''}dark=${theme === 'dark' ? 1 : 0}`;
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${search}` });
  await browser.until('fixture mounted', `location.search === ${JSON.stringify('?' + search)} && !!document.querySelector('[data-testid=agent-bar]') && document.readyState === 'complete'`);
  await wait(300);
};
const label = name => `document.querySelector('[aria-label=${JSON.stringify(name)}]')`;
const has = name => browser.evaluate(`!!${label(name)}`);
const sent = () => browser.evaluate(`JSON.stringify(window.__sent)`).then(JSON.parse);
const stateOf = () => browser.evaluate(`document.querySelector('[data-testid=agent-bar]').dataset.state`);
const rectOf = expression => browser.evaluate(`(() => { const e = ${expression}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const press = name => touch ? browser.tap(label(name)) : browser.click(label(name));
const shot = name => browser.screenshot(`${name}.png`);
// A finger or a mouse button held on `selector`, then moved and let go: the real input the hold gesture reads.
const hold = async (selector, { ms = 500, slide = 0 } = {}) => {
  const box = await rectOf(selector);
  const x = box.x + box.w / 2, y = box.y + box.h / 2;
  const down = () => touch ? browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  const move = (dx, dy) => touch ? browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] }) : browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx, y: y + dy, button: 'left', buttons: 1 });
  const up = (dx, dy) => touch ? browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
  await down();
  await wait(ms);
  return { move, up, slide: async () => { for (let i = 1; i <= 6; i++) await move(0, -slide * i / 6); await wait(100); }, x, y };
};
const typeInto = async text => {
  await browser.click(`document.querySelector('[data-testid=agent-bar-input]')`);
  await browser.send('Input.insertText', { text });
};
const spoken = 'Au goûter une part de tarte aux pommes';

for (const [width, theme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
  test(`the agent bar and the status line (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    const at = `${width}-${theme}`;
    await open(width, theme);
    // Rest: the pill with its history arrow, the field, the mic and a muted send.
    const input = `document.querySelector('[data-testid=agent-bar-input]')`;
    assert.equal(await browser.evaluate(`${input}.placeholder`), 'Maintiens pour parler');
    assert.equal(await stateOf(), 'rest');
    for (const name of ['Historique', 'Parler', 'Envoyer']) assert.equal(await has(name), true, `${name} button`);
    assert.equal(await browser.evaluate(`${label('Envoyer')}.disabled`), true, 'send is disabled while the field is empty');
    const bar = await rectOf(`document.querySelector('[data-testid=agent-bar]')`);
    if (width === 390) assert.equal(await browser.evaluate('document.scrollingElement.scrollWidth <= 390'), true, 'no horizontal scroll at 390');
    else assert.equal(bar.w <= 640 && bar.w >= 400, true, `the bar keeps a sensible width on desktop, got ${bar.w}`);
    await shot(`rest-${at}`);

    // Typed text: ↑ sends once and clears; Enter sends too.
    await typeInto('une pomme');
    assert.equal(await browser.evaluate(`${label('Envoyer')}.disabled`), false);
    await press('Envoyer');
    await browser.until('sent', `window.__sent.length === 1`);
    assert.deepEqual(await sent(), [{ text: 'une pomme' }]);
    assert.equal(await browser.evaluate(`${input}.value`), '');
    assert.equal(await browser.evaluate(`${label('Envoyer')}.disabled`), true);
    await typeInto('un café');
    await browser.press('Enter');
    await browser.until('sent by Enter', `window.__sent.length === 2`);
    assert.deepEqual(await sent(), [{ text: 'une pomme' }, { text: 'un café' }]);

    // History: the arrow reports the tap and flips (aria-expanded).
    assert.equal(await browser.evaluate(`${label('Historique')}.getAttribute('aria-expanded')`), 'false');
    await press('Historique');
    await browser.until('history', `window.__history === 1 && ${label('Historique')}.getAttribute('aria-expanded') === 'true'`);
    await press('Historique');

    // One tap on the mic: listening, outlined, with Annuler, Arrêter and Envoyer; Arrêter hands the audio to transcribe and the text lands in the field.
    await press('Parler');
    await browser.until('listening', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'listening'`);
    for (const name of ['Annuler', 'Arrêter', 'Envoyer']) assert.equal(await has(name), true, `${name} while listening`);
    assert.equal(await has('Parler'), false, 'no mic while listening');
    const outline = await browser.evaluate(`(() => { const probe = document.createElement('i'); probe.style.color = 'var(--primary)'; document.body.append(probe); const primary = getComputedStyle(probe).color; probe.remove();
      const style = getComputedStyle(document.querySelector('[data-testid=agent-bar]')); return { primary, border: style.borderColor, shadow: style.boxShadow }; })()`);
    assert.equal(outline.border === outline.primary || outline.shadow.includes(outline.primary), true, `the listening bar is outlined in primary: ${JSON.stringify(outline)}`);
    await shot(`listening-${at}`);
    await press('Arrêter');
    await browser.until('text landed', `${input}.value === ${JSON.stringify(spoken)}`);
    assert.equal(await stateOf(), 'rest');
    assert.equal(await browser.evaluate(`window.__transcribed.length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-transcript]')?.textContent`), spoken, 'the final text shows above the bar');
    assert.equal((await sent()).length, 2, 'stopping sends nothing');
    await press('Envoyer');
    await browser.until('sent the dictation', `window.__sent.length === 3`);
    assert.deepEqual((await sent())[2], { text: spoken });

    // ✕ cancels without sending and releases the microphone.
    await press('Parler');
    await browser.until('listening again', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'listening'`);
    await press('Annuler');
    await browser.until('back to rest', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'rest'`);
    assert.equal(await browser.evaluate(`window.__transcribed.length`), 1, 'cancel transcribes nothing');
    assert.equal((await sent()).length, 3, 'cancel sends nothing');
    assert.equal(await browser.evaluate(`window.__tracks.opened === window.__tracks.released`), true, 'every opened microphone is released');

    // Hold: « Relâche pour envoyer », release sends the transcript.
    let gesture = await hold(label('Parler'));
    assert.equal(await stateOf(), 'holding');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar]').textContent.includes('Relâche pour envoyer')`), true);
    await shot(`holding-${at}`);
    await gesture.up(0, 0);
    await browser.until('sent on release', `window.__sent.length === 4`);
    assert.deepEqual((await sent())[3], { text: spoken });
    assert.equal(await browser.evaluate(`window.__transcribed.length`), 2);
    await browser.until('rest after release', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'rest'`);

    // Slide off while holding: cancelled, nothing sent, nothing transcribed.
    gesture = await hold(label('Parler'), { slide: 200 });
    assert.equal(await stateOf(), 'holding');
    await gesture.slide();
    await gesture.up(0, -200);
    await browser.until('cancelled by sliding off', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'rest'`);
    await wait(300);
    assert.equal((await sent()).length, 4, 'a slide off sends nothing');
    assert.equal(await browser.evaluate(`window.__transcribed.length`), 2, 'a slide off transcribes nothing');

    // 44px targets on touch; no smaller than the kit's 36px on a fine pointer.
    const floor = width === 390 ? 44 : 36;
    for (const name of ['Historique', 'Parler', 'Envoyer']) {
      const r = await rectOf(label(name));
      assert.equal(r.w >= floor && r.h >= floor, true, `${name} is ${r.w}x${r.h}, at least ${floor}`);
    }
  });

  // D-1978 review fixes, one per finding, each driven with real input.
  test(`the bar survives drift, a refused microphone and slow transcription, and keeps focus (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    if (theme === 'dark') return;
    const focused = `(document.activeElement?.dataset?.testid ?? document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)`;
    // P1: the mic moves to the left while held; 1px of drift is not a slide off, and the release still sends.
    await open(width, theme);
    let gesture = await hold(label('Parler'));
    assert.equal(await stateOf(), 'holding');
    await gesture.move(1, 0); await wait(150); await gesture.move(3, 2); await wait(150);
    assert.equal(await stateOf(), 'holding', 'a 1px drift keeps recording');
    await gesture.up(3, 2);
    await browser.until('sent after a drifting hold', `window.__sent.length === 1`);
    assert.deepEqual(await sent(), [{ text: spoken }]);

    // P4: a tap on the mic moves focus to ■ Arrêter; stopping or cancelling gives it back to the field.
    await browser.until('rest again', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'rest'`);
    await press('Parler');
    await browser.until('listening', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'listening'`);
    assert.equal(await browser.evaluate(focused), 'agent-bar-stop', 'focus is on Arrêter while listening');
    await press('Arrêter');
    await browser.until('text landed', `document.querySelector('[data-testid=agent-bar-input]')?.value === ${JSON.stringify(spoken)}`);
    assert.equal(await browser.evaluate(focused), 'agent-bar-input', 'focus is back in the field after stop');
    await press('Parler');
    await browser.until('listening again', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'listening'`);
    assert.equal(await browser.evaluate(focused), 'agent-bar-stop');
    await press('Annuler');
    await browser.until('rest after cancel', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'rest'`);
    assert.equal(await browser.evaluate(focused), 'agent-bar-input', 'focus is back in the field after cancel');

    // P5: the host's own Button and Input keep their shadcn look, and the block ships no rule that restyles them.
    const css = registryCss(item('agent-bar'));
    const loose = [...css.matchAll(/([^{}]*data-slot=["']?(?:button|input)[^{}]*)\{/g)].map(match => match[1].trim()).filter(selector => !selector.includes('[data-agent-bar]'));
    assert.deepEqual(loose, [], 'every rule that touches a shadcn button or input must target the block own marked parts only');
    const look = await browser.evaluate(`(() => {
      const radius = value => { const p = document.createElement('i'); p.style.borderRadius = value; document.body.append(p); const r = getComputedStyle(p).borderTopLeftRadius; p.remove(); return r; };
      const button = getComputedStyle(document.querySelector('[data-testid=host-button]')), field = getComputedStyle(document.querySelector('[data-testid=host-input]'));
      const mic = getComputedStyle(${label('Parler')}), own = getComputedStyle(document.querySelector('[data-testid=agent-bar-input]'));
      return { lg: radius('var(--radius-lg)'), xl3: radius('var(--radius-3xl)'), button: button.borderTopLeftRadius, field: field.borderTopLeftRadius, fieldBorder: field.borderTopWidth, fieldBg: field.backgroundColor, mic: mic.borderTopLeftRadius, ownBg: own.backgroundColor, ownShadow: own.boxShadow };
    })()`);
    assert.equal(look.button, look.lg, `the host Button keeps its radius: ${JSON.stringify(look)}`);
    assert.equal(look.field, look.lg, `the host Input keeps its radius: ${JSON.stringify(look)}`);
    assert.equal(look.fieldBorder, '1px'); assert.notEqual(look.fieldBg, 'rgba(0, 0, 0, 0)', 'the host Input keeps its background');
    assert.equal(look.mic, look.xl3, `the bar's own mic is round: ${JSON.stringify(look)}`);
    assert.equal(look.ownBg, 'rgba(0, 0, 0, 0)', 'the bar field is flat'); assert.equal(look.ownShadow, 'none');
  });

  test(`a refused microphone leaves the bar at rest with the error (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    if (theme === 'dark') return;
    await open(width, theme, 'deny=1');
    const gesture = await hold(label('Parler'), { ms: 50 });
    await gesture.up(0, 0);
    await wait(500);
    assert.equal(await stateOf(), 'rest', 'a refused tap does not leave the bar listening');
    assert.equal(await browser.evaluate(`document.querySelector('[role=alert]')?.textContent ?? ''`), 'Le micro est refusé. Autorise-le dans les réglages du navigateur.');
    assert.equal(await has('Arrêter'), false);
    assert.equal((await sent()).length, 0);
  });

  test(`Annuler and Escape work while the transcription is slow (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    if (theme === 'dark') return;
    await open(width, theme, 'slow=1');
    for (const how of ['Annuler', 'Escape']) {
      const gesture = await hold(label('Parler'));
      await gesture.up(0, 0);
      await browser.until('transcribing', `document.querySelector('[data-testid=agent-bar]').dataset.state === 'transcribing'`);
      if (how === 'Annuler') { assert.equal(await has('Annuler'), true, 'Annuler stays available while transcribing'); await press('Annuler'); }
      else await browser.press('Escape');
      await wait(2000);
      assert.equal(await stateOf(), 'rest', `${how} returns to rest`);
      assert.equal((await sent()).length, 0, `${how} during transcription sends nothing`);
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-input]')?.value`), '', `${how} puts nothing in the field`);
    }
  });

  test(`the status line and the quoted chip (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    const at = `${width}-${theme}`;
    const floor = width === 390 ? 44 : 36;
    // Working: a spinner, the sentence and « Annuler » (calls onCancel).
    await open(width, theme, 'status=working');
    const status = `document.querySelector('[data-testid=agent-status]')`;
    assert.equal(await browser.evaluate(`${status}.dataset.state`), 'working');
    assert.equal(await browser.evaluate(`${status}.textContent.includes('Max compte la tarte…')`), true);
    assert.equal(await browser.evaluate(`!!${status}.querySelector('[data-testid=agent-status-spinner]')`), true);
    assert.equal(await browser.evaluate(`!!${status}.querySelector('[data-testid=agent-status-check]')`), false);
    const cancel = await rectOf(`${status}.querySelector('button')`);
    assert.equal(cancel.h >= floor, true, `Annuler is ${cancel.h}px high`);
    await shot(`working-${at}`);
    await browser.click(`${status}.querySelector('button')`);
    assert.equal(await browser.evaluate('window.__cancelled'), 1);
    // Done: the check and the final sentence, no Annuler.
    await open(width, theme, 'status=done');
    assert.equal(await browser.evaluate(`${status}.dataset.state`), 'done');
    assert.equal(await browser.evaluate(`${status}.textContent.includes('Tarte vérifiée : 285 kcal')`), true);
    assert.equal(await browser.evaluate(`!!${status}.querySelector('[data-testid=agent-status-check]')`), true);
    assert.equal(await browser.evaluate(`!!${status}.querySelector('[data-testid=agent-status-spinner]')`), false);
    assert.equal(await browser.evaluate(`${status}.querySelectorAll('button').length`), 0, 'no Annuler once done');
    await shot(`done-${at}`);
    // Quoted: the chip, a bar outlined in primary, ✕ clears, and the send carries the quote.
    await open(width, theme, 'quoted=1');
    const chip = `document.querySelector('[data-testid=agent-bar-quoted]')`;
    assert.equal(await browser.evaluate(`${chip}.textContent.includes('Tarte aux pommes')`), true);
    assert.equal(await has('Retirer la citation'), true);
    const remove = await rectOf(label('Retirer la citation'));
    assert.equal(remove.w >= floor && remove.h >= floor, true, `the chip's ✕ is ${remove.w}x${remove.h}`);
    await typeInto('c’était une tarte fine');
    await shot(`quoted-${at}`);
    await press('Envoyer');
    await browser.until('sent with the quote', `window.__sent.length === 1`);
    assert.deepEqual(await sent(), [{ text: 'c’était une tarte fine', quoted: 'Tarte aux pommes' }]);
    await press('Retirer la citation');
    await browser.until('chip cleared', `window.__cleared === 1 && !${chip}`);
    assert.equal(await has('Retirer la citation'), false);
    assert.deepEqual(browser.problems, []);
  });
}
