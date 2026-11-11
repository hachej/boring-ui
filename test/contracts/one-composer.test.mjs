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

// D-2198: one composer for the bar and the chat. A real Chromium mounts the real AppShell with composer="bar" over a scripted controller
// (test/fixtures/themes/one-composer.jsx) and walks Ambiant, send, Ouvert, Ancré, the preview and back, counting the message fields at every step;
// then the folded card (the tool's words, a two-question form, a reply with its dot) and the phone. The shots go to .cache/evidence/composer-content
// (CI artifact `composer-content-shots`), named one-composer-*. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = join(root, '.cache/evidence/composer-content');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(root, '.cache/one-composer-'));
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/one-composer.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'pi-chat-mentions', 'pi-chat-attachments', 'pi-chat-slash', 'agent-bar'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
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
  await browser.send('Page.navigate', { url: 'about:blank' });
  await browser.until('previous page left', `location.href === 'about:blank'`);
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
  const search = JSON.stringify(query ? '?' + query : '');
  await browser.until('shell mounted', `location.search === ${search} && window.__layer !== undefined && !!document.querySelector('[data-testid=app-shell]') && document.readyState === 'complete'`);
  await wait(400);
};
const js = value => JSON.stringify(value);
const count = selector => browser.evaluate(`document.querySelectorAll(${js(selector)}).length`);
const rect = selector => browser.evaluate(`(() => { const e = document.querySelector(${js(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`);
const inside = (inner, outer) => browser.evaluate(`!!document.querySelector(${js(inner)}) && !!document.querySelector(${js(outer)})?.contains(document.querySelector(${js(inner)}))`);
const click = selector => browser.evaluate(`document.querySelector(${js(selector)}).click()`);
const text = selector => browser.evaluate(`document.querySelector(${js(selector)})?.textContent ?? null`);
const dockState = () => browser.evaluate(`document.querySelector('[data-testid=agent-layer]')?.dataset.state`);
const actionName = () => browser.evaluate(`(document.querySelector('[data-testid=composer-when-empty] button') ?? document.querySelector('[data-testid=composer-submit]'))?.getAttribute('aria-label')`);
const type = async value => {
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.send('Input.insertText', { text: value });
};
const FIELD = '[data-testid=composer-input]';
const oneField = async step => assert.equal(await count(FIELD), 1, `exactly one message field in the DOM (${step})`);

test('1280: Ambiant, send, Ouvert, Ancré, Détacher, Fermer: one field at every step, and the right button says Dicter, Envoyer, Arrêter (AC-1, AC-2, AC-3)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await oneField('ambient');
  assert.equal(await inside(FIELD, '[data-testid=agent-content-composer]'), true, 'ambient: the field is under the page');
  assert.equal(await dockState(), 'closed');
  assert.equal(await count('[data-testid=agent-tray]'), 0);
  assert.equal(await inside('[data-testid=agent-bar-conversation]', '[data-testid=composer]'), true, 'the chevron is the field\'s first button');
  assert.equal(await count('[data-testid=composer-bar-attach]'), 1, 'attach is a bar button');
  assert.equal(await count('[data-testid=composer-bar-commands]') + await count('[data-testid=composer-plus]'), 0, 'no Actions button and no + menu');
  assert.equal(await actionName(), 'Dicter', 'empty field: the one action button dictates');
  // « / » typed opens the actions.
  await type('/');
  await browser.until('slash list', `!!document.querySelector('[data-testid=slash-item][data-name=relance]')`);
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.press('Escape');
  await browser.press('Backspace');
  await browser.until('field empty again', `document.querySelector('[data-testid=composer-input]').value === ''`);
  await type('Combien de pièces manquent ?');
  assert.equal(await actionName(), 'Envoyer', 'text in the field: the one action button sends');
  const field = await rect('[data-testid=composer]');
  await click('[data-testid=composer-submit]');
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.until('reply in the thread', `document.querySelector('[data-testid=agent-tray]').textContent.includes('Réponse fictive : noté.')`);
  assert.deepEqual(await browser.evaluate('window.__sent'), ['Combien de pièces manquent ?']);
  await oneField('open');
  const tray = await rect('[data-testid=agent-tray]'), after = await rect('[data-testid=composer]');
  assert.ok(tray.bottom <= after.y + 1, `Ouvert: the thread sits above the field (${tray.bottom} <= ${after.y})`);
  assert.ok(Math.abs(after.bottom - field.bottom) <= 1, 'the field kept its place');
  assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-tray]'), true);
  // Ancré: the thread and the field in the right column, nothing at the bottom.
  await click('[data-testid=agent-tray-dock]');
  await browser.until('Ancré', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await wait(300);
  await oneField('docked');
  assert.equal(await inside(FIELD, '[data-testid=agent-layer]'), true, 'docked: the field is in the right column');
  assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-layer]'), true, 'with the thread');
  assert.equal(await browser.evaluate(`document.querySelector('[data-boring=dock-main] [data-testid=composer-input]') === null`), true, 'no field at the bottom of the page');
  assert.equal(await count('[data-testid=agent-tray]'), 0);
  const layer = await rect('[data-testid=agent-layer]'), main = await rect('[data-boring=dock-main]');
  assert.ok(layer.x >= main.right - 1 && layer.h >= 700, `a full-height right column (${JSON.stringify(layer)})`);
  // Détacher en bas: back to Ouvert, the field under the page again.
  await click('[data-testid=agent-layer-undock]');
  await browser.until('Ouvert again', `!!document.querySelector('[data-testid=agent-tray]')`);
  await oneField('undocked');
  assert.equal(await inside(FIELD, '[data-testid=agent-content-composer]'), true);
  // Fermer from the dock: back to Ambiant at the bottom centre.
  await click('[data-testid=agent-tray-dock]');
  await browser.until('Ancré again', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await click('[data-testid=agent-layer-close]');
  await browser.until('Ambiant', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'closed' && !document.querySelector('[data-testid=agent-tray]')`);
  await oneField('closed');
  assert.equal(await inside(FIELD, '[data-testid=agent-content-composer]'), true, 'closed: the field is back under the page');
  const back = await rect('[data-testid=composer]'), column = await rect('[data-boring=dock-main]');
  assert.ok(Math.abs((back.x + back.w / 2) - (column.x + column.w / 2)) <= 2, 'at the bottom centre of the content column');
  assert.ok(column.bottom - back.bottom >= 0 && column.bottom - back.bottom < 24, 'at the bottom');
  // While the agent works the same button stops it.
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('working', `document.querySelector('[data-testid=composer-submit]')?.dataset.state === 'stop'`);
  assert.equal(await actionName(), 'Arrêter', 'running: the one action button stops');
  await oneField('running');
});

test('1280, folded: the card on the field says what the tool does, asks both questions of a form, then keeps the reply with a dot; nothing opens by itself (AC-4)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('working card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  const status = await text('[data-testid=agent-card-status]');
  assert.ok(status.includes('releve-janvier.pdf') && status.includes('12 lignes sur 40'), `the tool's words (${status})`);
  assert.notEqual(status.trim(), 'En cours');
  assert.equal(await inside('[data-testid=agent-card]', '[data-testid=agent-card-slot]'), true, 'joined above the field');
  const card = await rect('[data-testid=agent-card]'), field = await rect('[data-testid=composer]');
  assert.ok(Math.abs(card.w - field.w) <= 2, `same width as the field (${card.w} vs ${field.w})`);
  assert.ok(field.y - card.bottom <= 12 && field.y >= card.bottom - 1, `on top of the field (${card.bottom} → ${field.y})`);
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-content-composer] [data-testid=preparing], [data-testid=agent-content-composer] p[data-testid=agent-status]')].filter(e => e.getClientRects().length > 0).length`), 0, 'no second status line under the card');
  await browser.evaluate(`window.__run('form')`);
  await browser.until('question 1', `document.querySelector('[data-testid=agent-card] [data-testid=agent-question]')?.getAttribute('aria-label') === 'Quel exercice ?'`);
  assert.ok((await text('[data-testid=agent-question-step]')).includes('1 sur 2'));
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-card] [data-choice]')].find(e => e.textContent === '2026').click()`);
  await browser.until('question 2', `document.querySelector('[data-testid=agent-card] [data-testid=agent-question]')?.getAttribute('aria-label') === 'Quel journal ?'`);
  assert.ok((await text('[data-testid=agent-question-step]')).includes('2 sur 2'));
  assert.ok((await text('[data-testid=agent-question-answered]')).includes('2026'), 'the first answer is shown');
  assert.equal((await browser.evaluate('window.__answered')).length, 0, 'nothing answered before the last question');
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-card] [data-choice]')].find(e => e.textContent === 'Ventes').click()`);
  await browser.until('answered', `window.__answered.length === 1`);
  const [answered] = await browser.evaluate('window.__answered');
  assert.ok(answered.text.includes('2026') && answered.text.includes('Ventes'), `both answers sent together (${answered.text})`);
  assert.ok(!answered.text.includes('Pas de réponse'), 'no question answered silently');
  await browser.evaluate(`window.__run('reply')`);
  await browser.until('reply card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
  const header = await text('[data-testid=agent-card-status]');
  assert.ok(header.startsWith('Terminé') && header.includes('releve-janvier.pdf'), `« ✓ Terminé · what was used » (${header})`);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=agent-card-reply]')).webkitLineClamp`), '3', 'three clamped lines');
  assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-card-file]')].map(e => e.dataset.path)`), ['uploads/ecarts-janvier.csv'], 'the cited file as a chip');
  assert.equal(await count('[data-testid=agent-bar-unread]'), 1, 'a dot on the chevron');
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'the bar did not force-open');
  assert.equal(await dockState(), 'closed');
  assert.equal(await count('[data-testid=agent-card] a, [data-testid=agent-card] [data-testid=history-open]'), 0, 'no « Voir la conversation » link');
  await browser.screenshot('one-composer-1280-light-collapsed-reply.png');
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.until('read', `!document.querySelector('[data-testid=agent-bar-unread]')`);
  assert.equal(await count('[data-testid=agent-card]'), 0, 'the card goes when the thread is open');
  await oneField('reply read');
});

test('1280: a file opened while docked shows its preview in the right column and the chat goes back to Ouvert above the field (AC-5)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('Ancré', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await browser.evaluate(`window.__openFile('uploads/ecarts-janvier.csv')`);
  await browser.until('preview', `!!document.querySelector('[data-testid=agent-preview] [data-testid=fixture-preview]')`);
  await browser.until('dock steps aside', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'closed' && !!document.querySelector('[data-testid=agent-tray]')`);
  await oneField('preview');
  const preview = await rect('[data-testid=agent-preview]'), main = await rect('[data-boring=dock-main]');
  assert.ok(preview.x >= main.right - 1 && preview.h >= 700, `the preview is the right column (${JSON.stringify(preview)})`);
  assert.equal(await inside(FIELD, '[data-testid=agent-content-composer]'), true, 'the field is under the page, Ouvert');
  const tray = await rect('[data-testid=agent-tray]'), field = await rect('[data-testid=composer]');
  assert.ok(tray.bottom <= field.y + 1, 'the conversation above the field');
  await type('Que contient ce fichier ?');
  await click('[data-testid=composer-submit]');
  await browser.until('usable', `window.__sent.includes('Que contient ce fichier ?')`);
  await browser.screenshot('one-composer-1280-light-preview.png');
  await click('[data-testid=agent-preview-close]');
  await browser.until('dock back', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open' && !document.querySelector('[data-testid=agent-preview]')`);
  await oneField('preview closed');
  assert.equal(await inside(FIELD, '[data-testid=agent-layer]'), true, 'the docked assistant comes back');
});

test('Échap closes Ouvert; at 390 the field keeps a usable width and docked takes the full screen (AC-6)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.press('Escape');
  await browser.until('closed by Escape', `!document.querySelector('[data-testid=agent-tray]')`);
  await oneField('after Escape');
  await open(390);
  await oneField('phone');
  await browser.evaluate(`window.__layer.open('agent', 'full')`);
  await browser.until('full', `document.querySelector('[data-testid=agent-layer-sheet]') && document.querySelector('[data-testid=agent-layer-sheet]').getBoundingClientRect().height > 0`);
  await wait(700);
  await oneField('phone docked');
  const sheet = await browser.evaluate(`(() => { const r = document.querySelector('[data-testid=agent-layer-sheet]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width }; })()`);
  assert.ok(sheet.w >= 389 && sheet.bottom - sheet.top >= 844 * 0.9, `docked on a phone takes the full screen (${JSON.stringify(sheet)})`);
  const input = await rect(FIELD);
  assert.ok(input.w >= 140, `the text keeps a usable width at 390 (${input.w}px)`);
});

test('1280, folded during a run: nothing floats over the page and the last row scrolls clear of the card and the field (AC-7)', { skip, timeout: 120000 }, async () => {
  await open(1280, 'rows=40');
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('working card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  await browser.evaluate(`(() => { const page = document.querySelector('[data-testid=page]'); page.scrollTop = page.scrollHeight; })()`);
  await wait(200);
  const rows = await browser.evaluate(`[...document.querySelectorAll('[data-testid=page-row]')].map(e => e.getBoundingClientRect().bottom)`);
  const card = await rect('[data-testid=agent-card]'), page = await rect('[data-testid=agent-page]');
  assert.ok(rows.at(-1) <= card.y + 1, `the last row ends above the card (${rows.at(-1)} <= ${card.y})`);
  assert.ok(page.bottom <= card.y + 1, 'the page stops where the stack starts: its bottom room is the stack\'s height');
  const floating = await browser.evaluate(`[...document.querySelectorAll('[role=status]')].filter(e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.height > 0 && (s.position === 'fixed' || s.position === 'absolute') && r.bottom > ${page.y} && r.top < ${page.bottom}; }).map(e => e.textContent)`);
  assert.deepEqual(floating, [], 'no status text floats over the page');
});

test('shots: Ambiant, Ouvert, Ancré, collapsed working, collapsed reply and preview, light and dark, 1280 and 390 (AC-8)', { skip, timeout: 240000 }, async () => {
  for (const dark of [false, true]) {
    const name = dark ? 'dark' : 'light';
    const query = dark ? 'dark=1' : '';
    await open(1280, query);
    await browser.screenshot(`one-composer-1280-${name}-ambiant.png`);
    await browser.evaluate(`window.__layer.open('agent')`);
    await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
    await browser.screenshot(`one-composer-1280-${name}-ouvert.png`);
    await click('[data-testid=agent-tray-dock]');
    await browser.until('Ancré', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
    await wait(300);
    await browser.screenshot(`one-composer-1280-${name}-ancre.png`);
    await browser.evaluate(`window.__openFile('uploads/ecarts-janvier.csv')`);
    await browser.until('preview', `!!document.querySelector('[data-testid=agent-preview]')`);
    await wait(200);
    await browser.screenshot(`one-composer-1280-${name}-preview.png`);
    await open(1280, query);
    await browser.evaluate(`window.__run('tool')`);
    await browser.until('working card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
    await browser.screenshot(`one-composer-1280-${name}-collapsed-working.png`);
    await browser.evaluate(`window.__run('reply')`);
    await browser.until('reply card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
    await browser.screenshot(`one-composer-1280-${name}-collapsed-reply.png`);
    // A phone has the drawer: peek is Ambiant, half Ouvert, full Ancré; the preview covers the screen.
    await open(390, query);
    await browser.evaluate(`window.__layer.open('agent', 'peek')`);
    await wait(700);
    await browser.screenshot(`one-composer-390-${name}-ambiant.png`);
    await browser.evaluate(`window.__layer.open('agent', 'half')`);
    await wait(700);
    await browser.screenshot(`one-composer-390-${name}-ouvert.png`);
    await browser.evaluate(`window.__layer.open('agent', 'full')`);
    await wait(700);
    await browser.screenshot(`one-composer-390-${name}-ancre.png`);
    await browser.evaluate(`window.__openFile('uploads/ecarts-janvier.csv')`);
    await browser.until('phone preview', `!!document.querySelector('[data-testid=agent-preview]')`);
    await wait(200);
    await browser.screenshot(`one-composer-390-${name}-preview.png`);
  }
});

test('composer="content" (Coach Max) is unchanged: no chevron, no card, the field stays under the page when docked (AC-9)', { skip, timeout: 120000 }, async () => {
  await open(1280, 'composer=content');
  await oneField('content');
  assert.equal(await count('[data-testid=agent-bar-conversation]'), 0, 'no chevron');
  assert.equal(await count('[data-testid=agent-card-slot]'), 0, 'no card slot');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer]').dataset.layout`), 'card', 'the two-row composer');
  await browser.evaluate(`window.__run('tool')`);
  await wait(300);
  assert.equal(await count('[data-testid=agent-card]'), 0);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('tray', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('dock', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  assert.equal(await inside(FIELD, '[data-testid=agent-content-composer]'), true, 'content mode keeps the field under the page');
  assert.equal(await browser.evaluate(`window.__layer.preview({ title: 'x', content: null })`), false, 'no preview outside composer="bar"');
});
