import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/one-composer.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.excalidraw': 'text', '.drawio': 'text', '.html': 'text' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell', 'pi-chat', 'pi-chat-mentions', 'pi-chat-attachments', 'pi-chat-slash', 'agent-bar'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  // A clickable demo for review (D-2198): the same bundle in one self-contained page, with a small panel that drives the scripted agent.
  // CI uploads it with the shots (composer-content-shots/one-composer-demo.html). No network, no keys: the agent is the fixture's fake.
  const panel = `<div id="demo-panel" style="position:fixed;left:8px;bottom:8px;z-index:100;display:flex;flex-wrap:wrap;gap:6px;max-width:220px;padding:8px;border-radius:10px;background:var(--card);color:var(--foreground);box-shadow:0 4px 16px rgb(0 0 0 / 15%);font:12px system-ui,sans-serif">`
    + `<b style="width:100%;cursor:pointer" title="Fold / unfold" onclick="for (const b of this.parentElement.querySelectorAll('button')) b.hidden = !b.hidden">Demo · fictional agent ▾</b>`
    + [['tool', 'Agent reads a file'], ['form', 'Agent asks 2 questions'], ['reply', 'Agent replies']].map(([kind, label]) => `<button type="button" onclick="window.__run('${kind}')">${label}</button>`).join('')
    + `<button type="button" onclick="window.__openFile('uploads/ecarts-janvier.csv')">Open a file</button>`
    + `<button type="button" onclick="document.documentElement.classList.toggle('dark')">Light / dark</button></div>`;
  writeFileSync(join(shots, 'one-composer-demo.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One composer · demo</title><style>${css}</style></head><body><div id="root"></div>${panel}<script>window.__DEMO_LANG = 'en';</script><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
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
// AC-2: the row is the chevron, attach, the field and one action button; nothing else can be pressed in it.
const rowControls = () => browser.evaluate(`[...document.querySelectorAll('[data-testid=composer] [data-slot=input-group] button, [data-testid=composer] [data-slot=input-group] textarea')].filter(e => e.getClientRects().length > 0 && !e.closest('[data-testid=composer-controller]') && e.dataset.testid !== 'agent-bar-conversation').map(e => e.dataset.testid || e.getAttribute('aria-label'))`);

test('1280: Ambiant, send, Ouvert, Ancré, Détacher, Fermer: one field at every step, and the right button says Dicter, Envoyer, Arrêter (AC-1, AC-2, AC-3)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await oneField('ambient');
  assert.equal(await inside(FIELD, '[data-testid=agent-content-composer]'), true, 'ambient: the field is under the page');
  assert.equal(await dockState(), 'closed');
  assert.equal(await count('[data-testid=agent-tray]'), 0);
  assert.equal(await inside('[data-testid=agent-bar-conversation]', '[data-testid=agent-composer-box]'), true, 'the chevron is the controller on the bar\'s frame, not a button of the row');
  assert.equal(await count('[data-testid=composer-bar-attach]'), 1, 'attach is a bar button');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=composer-bar-commands], [data-testid=composer-plus]')].filter(e => e.getClientRects().length > 0).length`), 0, 'no visible Actions button and no + menu (the Commands button is for touch screens)');
  assert.equal(await actionName(), 'Dicter', 'empty field: the one action button dictates');
  assert.deepEqual(await rowControls(), ['composer-bar-attach', 'composer-input', 'agent-talk'], 'one row: attach, field, one action (AC-2); the chevron is the controller');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=composer-input]')).whiteSpace`), 'nowrap', 'an empty field is one line: the placeholder never wraps (AC-2)');
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
  // A send leaves the bar folded: the work, then the reply, show on the field; the conversation opens only from the chevron (Julien).
  await browser.until('working on the field', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'a send does not open the conversation');
  assert.equal(await dockState(), 'closed', 'nor the dock');
  await browser.until('reply on the field', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply' && document.querySelector('[data-testid=agent-card-reply]').textContent.includes('Réponse fictive : noté.')`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'the reply does not open it either');
  assert.deepEqual(await browser.evaluate('window.__sent'), ['Combien de pièces manquent ?']);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.until('reply in the thread', `document.querySelector('[data-testid=agent-tray]').textContent.includes('Réponse fictive : noté.')`);
  await oneField('open');
  const tray = await rect('[data-testid=agent-tray]'), after = await rect('[data-testid=composer]');
  assert.ok(tray.bottom <= after.y + 1, `Ouvert: the thread sits above the field (${tray.bottom} <= ${after.y})`);
  assert.ok(Math.abs(after.bottom - field.bottom) <= 1, 'the field kept its place');
  assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-tray]'), true);
  assert.equal(await count('[data-testid=agent-tray] [data-testid=agent-layer-library]'), 1, 'the open conversation\'s header has « Bibliothèque »');
  await click('[data-testid=agent-tray] [data-testid=agent-layer-library]');
  await browser.until('library from the bottom composer', `!!document.querySelector('[data-testid=agent-preview] [data-testid=fixture-library]')`);
  const pane = await rect('[data-testid=agent-preview]'), mainColumn = await rect('[data-boring=dock-main]');
  assert.ok(pane.x >= mainColumn.right - 1, 'from the bottom composer the library opens in the right pane');
  await click('[data-testid=agent-preview-close]');
  await browser.until('library closed', `!document.querySelector('[data-testid=agent-preview]')`);
  assert.equal(await inside('[data-testid=agent-tray]', '[data-testid=agent-composer-box]') && await inside(FIELD, '[data-testid=agent-composer-box]'), true, 'Ouvert: the thread and the field in one box (AC-16)');
  const box = await rect('[data-testid=agent-composer-box]'), contentColumn = await rect('[data-boring=dock-main]');
  assert.ok(box.w <= 721 && box.w < contentColumn.w - 100, `the box keeps the field's width, never the page's (${box.w} in ${contentColumn.w})`);
  assert.ok(Math.abs((box.x + box.w / 2) - (contentColumn.x + contentColumn.w / 2)) <= 2, 'centred');
  const row = await rect('[data-testid=agent-composer-box] [data-slot=input-group]'), chevron = await rect('[data-testid=composer-controller] [data-action=chevron]');
  assert.ok(row.h >= 46 && row.h <= 52 && Math.abs((chevron.x + chevron.w / 2) - (row.x + row.w / 2)) <= 1, `the row is compact and the tab is in its middle (${row.h}px high, ${Math.round(chevron.x + chevron.w / 2 - row.x - row.w / 2)}px off the middle)`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-tray] [data-testid=agent-layer-library]').textContent.trim()`), '', '« Bibliothèque » is an icon (its name is the label)');
  assert.equal(await browser.evaluate(`(() => { const b = document.querySelector('[data-testid=composer-controller] [data-action=chevron]'); const r = parseFloat(getComputedStyle(b).borderTopLeftRadius); return r >= b.getBoundingClientRect().height / 2 - 1; })()`), true, 'round buttons in the row, as the agent bar (Julien)');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=agent-composer-box]')).backgroundColor === getComputedStyle(document.querySelector('[data-slot=sidebar-inset]')).backgroundColor && getComputedStyle(document.querySelector('[data-testid=agent-composer-box] [data-boring=pi-chat-composer]')).backgroundColor === getComputedStyle(document.querySelector('[data-slot=sidebar-inset]')).backgroundColor && getComputedStyle(document.querySelector('[data-testid=agent-composer-box]').parentElement).backgroundColor === getComputedStyle(document.querySelector('[data-slot=sidebar-inset]')).backgroundColor`), true, 'the box, the field and the strip around them take the main view\'s colour (Julien, demo review)');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=composer-bar-attach]')).borderTopWidth === '0px' || getComputedStyle(document.querySelector('[data-testid=composer-bar-attach]')).borderTopColor.includes('0, 0, 0, 0')`), true, 'the attach button has no border in the one composer');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=agent-composer-box] [data-slot=input-group]')).borderTopColor.includes('0, 0, 0, 0') || getComputedStyle(document.querySelector('[data-testid=agent-composer-box] [data-slot=input-group]')).borderTopColor === 'transparent'`), true, 'one frame: the input group draws no border of its own inside the box');
  // Ancré: the thread and the field in the right column, nothing at the bottom.
  // The field's look, measured here and again docked: the same composer wherever it sits (Julien's invariant).
  const look = framed => browser.evaluate(`(() => { const row = document.querySelector('[data-testid=composer] [data-slot=input-group]'); const frame = ${framed ? "document.querySelector('[data-testid=agent-composer-box]')" : 'row'};
    const s = getComputedStyle(row), f = getComputedStyle(frame), chevron = getComputedStyle(document.querySelector('[data-testid=composer-bar-attach]'));
    return { height: Math.round(row.getBoundingClientRect().height), padding: s.padding, gap: s.columnGap, radius: f.borderTopLeftRadius, background: f.backgroundColor, button: chevron.borderTopLeftRadius, buttonBackground: chevron.backgroundColor }; })()`);
  const bottomLook = await look(true);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('Ancré', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await wait(300);
  await oneField('docked');
  assert.deepEqual(await look(false), bottomLook, 'docked, the field looks as it does at the bottom');
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
  assert.equal(await inside('[data-testid=agent-card]', '[data-testid=agent-composer-box]'), true, 'the card is inside the same box as the field');
  assert.ok(field.y - card.bottom <= 12 && field.y >= card.bottom - 1, `right on top of the field (${card.bottom} → ${field.y})`);
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-content-composer] [data-testid=conversation-files]')].filter(e => e.getClientRects().length > 0).length`), 0, 'nothing between the card and the field');
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
  const replyText = await text('[data-testid=agent-card-reply]');
  assert.ok(replyText.includes('ecarts-janvier.csv') && !replyText.includes('@uploads/'), `the reply names the file, never the raw @path (${replyText})`);
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

// AC-1 (notifications): a reply that ends while the conversation is folded puts a dot on the notch (the grabber's pill on a phone), a count pill beside the chevron from the second, and opening clears it.
test('folded, 1280 and 390: one reply is a dot, two are a count pill beside the chevron (which does not move), and opening the conversation clears it (AC-1)', { skip, timeout: 120000 }, async () => {
  for (const [width, query] of [[1280, ''], [390, 'tabs=1']]) {
    await open(width, query);
    const before = await rect('[data-testid=agent-bar-conversation]');
    await browser.evaluate(`window.__run('tool')`);
    await browser.evaluate(`window.__run('reply')`);
    await browser.until('a dot', `!!document.querySelector('[data-testid=agent-bar-unread]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-unread]').dataset.count`), '1', `one reply is a dot at ${width}`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-unread]').textContent`), '', 'no number on a dot');
    await browser.evaluate(`window.__run('think')`);
    await browser.evaluate(`window.__run('reply2')`);
    await browser.until('a count', `document.querySelector('[data-testid=agent-bar-unread]')?.dataset.count === '2'`);
    assert.equal(await text('[data-testid=agent-bar-unread]'), '2', `two replies are a count at ${width}`);
    assert.equal(await count('[data-testid=agent-bar-unread]'), 1, 'one mark, not a dot and a count');
    if (width > 768) {
      const pill = await rect('[data-testid=agent-bar-unread]');
      assert.equal(Math.round(pill.w) + 'x' + Math.round(pill.h), '32x16', 'the pill is the chevron\'s size');
      const chevron = await rect('[data-testid=agent-bar-conversation]');
      assert.deepEqual([chevron.x, chevron.w, chevron.h], [before.x, before.w, before.h], 'the chevron did not move or change size');
    }
    assert.ok(['closed', 'peek'].includes(await dockState()), 'nothing opened by itself');
    await browser.screenshot(`notifications-count-${width}-light.png`);
    await click('[data-testid=agent-bar-conversation]');
    await browser.until('cleared', `!document.querySelector('[data-testid=agent-bar-unread]')`);
  }
});

// Notices at the composer (AC-5, AC-7): in the real shell a notice appears above the bar without opening the conversation or moving focus, and on a phone its buttons are 44 px.
const NOTICES = `[{ id: 'e1', kind: 'error', text: 'Fictional: the export failed.', action: { label: 'Retry', onSelect() { window.__retried = true; } }, reference: '@task:t1' },
  { id: 'w1', kind: 'warning', text: 'Fictional: the daily limit is near.' }, { id: 's1', kind: 'success', text: 'Fictional: statement saved.' }, { id: 'i1', kind: 'info', text: 'Fictional: a new version.' }]`;
test('1440, 390 and 360: a notice appears above the bar, one at a time, without opening the conversation or moving focus; its actions are 44 px on a phone (AC-5, AC-7)', { skip, timeout: 120000 }, async () => {
  for (const width of [1440, 390, 360]) {
    await open(width);
    await browser.evaluate(`document.querySelector('[data-testid=composer-input]')?.blur(); document.body.focus()`);
    const active = await browser.evaluate(`document.activeElement?.tagName`);
    const expanded = await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]')?.getAttribute('aria-expanded')`);
    await browser.evaluate(`window.__notices(${NOTICES})`);
    await browser.until('a notice', `!!document.querySelector('[data-testid=notice]')`);
    assert.equal(await count('[data-notice-kind]'), 1, `one notice at ${width}`);
    assert.equal(await text('[data-testid=notice-more]'), '3 en attente');
    assert.equal(await browser.evaluate(`document.activeElement?.tagName`), active, 'focus did not move');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]')?.getAttribute('aria-expanded')`), expanded, 'the conversation did not open');
    assert.ok(['closed', 'peek'].includes(await dockState()), 'no tray');
    assert.equal(await count('[data-testid=agent-tray]'), 0);
    const notice = await rect('[data-testid=notice]'), bar = await rect('[data-testid=composer]');
    assert.ok(notice.bottom <= bar.y + 1 || width < 768, `above the bar at ${width} (${notice.bottom} vs ${bar.y})`);
    assert.ok(notice.bottom <= (await browser.evaluate('innerHeight')), 'on screen');
    if (width < 768) {
      const tabs = await rect('[data-testid=tabbar]');
      if (tabs) assert.ok(notice.bottom <= tabs.y + 1, 'not under the tab bar');
      for (const id of ['notice-action', 'notice-dismiss', 'notice-reference']) assert.ok((await rect(`[data-testid=${id}]`)).h >= 44, `${id} is at least 44 px high at ${width}`);
      assert.ok((await rect('[data-testid=notice-dismiss]')).w >= 44, 'the dismiss is 44 px wide');
    }
    await browser.screenshot(`notifications-notice-error-${width}-light.png`);
    await click('[data-testid=notice-action]');
    assert.equal(await browser.evaluate('window.__retried'), true, 'the action ran in place');
  }
});

test('folded, 1280: a warning notice holds a chip in the field when its @ is used, and a dismiss shows the next notice', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__notices(${NOTICES})`);
  await browser.until('a notice', `!!document.querySelector('[data-testid=notice-reference]')`);
  await click('[data-testid=notice-reference]');
  await browser.until('the mention is in the draft', `window.__draft().includes('@task:t1')`);
  await click('[data-testid=notice-dismiss]');
  assert.equal(await text('[data-testid=notice-text]'), 'Fictional: the daily limit is near.');
});

// AC-6 (notifications): the bar itself says the agent waits: a warning border and a soft ring around the whole bar while a decision (an approval or a question) is on the folded card; no tray opens.
test('folded, 1280 and 390: a decision on the card gives the bar a warning border and soft ring, and the ring goes with the decision (AC-6)', { skip, timeout: 120000 }, async () => {
  for (const [width, query, bar] of [[1280, '', '[data-testid=agent-composer-box]'], [390, 'tabs=1', '[data-testid=agent-layer]']]) {
    await open(width, query);
    const shadow = () => browser.evaluate(`(s => s.boxShadow + ' ' + s.outlineWidth + ' ' + s.outlineColor)(getComputedStyle(document.querySelector(${js(bar)})))`);
    await browser.evaluate(`window.__run('tool')`);
    await browser.evaluate(`window.__run('reply')`);
    await browser.until('reply card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
    const calm = await shadow();
    for (const [kind, selector] of [['approval', '[data-testid=agent-approval]'], ['form', '[data-testid=agent-question]']]) {
      await browser.evaluate(`window.__run('${kind}')`);
      await browser.until(`${kind} card`, `!!document.querySelector('[data-testid=agent-card] ${selector}')`);
      const ringed = await shadow();
      assert.ok(ringed.includes(' 3px ') && ringed !== calm, `the ${kind} ring at ${width} (${ringed})`);
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=agent-card][data-needs-you]')`), true);
      assert.equal(await count('[data-testid=agent-tray]'), 0, 'no tray');
      assert.ok(['closed', 'peek'].includes(await dockState()), 'the conversation stays folded');
      await browser.screenshot(`notifications-needs-you-${kind}-${width}-light.png`);
    }
    await browser.evaluate(`window.__run('think')`);
    await browser.evaluate(`window.__run('reply')`);
    await browser.until('calm again', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
    assert.equal(await shadow(), calm, 'the ring goes with the decision');
  }
});

// Pattern 3 (notifications): a short status in the field in place of the placeholder; it goes after 3 s or when the person types.
test('1280 and 390: a status replaces the placeholder in the field, and goes when the person types, or after 3 s', { skip, timeout: 120000 }, async () => {
  for (const [width, query] of [[1280, ''], [390, 'tabs=1']]) {
    await open(width, query);
    const placeholder = () => browser.evaluate(`document.querySelector('[data-testid=composer-input]').placeholder`);
    const normal = await placeholder();
    await browser.evaluate(`window.__layer.status('Brouillon enregistré')`);
    await browser.until('status', `document.querySelector('[data-testid=composer-input]').placeholder === 'Brouillon enregistré'`);
    assert.equal(await placeholder(), 'Brouillon enregistré', `the status is the placeholder at ${width}`);
    await browser.screenshot(`notifications-field-status-${width}-light.png`);
    await type('a');
    await browser.until('typing replaced it', `document.querySelector('[data-testid=composer-input]').placeholder !== 'Brouillon enregistré'`);
    await browser.evaluate(`window.__setText('')`);
    await browser.evaluate(`window.__layer.status('Copié')`);
    await browser.until('it expires', `document.querySelector('[data-testid=composer-input]').placeholder === ${js(normal)}`);
  }
});

test('folded, 1280 and 390: a failed turn is one sentence on the card, in the app\'s words when it gives replyError, and the next turn clears it', { skip, timeout: 120000 }, async () => {
  for (const [width, query] of [[1280, ''], [390, 'tabs=1'], [1280, 'replyError=1']]) {
    await open(width, query);
    await browser.evaluate(`window.__run('failed')`);
    await browser.until('failed card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'failed'`);
    const sentence = await text('[data-testid=agent-card-failed]');
    assert.equal(sentence, query === 'replyError=1' ? 'Le relevé n’a pas pu être lu (fictif).' : 'La réponse a échoué', `one plain sentence at ${width} (${query || 'default'})`);
    assert.equal(await count('[data-testid=agent-card] [data-testid=agent-card-status]'), 0, 'no « Terminé » for a failed turn');
    assert.equal(await count('[data-testid=agent-bar-unread]'), 0, 'a failure is not an unread reply');
    assert.equal(await count('[data-testid=agent-tray]') + (await browser.evaluate(`document.querySelector('[data-testid=agent-layer]')?.dataset.state`) === 'half' ? 1 : 0), 0, 'the conversation stays folded');
    assert.equal(await browser.evaluate(`(r => r.bottom <= innerHeight && r.height > 0)(document.querySelector('[data-testid=agent-card-failed]').getBoundingClientRect())`), true, 'on screen');
    await browser.screenshot(`one-composer-${width}-light-collapsed-failed${query === 'replyError=1' ? '-own-words' : ''}.png`);
    await browser.evaluate(`window.__run('think')`);
    await browser.until('the next turn', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working' || !document.querySelector('[data-testid=agent-card-failed]')`);
    assert.equal(await count('[data-testid=agent-card-failed]'), 0, 'the sentence goes when the next turn starts');
  }
});

// An approval is a decision like a question: it folds into the bar's card (Approve and Deny, the arguments one tap away) and never opens the conversation by itself.
test('folded, 1280 and 390: an approval waits on the card with Approve and Deny, the arguments behind a disclosure, the conversation stays folded and the field keeps its focus', { skip, timeout: 120000 }, async () => {
  for (const [width, query] of [[1280, ''], [390, 'tabs=1']]) {
    await open(width, query);
    await browser.evaluate(`window.__run('tool')`);
    await browser.until('working card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
    await browser.evaluate(`document.activeElement?.blur?.()`);
    await browser.evaluate(`window.__run('approval')`);
    await browser.until('approval card', `!!document.querySelector('[data-testid=agent-card] [data-testid=agent-approval]')`);
    assert.equal(await count('[data-testid=agent-tray]') + (await browser.evaluate(`document.querySelector('[data-testid=agent-layer]')?.dataset.state`) === 'half' ? 1 : 0), 0, `${width}: the conversation stays folded`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]')?.getAttribute('aria-expanded')`), 'false', 'the chevron says folded');
    assert.equal(await browser.evaluate(`document.activeElement?.dataset?.testid === 'composer-input'`), false, 'the card does not take the focus');
    assert.equal(await count('[data-testid=agent-card] [data-testid=agent-question]'), 0, 'not a question');
    assert.ok((await text('[data-testid=agent-card-status]')).includes('En attente de votre réponse'), 'a status line: waiting for the answer');
    assert.ok((await text('[data-testid=agent-approval-summary]')).includes('relevé de décembre'), 'the host summary is the title');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-approval-details]').open`), false, 'the arguments are folded');
    const buttons = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-approval-approve], [data-testid=agent-approval-deny]')].map(e => [e.textContent.trim(), e.getBoundingClientRect().height])`);
    assert.equal(buttons.length, 2, 'Approve and Deny');
    if (width === 390) for (const [name, height] of buttons) assert.ok(height >= 43.5, `${name} is a 44px target (${height})`);
    assert.equal(await browser.evaluate(`(r => r.bottom <= innerHeight && r.top >= 0)(document.querySelector('[data-testid=agent-approval]').getBoundingClientRect())`), true, 'on screen');
    await browser.screenshot(`one-composer-${width}-light-collapsed-approval.png`);
    await click('[data-testid=agent-approval-details] summary');
    assert.ok((await text('[data-testid=agent-approval-args]')).includes('releve-decembre'), 'the arguments open in place');
    assert.equal(await count('[data-testid=agent-tray]'), 0, 'still folded after the disclosure');
    await click('[data-testid=agent-approval-approve]');
    await browser.until('decided', `window.__answered.length === 1`);
    assert.equal((await browser.evaluate('window.__answered'))[0].text, 'Approve');
    await browser.until('done', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
    assert.equal(await count('[data-testid=agent-approval]'), 0, 'the decision card is gone');
    assert.ok((await text('[data-testid=agent-card-status]')).startsWith('Terminé'), 'the card folds to the Done reply');
  }
});

// Julien: "not centered vertically". The bar's rule aligned its row to the end, so any slack between the row and the bar's minimum height put the controls low.
const offsets = () => browser.evaluate(`(() => { const g = document.querySelector('[data-testid=composer] [data-slot=input-group]').getBoundingClientRect(); const mid = g.top + g.height / 2;
  return [...document.querySelectorAll('[data-testid=composer] [data-slot=input-group] button:not([data-testid=agent-bar-conversation]), [data-testid=composer] [data-slot=input-group] textarea')].filter(e => e.getClientRects().length > 0).map(e => { const r = e.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - mid); }); })()`);
for (const [width, query] of [[1280, ''], [390, 'tabs=1']]) test(`${width}: the attach, field and action sit on the bar's midline, empty and with several lines; the expand tab straddles the top border at the middle`, { skip, timeout: 120000 }, async () => {
  await open(width, query);
  await browser.until('the field', `!!document.querySelector('[data-testid=composer-input]')`);
  for (const offset of await offsets()) assert.ok(offset < 0.6, `empty: ${offset}px off the midline`);
  // A phone has no strip: the sheet's grabber is the pill on the border (see the phone test); the tab straddling the border is the wide screen's.
  if (width < 500) assert.equal(await count('[data-slot=drawer-swipe-handle]'), 1, 'the grabber pill stands where the tab would');
  else {
    const tab = await browser.evaluate(`(() => { const g = document.querySelector('[data-testid=composer] [data-slot=input-group]').getBoundingClientRect(), t = document.querySelector('[data-testid=agent-bar-conversation]'), r = t.getBoundingClientRect(), pill = t.firstElementChild.getBoundingClientRect();
      return { across: Math.abs((r.top + r.height / 2) - g.top), middle: Math.abs((r.left + r.width / 2) - (g.left + g.width / 2)), pillAbove: pill.top < g.top - 1 && pill.bottom > g.top + 1, hit: Math.min(r.width, r.height), name: t.getAttribute('aria-label'), expanded: t.getAttribute('aria-expanded') }; })()`);
    assert.ok(tab.across <= 1.5, `the tab's middle is on the bar's top border (${tab.across}px off)`);
    assert.ok(tab.middle <= 1, `the tab is in the middle of the bar (${tab.middle}px off)`);
    assert.equal(tab.pillAbove, true, 'half of the pill is above the border, half below');
    assert.ok(tab.name && tab.expanded === 'false', 'the tab keeps its name and aria-expanded');
    if (width < 500) assert.ok(tab.hit >= 44, `a 44 px hit area on touch (${tab.hit})`);
  }
  await type('create a new file tt..md');
  await wait(150);
  for (const offset of await offsets()) assert.ok(offset < 1, `typed, with Send: ${offset}px off the midline`);
  await browser.evaluate(`(() => { const e = document.querySelector('[data-testid=composer-input]'); e.select(); document.execCommand('delete'); })()`);
  await type('one');
  for (const line of ['two', 'three']) { await browser.press('Enter', { shift: true }); await browser.send('Input.insertText', { text: line }); }
  await wait(150);
  for (const offset of await offsets()) assert.ok(offset < 0.6, `three lines: ${offset}px off the midline`);
});

// Julien: "style need propagated to the entry right pane". Content an app pushes on the pane gets the kit's type scale and border colour once, in the pane.
test('1280: content pushed on the pane takes the kit text size and the border token, not currentColor', { skip, timeout: 120000 }, async () => {
  await open(1280, 'demo=1&single=1');
  await click('[data-testid=page-row]');
  await browser.until('the entry is open', `!!document.querySelector('[data-testid=fixture-record]')`);
  const style = await browser.evaluate(`(() => { const box = document.createElement('div'); box.className = 'border'; box.textContent = 'x'; document.querySelector('[data-testid=fixture-record]').appendChild(box);
    const s = getComputedStyle(box), pane = getComputedStyle(document.querySelector('[data-testid=fixture-record]').parentElement); return { border: s.borderTopColor, text: s.color, size: pane.fontSize, token: getComputedStyle(document.documentElement).getPropertyValue('--border') }; })()`);
  assert.notEqual(style.border, style.text, 'a bare border is the theme border, not the text colour');
  assert.equal(style.size, '14px', 'the pane body is the kit text-sm');
});

// Julien: "rm close", "library is still off". Closing is an X with the name in aria-label (no visible word) and the pane sits on the card surface the bar's dock uses.
test('1280: the close buttons are an X without a word, and a pushed pane is on the card surface', { skip, timeout: 120000 }, async () => {
  await open(1280, 'demo=1&single=1');
  await click('[data-testid=page-row]');
  await browser.until('the entry is open', `!!document.querySelector('[data-testid=fixture-record]')`);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('the conversation is open', `!!document.querySelector('[data-testid=agent-tray-reduce], [data-testid=agent-layer-close]')`);
  const words = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-tray-reduce], [data-testid=agent-layer-close], [data-testid=agent-preview-close]')].map(e => [e.textContent.trim(), e.getAttribute('aria-label')])`);
  assert.ok(words.length > 0, 'a close button is shown');
  for (const [visible, name] of words) { assert.equal(visible, '', 'no visible word on a close button'); assert.ok(name, 'the name stays in aria-label'); }
  const same = await browser.evaluate(`(() => { const probe = document.createElement('div'); probe.style.backgroundColor = 'var(--card)'; document.body.appendChild(probe); const card = getComputedStyle(probe).backgroundColor; probe.remove();
    return [getComputedStyle(document.querySelector('[data-testid=agent-preview-frame]')).backgroundColor, card]; })()`);
  assert.equal(same[0], same[1], 'the pane is on the card surface');
});

// Julien: with the right pane open the bar stays centred on the whole viewport. It belongs to the main view, the area left of the pane.
test('1440: the bar is centred on the main view and inside it, with the pane closed, open and after a resize', { skip, timeout: 120000 }, async () => {
  const centred = async step => {
    const [box, main] = [await rect('[data-testid=agent-composer-box]'), await rect('[data-testid=agent-content]')];
    assert.ok(Math.abs((box.x + box.w / 2) - (main.x + main.w / 2)) <= 1, `${step}: the bar's midline ${box.x + box.w / 2} is the main view's ${main.x + main.w / 2}`);
    assert.ok(box.x >= main.x - 1 && box.right <= main.right + 1, `${step}: the bar is inside the main view (${box.x}-${box.right} in ${main.x}-${main.right})`);
  };
  await open(1440, 'demo=1&single=1');
  await centred('pane closed');
  await click('[data-testid=page-row]');
  await browser.until('the entry is open', `!!document.querySelector('[data-testid=fixture-record]')`);
  await wait(300);
  const pane = await rect('[data-testid=agent-preview]');
  assert.ok(pane && pane.x > 400, 'the pane is a column beside the main view');
  await centred('pane open');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait(400);
  await centred('pane open, narrower window');
  await click('[data-testid=agent-preview-close]');
  await wait(300);
  await centred('pane closed again');
});

// Julien: "looks bad, why such bad header?". The docked conversation's header was on the page surface over a card body: one surface, one header height with the panes.
test('1440: the docked conversation has one surface, a pane-height header and its Close last in the icon row', { skip, timeout: 120000 }, async () => {
  await open(1440, 'demo=1&single=1');
  await click('[data-testid=page-row]');
  await browser.until('the entry is open', `!!document.querySelector('[data-testid=agent-preview-bar]')`);
  const paneBarHeight = (await rect('[data-testid=agent-preview-bar]')).h;
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('the tray is open', `!!document.querySelector('[data-testid=agent-tray-dock]')`);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('the conversation is docked', `!!document.querySelector('[data-testid=agent-layer-header]') && !!document.querySelector('[data-testid=agent-layer] [data-boring=pi-chat]')`);
  await wait(400);
  const seen = await browser.evaluate(`(() => {
    const surface = element => { for (let e = element; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return 'none'; };
    const header = document.querySelector('[data-testid=agent-layer-header]'), body = document.querySelector('[data-testid=agent-layer] [data-boring=pi-chat]');
    const row = [...header.querySelectorAll('button')].filter(e => e.getClientRects().length);
    return { header: surface(header), body: surface(body), headerHeight: header.getBoundingClientRect().height, bar: ${paneBarHeight},
      names: row.map(e => e.getAttribute('data-testid')), divider: !!header.querySelector('[data-slot=separator]'), size: row.map(e => Math.round(e.getBoundingClientRect().height)) };
  })()`);
  assert.equal(seen.header, seen.body, 'the header and the body are on one surface');
  assert.equal(seen.headerHeight, seen.bar, 'the header is as tall as the pane headers');
  assert.deepEqual(seen.names, ['history-open', 'agent-layer-library', 'agent-layer-full', 'agent-layer-undock', 'agent-layer-close'], 'the docked header is the title, History, Library, Full screen, then undock and collapse last (no strip on a docked column)');
  assert.equal(seen.divider, false, 'no divider before Close');
  assert.equal(new Set(seen.size).size, 1, `the icon buttons share one size (${seen.size})`);
});

// Julien: a sample of every viewer in the Library. The pane draws each artifact kind of `agent.fileKinds` instead of its raw JSON, XML or HTML text.
test('1440: the Library holds a sample of each viewer and the pane draws it (diagram, Excalidraw, draw.io, mock-up, maquette, records, SVG)', { skip, timeout: 180000 }, async () => {
  await open(1440, 'demo=1&single=1');
  for (const [path, drawn] of [['samples/booking.diagram.json', '[data-testid*=diagram]'], ['samples/oakfield-garden.excalidraw.json', '[data-testid*=drawing]'], ['samples/bakery-morning.drawio.xml', '[data-testid*=drawing]'],
    ['samples/booking.mockup.html', 'iframe'], ['samples/booking.maquette.json', '[data-testid*=maquette]'], ['samples/entries.records.json', '[data-testid*=records]'], ['samples/harbor-logo.svg', 'img']]) {
    await browser.evaluate(`window.__layer.pane.push({ file: ${js(path)} })`);
    await browser.until(`${path} is drawn`, `!!document.querySelector('[data-pane-top] ${drawn}') && document.querySelector('[data-pane-top] [data-testid=agent-preview-title]')?.textContent === ${js(path.split('/').at(-1))}`);
    const literal = await browser.evaluate(`/^\\s*[{<]/.test(document.querySelector('[data-pane-top] [data-testid=agent-preview-body]')?.innerText ?? '')`);
    assert.equal(literal, false, `${path} is drawn by its viewer, not shown as its raw text`);
  }
});

// Julien: "the pill must STRADDLE the top border, whatever the bar contains", and "one controller": the strip is anchored on its chevron, quiet at rest, and its actions
// follow the state (bar, half open, open, docked). Every measure is against the OUTER frame of the bar (or the open tray's top), not the row inside it.
const strip = () => browser.evaluate(`(() => { const s = document.querySelector('[data-testid=composer-controller]'); if (!s) return null; const c = s.querySelector('[data-action=chevron]').getBoundingClientRect();
  const extra = [...s.querySelectorAll('button')].filter(b => b.dataset.action !== 'chevron'), m = extra.length ? getComputedStyle(extra[0]).opacity : null;
  return { actions: [...s.querySelectorAll('button')].map(b => b.dataset.action), ids: [...s.querySelectorAll('button')].map(b => b.dataset.testid), chevron: { x: c.x, y: c.y, w: c.width, h: c.height }, midY: c.y + c.height / 2, midX: c.x + c.width / 2, moreOpacity: m,
    moreLeft: extra.length ? Math.min(...extra.map(b => b.getBoundingClientRect().left)) : null }; })()`);
const frameTop = () => browser.evaluate(`(() => { const t = document.querySelector('[data-testid=agent-tray]'), o = t && t.closest('[data-testid=agent-composer-box]') ? t.parentElement.getBoundingClientRect().top : null; const b = document.querySelector('[data-testid=agent-composer-box]').getBoundingClientRect(); return { box: b.top, trayTop: t ? t.getBoundingClientRect().top : null, boxLeft: b.left, boxMid: b.left + b.width / 2, boxBottom: b.bottom, boxHeight: b.height }; })()`);
test('1440: the controller straddles the top of the bar in every state, rests as the chevron alone, opens to its right and follows the state', { skip, timeout: 240000 }, async () => {
  await open(1440, 'demo=1&single=1&pace=instant');
  await browser.until('the bar', `!!document.querySelector('[data-testid=composer-controller]')`);
  const onTop = async step => { const [a, f] = [await strip(), await frameTop()]; assert.ok(Math.abs(a.midY - (f.trayTop !== null && step.includes('tray') ? f.trayTop : f.box)) <= 1.5, `${step}: the strip's middle ${a.midY} is on the frame's top ${f.trayTop ?? f.box}`); return a; };
  let a = await onTop('empty bar');
  assert.deepEqual(a.actions, ['chevron', 'full'], 'the collapsed bar: the chevron, and full screen opening to its right');
  assert.equal(a.moreOpacity, '0', 'at rest only the chevron shows');
  const f0 = await frameTop(), group = await rect('[data-testid=composer] [data-slot=input-group]');
  assert.ok(Math.abs(group.y + group.h / 2 - (f0.box + f0.boxHeight / 2)) <= 1, 'the row midline is the outer frame midline');
  assert.ok(Math.abs(a.midX - f0.boxMid) <= 1, 'the strip is in the middle of the bar');
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await type('one'); for (const line of ['two', 'three']) { await browser.press('Enter', { shift: true }); await browser.send('Input.insertText', { text: line }); }
  await wait(500); await onTop('three lines');
  const grown = await frameTop(); const g2 = await rect('[data-testid=composer] [data-slot=input-group]');
  assert.ok(Math.abs(g2.y + g2.h / 2 - (grown.box + grown.boxHeight / 2)) <= 1, 'three lines: the row midline is the outer frame midline');
  await browser.evaluate(`(() => { const e = document.querySelector('[data-testid=composer-input]'); e.select(); document.execCommand('delete'); })()`);
  await type('Reconcile the January statement'); await click('[data-testid=composer-submit]');
  await browser.until('the folded card', `!!document.querySelector('[data-testid=agent-card]')`, 30000);
  await wait(400); await onTop('folded card above the field');
  await browser.until('the reply is in', `document.querySelector('[data-testid=agent-card-status]')?.textContent.includes('Done') || !!document.querySelector('[data-testid=agent-card-reply]')`, 30000).catch(() => {});
  await onTop('folded reply card');
  // rest: only the chevron shows; focus opens the rest to its right and the chevron does not move
  a = await strip(); const before = a.chevron;
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('the tray is open', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await wait(500);
  a = await onTop('tray open');
  assert.deepEqual(a.actions, ['chevron', 'more', 'split', 'full'], 'half open: collapse, expand more, split, full screen');
  assert.equal(a.moreOpacity, '0', 'at rest the other actions are hidden ' + JSON.stringify([a.moreOpacity, await browser.evaluate('matchMedia("(hover:none)").matches + " focus=" + document.activeElement?.dataset.testid')]));
  const rest = a.chevron;
  await browser.press('Shift'); await browser.evaluate(`document.querySelector('[data-action=chevron]').focus()`); await wait(400);
  const opened = await strip();
  assert.equal(opened.moreOpacity, '1', 'focus within shows the other actions');
  assert.deepEqual(opened.chevron, rest, 'the chevron does not move when the strip opens');
  assert.ok(opened.moreLeft >= rest.x + rest.w - 1, `the other actions open to the chevron's right (${opened.moreLeft} vs ${rest.x + rest.w})`);
  await click('[data-testid=agent-tray-grow]'); await wait(500);
  a = await onTop('tray, fully open');
  assert.deepEqual(a.actions, ['chevron', 'split', 'full'], 'fully open: collapse, split and full screen');
  await click('[data-testid=agent-tray-full]');
  await browser.until('full screen', `!!document.querySelector('[data-testid=agent-full]')`); await wait(500);
  a = await strip();
  assert.deepEqual(a.actions, ['chevron'], 'full screen: the strip is the back chevron alone');
  assert.deepEqual(a.ids, ['agent-full-back']);
  await click('[data-testid=agent-full-back]');
  await browser.until('back to the tray', `!document.querySelector('[data-testid=agent-full]') && !!document.querySelector('[data-testid=agent-tray-dock]')`); await wait(500);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('docked', `!!document.querySelector('[data-testid=agent-layer-undock]')`); await wait(500);
  assert.equal(await strip(), null, 'docked: no strip on the bottom composer');
  assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer-header] button')].filter(e => e.getClientRects().length).map(e => e.dataset.testid)`).then(list => list.filter(id => /undock|close/.test(id))), ['agent-layer-undock', 'agent-layer-close'], 'docked: the column header has undock then collapse');
  await click('[data-testid=agent-layer-undock]');
  await browser.until('back to the tray', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=agent-tray-reduce]');
  await browser.until('folded again', `!document.querySelector('[data-testid=agent-tray]')`);
  a = await strip(); assert.deepEqual(a.actions, ['chevron', 'full'], 'folded again: the chevron and full screen');
  assert.ok(before.w > 0);
});

// Keyboard only: Enter on the controller's chevron opens the conversation, and Esc pressed there (focus stays on the strip) closes it again.
test('1440: Esc on the controller strip closes the conversation (keyboard only)', { skip, timeout: 120000 }, async () => {
  await open(1440);
  await browser.press('Shift'); await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]').focus()`);
  await browser.press('Enter');
  await browser.until('the tray', `!!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset?.testid`), 'agent-tray-reduce', 'focus is on the strip chevron');
  // The chevron's tooltip (open on keyboard focus) takes the first Esc, as any tooltip does; the next one reaches the tray.
  await browser.press('Escape');
  if (await count('[data-testid=agent-tray]')) await browser.press('Escape');
  await browser.until('closed by Esc on the strip', `!document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]').getAttribute('aria-expanded')`), 'false');
});

const sameRect = (a, b, what) => { for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[key] - b[key]) <= 1.5, `${what}: ${key} ${a[key]} vs ${b[key]}`); };
const focused = () => browser.evaluate(`document.activeElement?.dataset?.testid ?? document.activeElement?.tagName`);

// Julien: full screen from the docked column. The docked header has a Full screen icon; the conversation fills the main area (nav and right pane stay), back returns to docked.
test('1440: the docked header has Full screen: the main area fills, back and Esc return to the docked column, focus on the opener', { skip, timeout: 120000 }, async () => {
  await open(1440, 'demo=1&single=1');
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('the tray', `!!document.querySelector('[data-testid=agent-tray-dock]')`);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('docked', `!!document.querySelector('[data-testid=agent-layer-undock]')`); await wait(400);
  assert.equal(await count('[data-testid=composer-controller]'), 0, 'docked: no strip');
  const ids = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer-header] button')].filter(e => e.getClientRects().length).map(e => e.dataset.testid)`);
  assert.ok(ids.includes('agent-layer-full') && ids.indexOf('agent-layer-full') < ids.indexOf('agent-layer-undock'), `the docked header has Full screen before undock (${ids})`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-layer-undock]').getAttribute('aria-pressed')`), 'true', 'undock stays the pressed split');
  await click('[data-testid=agent-layer-full]');
  await browser.until('full screen', `!!document.querySelector('[data-testid=agent-full]')`); await wait(500);
  sameRect(await rect('[data-testid=agent-full]'), await rect('[data-boring=dock-main]'), 'the host is the main area');
  assert.equal(await count('[data-testid=composer-controller] button'), 1, 'full screen: the strip is the back chevron alone');
  await browser.screenshot('one-composer-1440-light-docked-full.png');
  await click('[data-testid=agent-full-back]');
  await browser.until('back to the docked column', `!document.querySelector('[data-testid=agent-full]') && !!document.querySelector('[data-testid=agent-layer-undock]')`); await wait(500);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-layer]').dataset.placement`), 'docked', 'back is the docked column, not the tray');
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'not the tray');
  await wait(200);
  assert.equal(await focused(), 'agent-layer-full', 'focus is back on the opener');
  // Esc does the same.
  await click('[data-testid=agent-layer-full]');
  await browser.until('full again', `!!document.querySelector('[data-testid=agent-full]')`); await wait(400);
  await browser.press('Escape');
  await browser.until('docked again', `!document.querySelector('[data-testid=agent-full]') && !!document.querySelector('[data-testid=agent-layer-undock]')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-layer]').dataset.placement`), 'docked', 'Esc returns to the docked column');
});

// The collapsed bar's own full-screen action: hover or focus reveals it, it fills the main area, and back returns to the collapsed bar (not to the grown tray).
test('1440: the collapsed bar\'s full screen: revealed by focus, fills the main area, back and Esc return to the collapsed bar with focus on the opener', { skip, timeout: 120000 }, async () => {
  await open(1440, 'demo=1&single=1');
  const reveal = () => browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=agent-tray-full]').parentElement).opacity + '|' + document.querySelector('[data-testid=agent-tray-full]').getBoundingClientRect().width`);
  await browser.evaluate(`document.querySelector('[data-action=chevron]').blur()`); await wait(300);
  const rest = await reveal();
  await browser.press('Shift'); await browser.evaluate(`document.querySelector('[data-action=chevron]').focus()`); await wait(400);
  const shown = await reveal();
  assert.notEqual(shown, rest, `focus reveals the Full screen action (${rest} -> ${shown})`);
  await click('[data-testid=agent-tray-full]');
  await browser.until('full screen', `!!document.querySelector('[data-testid=agent-full]')`); await wait(500);
  sameRect(await rect('[data-testid=agent-full]'), await rect('[data-boring=dock-main]'), 'the host is the main area');
  await click('[data-testid=agent-full-back]');
  await browser.until('the collapsed bar', `!document.querySelector('[data-testid=agent-full]') && !document.querySelector('[data-testid=agent-tray]')`); await wait(500);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]').getAttribute('aria-expanded')`), 'false', 'back is the collapsed bar, not the grown tray');
  await wait(200);
  assert.equal(await focused(), 'agent-tray-full', 'focus is back on the opener');
  await click('[data-testid=agent-tray-full]');
  await browser.until('full again', `!!document.querySelector('[data-testid=agent-full]')`); await wait(400);
  await browser.press('Escape');
  await browser.until('collapsed again', `!document.querySelector('[data-testid=agent-full]') && !document.querySelector('[data-testid=agent-tray]')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]').getAttribute('aria-expanded')`), 'false', 'Esc returns to the collapsed bar');
});

// Julien: docking while a file is open in the right pane left the conversation behind the pane. Docking replaces the pane: the file closes and the column takes its place.
test('1440: docking with a file open closes the preview, and the docked conversation is visible, on top, with focus in its field', { skip, timeout: 120000 }, async () => {
  await open(1440, 'demo=1&single=1');
  await browser.evaluate(`window.__openFile('uploads/discrepancies-january.csv')`);
  await browser.until('the file is open in the pane', `!!document.querySelector('[data-testid=agent-preview]')`);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('the tray is open', `!!document.querySelector('[data-testid=agent-tray-dock]')`);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('docked', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await wait(500);
  assert.equal(await count('[data-testid=agent-preview]'), 0, 'the preview is closed');
  const column = await rect('[data-testid=agent-layer]');
  assert.ok(column && column.w > 200 && column.h > 200, `the docked column has a real rect (${JSON.stringify(column)})`);
  const top = await browser.evaluate(`(() => { const r = document.querySelector('[data-testid=agent-layer]').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + 100); return !!e && !!e.closest('[data-testid=agent-layer]'); })()`);
  assert.equal(top, true, 'the docked conversation is on top at its centre');
  assert.equal(await browser.evaluate(`!!document.activeElement?.closest('[data-testid=agent-layer]')`), true, 'focus is inside the docked column');
  assert.equal(await count('[data-testid=agent-layer] [data-testid=composer-input]'), 1, 'one field, in the column');
});

// A pane entry with `frame: false` draws its own header (an editor): the pane adds none, and its close and back still work (one header, not two).
for (const width of [1280, 390]) test(`${width}: a frameless pane entry shows one header, back steps under it and close closes the pane`, { skip, timeout: 120000 }, async () => {
  await open(width, 'demo=1&single=1');
  await browser.evaluate(`window.__openFile('uploads/discrepancies-january.csv')`);
  await browser.until('the file is open', `!!document.querySelector('[data-testid=agent-preview] [data-testid=agent-preview-title]')`);
  await browser.evaluate(`window.__openBare()`);
  await browser.until('the bare entry is on top', `!!document.querySelector('[data-pane-top] [data-testid=bare-editor]')`);
  assert.equal(await count('[data-pane-top] [data-testid=bare-header]'), 1, 'the content draws one header');
  assert.equal(await count('[data-pane-top] [data-testid=agent-preview-title]'), 0, 'the pane draws none above it');
  assert.equal(await count('[data-pane-top] [data-testid=agent-preview-close]'), 0, 'no pane close under the content header');
  await click('[data-testid=bare-back]');
  await browser.until('back shows the file', `!!document.querySelector('[data-pane-top] [data-testid=agent-preview-title]') && !document.querySelector('[data-pane-top] [data-testid=bare-editor]')`);
  await browser.evaluate(`window.__openBare()`);
  await browser.until('bare again', `!!document.querySelector('[data-pane-top] [data-testid=bare-editor]')`);
  await click('[data-testid=bare-close]');
  await browser.until('the pane is closed', `!document.querySelector('[data-testid=agent-preview]')`);
});

// Julien: the composer in full screen looked different (square corners, square buttons): the portalled host lost the shell's scoped rules. The controller is one small notch.
const composerLook = () => browser.evaluate(`(() => { const ig = document.querySelector('[data-testid=composer] [data-slot=input-group]'), bx = document.querySelector('[data-testid=agent-composer-box]'), g = bx && bx.getBoundingClientRect().height > 0 && bx.contains(ig) ? bx : ig, a = document.querySelector('[data-testid=composer-bar-attach]'), m = document.querySelector('[data-testid=agent-talk], [data-testid=composer-submit]');
  const r = e => parseFloat(getComputedStyle(e).borderTopLeftRadius); return { groupHeight: Math.round(g.getBoundingClientRect().height), groupRadius: r(g), attachRadius: r(a), attachCircle: r(a) >= a.getBoundingClientRect().height / 2 - 1, micCircle: r(m) >= m.getBoundingClientRect().height / 2 - 1, attachHeight: Math.round(a.getBoundingClientRect().height) }; })()`);
test('1440: the composer has the same radius, height and round buttons in the bar, the grown tray and full screen; full has a Close that ends at the bar', { skip, timeout: 180000 }, async () => {
  await open(1440, 'demo=1&single=1&pace=instant');
  const bar = await composerLook();
  assert.ok(bar.groupRadius >= 16 && bar.attachCircle && bar.micCircle, `the bar is fully rounded with round buttons (${JSON.stringify(bar)})`);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('the tray', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=agent-tray-grow]'); await wait(500);
  const grown = await composerLook();
  await click('[data-testid=agent-tray-full]');
  await browser.until('full', `!!document.querySelector('[data-testid=agent-full]')`); await wait(500);
  const full = await composerLook();
  for (const [name, look] of [['grown', grown], ['full', full]]) assert.deepEqual({ ...look, groupHeight: look.groupHeight }, { ...bar, groupHeight: look.groupHeight }, `the composer's radius and round buttons are the bar's in ${name} (${JSON.stringify(look)} vs ${JSON.stringify(bar)})`);
  assert.equal(full.groupHeight, bar.groupHeight, 'the same height in full screen ' + JSON.stringify([bar, full]));
  assert.equal(await count('[data-testid=agent-full] [data-testid=agent-full-close]'), 1, 'full screen has a Close');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-full-close]').getAttribute('aria-label')`), 'Close');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-full-close]').textContent.trim()`), '', 'Close is an icon only');
  await click('[data-testid=agent-full-close]');
  await browser.until('closed to the bar', `!document.querySelector('[data-testid=agent-full]') && !document.querySelector('[data-testid=agent-tray]')`); await wait(300);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'composer-input', 'focus is on the bare field');
});

test('1440 and 390: the controller is one small notch: one box, cells at most 34 px wide, at most 20 px high, no circle larger than the strip', { skip, timeout: 180000 }, async () => {
  for (const [width, query] of [[1440, 'demo=1&single=1&pace=instant'], [390, 'demo=1&tabs=1&pace=instant']]) {
    await open(width, query);
    if (width < 500) { await browser.until('the bar', `!!document.querySelector('[data-testid=composer-input]')`); assert.equal(await count('[data-testid=composer-controller]'), 0, 'a phone has no strip'); continue; }
    await browser.until('the strip', `!!document.querySelector('[data-testid=composer-controller]')`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await wait(300);
    const measure = () => browser.evaluate(`(() => { const s = document.querySelector('[data-testid=composer-controller]'), box = s.querySelector('[aria-hidden=true]').getBoundingClientRect(); const cells = [...s.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      const inside = innerWidth < 500 || cells.every(c => c.width === 0 || (c.left >= box.left - 1 && c.right <= box.right + 1 && c.top >= box.top - 1 && c.bottom <= box.bottom + 1));
      const tallList = [...s.querySelectorAll('*')].filter(e => !(e instanceof SVGElement) && (innerWidth < 500 ? e.tagName !== 'BUTTON' && e.tagName !== 'SPAN' : true) && e.getBoundingClientRect().height > box.height + 1).map(e => e.tagName + '.' + String(e.className).slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().height)), tall = tallList.length;
      return { h: box.height, w: box.width, cells: cells.map(c => Math.round(c.width)), inside, tall, tallList, shapes: s.querySelectorAll('[data-slot=button]').length }; })()`);
    const rest = await measure();
    assert.ok(rest.h <= 20 && (width < 500 || Math.max(...rest.cells) <= 34) && rest.inside && rest.tall === 0 && rest.shapes === 0, `${width}: one small notch at rest (${JSON.stringify(rest)})`);
    await browser.evaluate(`document.querySelector('[data-action=chevron]').focus()`); await browser.press('Shift'); await browser.evaluate(`document.querySelector('[data-action=chevron]').blur(); document.querySelector('[data-action=chevron]').focus()`); await wait(400);
    const opened = await measure();
    assert.ok(opened.h <= 20 && Math.max(...opened.cells) <= 34 && opened.inside && opened.tall === 0, `${width}: opened, the extra cells are inside the one box (${JSON.stringify(opened)})`);
    assert.ok(opened.w > rest.w, 'the one container widens');
  }
});

// Julien: "still a problem on mobile". A phone has no strip: the sheet's grabber is the size control (tap: next snap), the header is title, History, Library and one X, and the bar's buttons are circles.
for (const width of [390, 360]) test(`${width}: no strip on a phone, the grabber taps through peek, half and full, round buttons on the bar's midline, the header has History, Library and an X`, { skip, timeout: 180000 }, async () => {
  await open(width, 'tabs=1');
  await browser.until('the bar', `!!document.querySelector('[data-testid=composer-input]')`);
  assert.equal(await count('[data-testid=composer-controller]'), 0, 'no strip on a phone');
  const state = () => browser.evaluate(`document.querySelector('[data-testid=agent-layer]')?.dataset.state`);
  const look = () => browser.evaluate(`(() => { const g = document.querySelector('[data-testid=composer] [data-slot=input-group]').getBoundingClientRect(), mid = g.top + g.height / 2;
    return [...document.querySelectorAll('[data-testid=composer-bar-attach], [data-testid=agent-talk], [data-testid=composer-submit]')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(), rad = parseFloat(getComputedStyle(e).borderTopLeftRadius); return { id: e.dataset.testid, circle: rad >= Math.min(r.width, r.height) / 2 - 1, w: Math.round(r.width), h: Math.round(r.height), off: Math.abs(r.top + r.height / 2 - mid) }; }); })()`);
  for (const b of await look()) assert.ok(b.circle && b.w >= 40 && b.h >= 40 && b.off <= 1, `${b.id} is a circle of at least 40 px on the bar's midline (${JSON.stringify(b)})`);
  assert.equal(await state(), 'peek');
  const hit = await rect('[data-testid=agent-bar-conversation]');
  assert.ok(hit.w >= 44 && hit.h >= 44, `the keyboard twin of the grabber is a 44 px box (${hit.w}x${hit.h})`);
  const tap = async () => { const [x, y] = await center('[data-slot=drawer-swipe-handle]'); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(900); };
  await tap(); assert.equal(await state(), 'half', 'a tap on the grabber goes from peek to half');
  assert.equal(await count('[data-testid=composer-controller]'), 0, 'still no strip at half');
  const header = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer-header] button')].filter(e => e.getClientRects().length).map(e => [e.dataset.testid, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])`);
  assert.deepEqual(header.map(h => h[0]).filter(id => id !== 'history-open'), ['agent-layer-library', 'agent-layer-close'], `the header has (History when the app has conversations,) Library and one X, no size icon (${JSON.stringify(header)})`);
  assert.ok(header.every(([, w, h]) => w >= 44 && h >= 44), 'each header control is a 44 px box');
  await tap(); assert.equal(await state(), 'full', 'a tap goes from half to full');
  await tap(); assert.equal(await state(), 'peek', 'a tap goes from full back to peek');
  await tap(); await click('[data-testid=agent-layer-close]'); await wait(800);
  assert.equal(await state(), 'peek', 'the X collapses to peek');
});

test('1280: typing grows the field;  a file is a name-only chip; « / » is filtered by the field; a question asks in the box (AC-4, AC-5, AC-6, AC-8)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await type('Prépare la relance du dossier Cèdre :');
  for (const line of ['– les deux relevés de février', '– la facture du loyer']) { await browser.press('Enter', { shift: true }); await browser.send('Input.insertText', { text: line }); }
  await wait(150);
  const input = await rect(FIELD), send = await rect('[data-testid=composer-submit]');
  assert.ok(input.h > 40, `the field grew (${input.h}px)`);
  await open(1280);
  await browser.evaluate(`(() => { const data = new DataTransfer(); data.items.add(new File(['x'], 'releve-fevrier.pdf', { type: 'application/pdf' })); document.querySelector('[data-testid=composer]').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); })()`);
  await browser.until('file chip', `[...document.querySelectorAll('[data-testid=composer] [data-testid=mention-chip]')].some(e => e.textContent.includes('releve-fevrier.pdf'))`);
  const chipText = await browser.evaluate(`document.querySelector('[data-testid=composer] [data-testid=mention-chip]').textContent`);
  assert.ok(!chipText.includes('uploads/'), `the chip names the file only (${chipText})`);
  assert.ok(!(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`)).includes('@uploads/'), 'the field holds no raw @path');
  await type('Rapproche-le');
  await click('[data-testid=composer-submit]');
  await browser.until('sent', `window.__sent.length === 1`);
  assert.ok((await browser.evaluate('window.__sent[0]')).includes('@uploads/releve-fevrier.pdf'), 'the file is still sent with the message');
  // Sent, the file is one of the conversation's files: it lives in the 📎 menu, never twice on screen (Julien, demo review).
  assert.equal(await count('[data-testid=conversation-files]'), 0, 'no separate « Fichiers » button above the field');
  await click('[data-testid=composer-bar-attach]');
  await browser.until('files menu', `!!document.querySelector('[data-testid=conversation-files-list]')`);
  assert.equal(await count('[data-testid=conversation-files-list] [data-testid=composer-attach]'), 1, 'attach first');
  assert.ok((await browser.evaluate(`[...document.querySelectorAll('[data-testid=conversation-files-list] [data-testid=conversation-file]')].map(e => e.textContent).join('|')`)).includes('releve-fevrier.pdf'), 'then the conversation\'s files');
  await browser.press('Escape');
  await open(1280);
  await type('/rel');
  await browser.until('slash list', `!!document.querySelector('[data-testid=slash-item]')`);
  assert.equal(await count('[data-testid=slash-search]'), 0, 'no second search box: the field filters');
  await open(1280);
  await browser.evaluate(`window.__run('form')`);
  await browser.until('question', `!!document.querySelector('[data-testid=agent-card] [data-testid=agent-question]')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').getAttribute('placeholder')`), 'Ou répondez ici');
  assert.equal(await count('[data-testid=agent-card] [data-part=question]'), 0, 'the question is drawn in the box, not as the agent bar\'s coloured card');
  const step = await rect('[data-testid=agent-question-step]'), boxRect = await rect('[data-testid=agent-composer-box]');
  assert.ok(step.y >= boxRect.y && step.x >= boxRect.x, 'the first line is inside the box, not clipped');
});

test('1280: a file opened while the conversation is not docked takes the right column; the conversation stays above the field (AC-18)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.evaluate(`window.__openFile('uploads/ecarts-janvier.csv')`);
  await browser.until('preview', `!!document.querySelector('[data-testid=agent-preview] [data-testid=fixture-preview]')`);
  await oneField('preview, not docked');
  const preview = await rect('[data-testid=agent-preview]'), main = await rect('[data-boring=dock-main]');
  assert.ok(preview.x >= main.right - 1 && preview.h >= 700, `the preview is the right column (${JSON.stringify(preview)})`);
  assert.equal(await inside('[data-testid=agent-tray]', '[data-testid=agent-composer-box]'), true, 'the conversation stays above the field');
  await click('[data-testid=agent-preview] [data-testid=agent-preview-library]');
  await browser.until('library in the right pane', `!!document.querySelector('[data-testid=agent-preview] [data-testid=fixture-library]')`);
  assert.equal(await text('[data-testid=agent-preview-title]'), 'Bibliothèque');
  await browser.evaluate(`document.querySelector('[data-testid=fixture-library-file][data-path="uploads/releve-fevrier.pdf"]').click()`);
  await browser.until('picked file in the pane', `(document.querySelector('[data-testid=agent-preview-title]')?.textContent ?? '').includes('releve-fevrier.pdf')`);
  assert.equal(await browser.evaluate('window.__library'), 1, 'one pick');
  await type('Que contient ce fichier ?');
  await click('[data-testid=composer-submit]');
  await browser.until('usable', `window.__sent.includes('Que contient ce fichier ?')`);
  await browser.screenshot('one-composer-1280-light-preview.png');
  await click('[data-testid=agent-preview-close]');
  await browser.until('closed', `!document.querySelector('[data-testid=agent-preview]')`);
  await oneField('preview closed');
});

test('1280: a file opened while docked stacks on the conversation in the same column; « ← Assistant » goes back; the field stays at the bottom of the column (AC-19)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('Ancré', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await browser.evaluate(`window.__openFile('uploads/ecarts-janvier.csv')`);
  await browser.until('stacked', `document.querySelector('[data-testid=agent-preview]')?.dataset.placement === 'stacked'`);
  await oneField('preview stacked');
  assert.equal(await dockState(), 'open', 'the dock stays');
  assert.equal(await inside('[data-testid=agent-preview]', '[data-testid=agent-layer]'), true, 'the preview is in the docked column');
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'nothing comes back to the bottom');
  assert.equal(await inside(FIELD, '[data-testid=agent-layer]'), true, 'the field stays in the column');
  const preview = await rect('[data-testid=agent-preview]'), input = await rect(FIELD);
  assert.ok(preview.bottom <= input.y + 1, 'the field is under the preview');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer] [data-testid=conversation-content]')].every(e => !e.checkVisibility({ visibilityProperty: true }))`), true, 'the thread waits under the preview');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer] [data-testid=conversation-files], [data-testid=agent-layer] [data-testid=preparing]')].filter(e => e.getClientRects().length > 0).length`), 0, 'under the file only the field: no files button, no status line (Julien, demo review)');
  assert.ok((await text('[data-testid=agent-preview-title]')).includes('ecarts-janvier.csv'));
  // The pane's back stack (bar-parity): the file's own bar is the column's one title row, « ← Assistant »; each entry's back returns to the one under it.
  const shownCount = selector => browser.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.checkVisibility({ visibilityProperty: true })).length`);
  assert.equal(await shownCount('[data-testid=agent-layer] [data-testid=agent-preview-back]'), 1, 'one header: « ← Assistant » is in the file\'s bar');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-preview-back]').getAttribute('aria-label')`), 'Retour à Assistant');
  assert.equal(await shownCount('[data-testid=agent-layer-title]'), 0, 'no second title row above the file');
  await click('[data-testid=agent-layer] [data-testid=agent-preview-library]');
  await browser.until('library over the docked chat', `!!document.querySelector('[data-testid=agent-layer] [data-pane-top] [data-testid=fixture-library]')`);
  assert.equal(await text('[data-testid=agent-layer] [data-testid=agent-preview-title]'), 'Bibliothèque', 'the library takes the column');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-preview-back]').getAttribute('aria-label')`), 'Retour à ecarts-janvier.csv', '« ← ecarts-janvier.csv »: the file waits under the library');
  await browser.evaluate(`document.querySelector('[data-testid=agent-layer] [data-testid=fixture-library-file][data-path="uploads/releve-janvier.pdf"]').click()`);
  await browser.until('picked file over the docked chat', `(document.querySelector('[data-testid=agent-layer] [data-testid=agent-preview-title]')?.textContent ?? '').includes('releve-janvier.pdf')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-preview-back]').getAttribute('aria-label')`), 'Retour à Bibliothèque', '« ← » names the library');
  await browser.screenshot('one-composer-1280-light-preview-docked.png');
  for (const under of ['Bibliothèque', 'ecarts-janvier.csv']) {
    await click('[data-testid=agent-preview-back]');
    await browser.until(`back to ${under}`, `document.querySelector('[data-testid=agent-preview-title]')?.textContent === ${JSON.stringify(under)}`);
  }
  await click('[data-testid=agent-preview-back]');
  await browser.until('back to the thread', `!document.querySelector('[data-testid=agent-preview]')`);
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer] [data-testid=conversation-content]')].some(e => e.checkVisibility({ visibilityProperty: true }))`), true, 'the thread is back');
  await oneField('back');
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
  // At rest on a phone the one field is already there, above the tabs (AC-20).
  await browser.until('peek', `!!document.querySelector('[data-testid=composer-input]')`);
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
  await browser.evaluate(`(() => { let node = document.querySelector('[data-testid=page-row]:last-of-type'); while (node && !(node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement; (node ?? document.scrollingElement).scrollTop = 1e6; })()`);
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
    await browser.screenshot(`one-composer-1280-${name}-preview-docked.png`);
    await open(1280, query);
    await browser.evaluate(`window.__layer.open('agent')`);
    await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
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
    // The composer's own states, for the expected-vs-delivered proof (AC-24): typing on several lines, a file, « / », a question.
    await open(1280, query);
    await type('Prépare la relance du dossier Cèdre :');
    for (const line of ['– les deux relevés de février', '– la facture du loyer', '– le contrat d’assurance']) { await browser.press('Enter', { shift: true }); await browser.send('Input.insertText', { text: line }); }
    await wait(150);
    await browser.screenshot(`one-composer-1280-${name}-typing.png`);
    await open(1280, query);
    await browser.evaluate(`(() => { const data = new DataTransfer(); data.items.add(new File(['x'], 'releve-fevrier.pdf', { type: 'application/pdf' })); document.querySelector('[data-testid=composer]').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); })()`);
    await browser.until('file chip', `!!document.querySelector('[data-testid=composer] [data-testid=attachment], [data-testid=composer] [data-testid=mention-chip], [data-testid=composer] [data-testid=upload-chip]')`, 10000).catch(() => {});
    await type('Rapproche-le');
    await wait(150);
    await browser.screenshot(`one-composer-1280-${name}-files.png`);
    await open(1280, query);
    await type('/rel');
    await browser.until('slash list', `!!document.querySelector('[data-testid=slash-item]')`);
    await browser.screenshot(`one-composer-1280-${name}-slash.png`);
    await open(1280, query);
    await browser.evaluate(`window.__run('form')`);
    await browser.until('question card', `!!document.querySelector('[data-testid=agent-card] [data-testid=agent-question]')`);
    await browser.screenshot(`one-composer-1280-${name}-question.png`);
    // A phone has the drawer: peek is Ambiant, half Ouvert, full Ancré; the preview covers the screen.
    await open(390, query ? `${query}&tabs=1` : 'tabs=1');
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

const mouse = (type, x, y) => browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const center = async selector => { const box = await rect(selector); return [box.x + box.w / 2, box.y + box.h / 2]; };
const atRest = `document.querySelector('[data-testid=agent-talk]')?.dataset.state === 'idle' && !document.querySelector('[data-testid=agent-talk-status]')`;

test('1280: Dicter: a tap listens until ■ and leaves the words in the field; a hold says « Relâche pour envoyer » and release sends; a slide off or Échap sends nothing; nothing opens (AC-10, AC-11, AC-25)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  // A tap: ✕, « J’écoute… » and ■ in the action button's place; ■ puts the words in the field, nothing is sent.
  let [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
  await browser.until('listening', `!!document.querySelector('[data-testid=agent-talk-stop]') && !!document.querySelector('[data-testid=agent-talk-listening]')`);
  assert.equal(await count('[data-testid=agent-talk-cancel]'), 1, '✕ cancels');
  assert.equal(await inside('[data-testid=agent-talk-status]', '[data-testid=agent-composer-box]'), true, 'in the one box');
  await browser.screenshot('one-composer-1280-light-dictate.png');
  await click('[data-testid=agent-talk-stop]');
  await browser.until('words in the field', `document.querySelector('[data-testid=composer-input]')?.value === 'Texte dicté fictif'`);
  assert.deepEqual(await browser.evaluate('window.__sent'), [], 'a tap never sends');
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'nothing opens');
  assert.equal(await dockState(), 'closed');
  await browser.evaluate(`window.__setText('')`);
  await browser.until('rest', atRest);
  // A tap, then ✕: nothing in the field, nothing sent.
  [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
  await browser.until('listening again', `!!document.querySelector('[data-testid=agent-talk-cancel]')`);
  await click('[data-testid=agent-talk-cancel]');
  await browser.until('cancelled', atRest);
  await wait(300);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`), '', '✕ leaves nothing');
  // A hold: « Relâche pour envoyer »; release sends at once and the box stays folded with the work.
  [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y);
  await browser.until('holding', `!!document.querySelector('[data-testid=agent-talk-release]')`);
  assert.equal(await text('[data-testid=agent-talk-release]'), 'Relâche pour envoyer');
  await browser.screenshot('one-composer-1280-light-hold.png');
  await mouse('mouseReleased', x, y);
  await browser.until('sent on release', `window.__sent.includes('Texte dicté fictif')`);
  await browser.until('working on the field', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'a hold-send opens nothing');
  await browser.until('the run ends', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply' && ${atRest}`);
  // A hold, then a slide off: cancelled, nothing sent.
  [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y);
  await browser.until('holding to slide', `!!document.querySelector('[data-testid=agent-talk-release]')`);
  await mouse('mouseMoved', x, y - 120);
  await browser.until('slid off', `!document.querySelector('[data-testid=agent-talk-status]')`);
  await mouse('mouseReleased', x, y - 120);
  // A hold, then Échap: cancelled, nothing sent.
  [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y);
  await browser.until('holding for Escape', `!!document.querySelector('[data-testid=agent-talk-release]')`);
  await browser.press('Escape');
  await browser.until('Escape cancels', `!document.querySelector('[data-testid=agent-talk-status]')`);
  await mouse('mouseReleased', x, y);
  await wait(500);
  assert.deepEqual(await browser.evaluate('window.__sent'), ['Texte dicté fictif'], 'only the released hold was sent');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`), '', 'the cancelled holds left nothing in the field');
});

test('1280, folded: a failed send puts the text back in the field, says so on one line at the top of the box, and Réessayer sends it (AC-12)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await type('Relance le dossier Cèdre');
  await browser.evaluate('window.__failNext = true');
  await click('[data-testid=composer-submit]');
  await browser.until('problem line', `!!document.querySelector('[data-testid=agent-send-problem]')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`), 'Relance le dossier Cèdre', 'the text is back in the field');
  assert.deepEqual(await browser.evaluate('window.__sent'), []);
  assert.equal(await inside('[data-testid=agent-send-problem]', '[data-testid=agent-composer-box]'), true, 'in the one box, above the field');
  const line = await rect('[data-testid=agent-send-problem]'), field = await rect('[data-testid=composer]');
  assert.ok(line.bottom <= field.y + 1 && line.h <= 48, `one line above the field (${JSON.stringify(line)})`);
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-composer-box] [data-testid=send-blocked], [data-testid=agent-composer-box] [data-testid=send-unknown]')].filter(e => e.getClientRects().length > 0).length`), 0, 'one line: the chat\'s own notice steps aside (AC-12)');
  assert.equal(await count('[data-testid=agent-tray]'), 0, 'nothing opens');
  await browser.screenshot('one-composer-1280-light-send-failed.png');
  await click('[data-testid=agent-send-retry]');
  await browser.until('sent again', `window.__sent.includes('Relance le dossier Cèdre')`);
  await browser.until('line gone', `!document.querySelector('[data-testid=agent-send-problem]')`);
});

test('1280: read only, the box stays in place with one line giving the reason; nothing in it can be focused (AC-13)', { skip, timeout: 120000 }, async () => {
  await open(1280, 'readonly=1');
  assert.equal(await text('[data-testid=agent-read-only]'), 'Lecture seule : votre rôle permet de lire, pas d’écrire (fictif).');
  assert.equal(await inside('[data-testid=agent-read-only]', '[data-testid=agent-composer-box]'), true, 'in the same box');
  const box = await rect('[data-testid=agent-composer-box]'), column = await rect('[data-boring=dock-main]');
  assert.ok(Math.abs(box.bottom - column.bottom) < 40 && box.w <= 721, `the box keeps its place (${JSON.stringify(box)})`);
  assert.equal(await count(FIELD), 0, 'no field');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-composer-box] *')].filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length > 0).length`), 0, 'nothing focusable in the box');
  await browser.evaluate(`window.__run('reply')`);
  await wait(300);
  assert.equal(await count('[data-testid=agent-card]'), 0, 'no card to act on');
  await browser.screenshot('one-composer-1280-light-read-only.png');
});

test('1280: edit last the Claude Code way: ↑ recalls, ↓ comes back, Échap stops a run, Échap twice lists the messages and a pick forks before it; a long press on an own message offers Reprendre and Revenir ici (AC-14)', { skip, timeout: 120000 }, async () => {
  await open(1280, 'fork=1');
  const value = () => browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`);
  await type('Combien de pièces manquent ?');
  await click('[data-testid=composer-submit]');
  await browser.until('the run ends', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.press('ArrowUp');
  await browser.until('last message recalled', `document.querySelector('[data-testid=composer-input]').value === 'Combien de pièces manquent ?'`);
  await browser.press('ArrowUp');
  await browser.until('the one before', `document.querySelector('[data-testid=composer-input]').value === 'Où en est le dossier Cèdre ?'`);
  await browser.press('ArrowDown');
  await browser.until('forward again', `document.querySelector('[data-testid=composer-input]').value === 'Combien de pièces manquent ?'`);
  await browser.press('ArrowDown');
  await browser.until('empty again', `document.querySelector('[data-testid=composer-input]').value === ''`);
  // Échap during a run stops it.
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('working', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.press('Escape');
  await browser.until('stopped', `window.__stops === 1`);
  // Échap twice in an empty field: the person's messages, newest first; a pick forks before it with the message in the field.
  // (`__run('tool')` replaced the thread with the scripted turn « Rapproche le relevé de janvier. » after the history.)
  await browser.until('rest', `document.querySelector('[data-testid=agent-card]')?.dataset.state !== 'working'`);
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.press('Escape'); await browser.press('Escape');
  await browser.until('rewind list', `!!document.querySelector('[data-testid=rewind-list]')`);
  assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid=rewind-item]')].map(e => e.textContent)`), ['Rapproche le relevé de janvier.', 'Où en est le dossier Cèdre ?']);
  assert.equal(await inside('[data-testid=rewind-list]', '[data-testid=agent-composer-box]'), true, 'above the field, in the box');
  await browser.screenshot('one-composer-1280-light-rewind.png');
  await click('[data-testid=rewind-item]');
  await browser.until('forked', `(window.__forked ?? []).length === 1`);
  assert.equal(await value(), 'Rapproche le relevé de janvier.', 'the picked message is in the field');
  assert.equal(await count('[data-testid=rewind-list]'), 0);
  // The first message has no reply before it: a new conversation, with it in the field.
  await browser.evaluate(`window.__setText('')`);
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.press('Escape'); await browser.press('Escape');
  await browser.until('rewind list again', `document.querySelectorAll('[data-testid=rewind-item]').length === 2`);
  await browser.evaluate(`document.querySelectorAll('[data-testid=rewind-item]')[1].click()`);
  await browser.until('new conversation', `window.__new === 1`);
  assert.equal(await value(), 'Où en est le dossier Cèdre ?');
  // Touch: a long press on an own message in the open conversation.
  await browser.evaluate(`window.__setText('')`);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray] [data-testid=own-message]')`);
  await browser.evaluate(`(() => { const e = document.querySelector('[data-testid=agent-tray] [data-testid=own-message]'); const r = e.getBoundingClientRect(); e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, clientX: r.x + 4, clientY: r.y + 4 })); })()`);
  await browser.until('long-press menu', `!!document.querySelector('[data-testid=own-message-resume]') && !!document.querySelector('[data-testid=own-message-rewind]')`);
  assert.equal(await text('[data-testid=own-message-resume]'), 'Reprendre');
  assert.equal(await text('[data-testid=own-message-rewind]'), 'Revenir ici');
  await click('[data-testid=own-message-resume]');
  await browser.until('resumed', `document.querySelector('[data-testid=composer-input]').value === 'Où en est le dossier Cèdre ?'`);
});

test('390: the one field rests above the tabs; the chevron opens half with the tabs kept; full hides them; the drawer has the same one-row field (AC-20)', { skip, timeout: 120000 }, async () => {
  await open(390, 'tabs=1');
  const tabs = '[data-testid=tabbar]';
  const tabbar = await browser.evaluate(`(() => { const e = [...document.querySelectorAll(${js(tabs)})].find(e => e.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { y: r.y, h: r.height, x: r.x + r.width / 2 }; })()`);
  assert.ok(tabbar && tabbar.h > 0, 'the phone shows its tabs');
  await browser.until('the field at rest', `!!document.querySelector('[data-testid=composer-input]')`);
  assert.equal(await dockState(), 'peek', 'at rest: the peek');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer]').dataset.layout`), 'pill', 'the same one-row field as on a computer');
  assert.equal(await count('[data-testid=agent-bar-conversation]'), 1, 'with the chevron');
  assert.equal(await actionName(), 'Dicter');
  assert.deepEqual(await rowControls(), ['composer-bar-attach', 'composer-input', 'composer-bar-commands', 'agent-talk'], 'the phone row is the same one row: attach, field, the Commands button of touch screens, one microphone (AC-2, AC-20)');
  const field = await rect('[data-testid=composer]');
  assert.ok(field.bottom <= tabbar.y + 1, `the field sits above the tabs (${field.bottom} <= ${tabbar.y})`);
  const tabHit = () => browser.evaluate(`(() => { const e = document.elementFromPoint(${tabbar.x}, ${tabbar.y + tabbar.h / 2}); return !!e && !!e.closest(${js(tabs)}); })()`);
  assert.equal(await tabHit(), true, 'the tabs are in view at rest');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer-sheet] [data-testid=conversation-content]')].filter(e => e.getClientRects().length > 0).length`), 0, 'at rest only the field shows, no clipped line of the thread (mockup l-6)');
  const sheetTop = await browser.evaluate(`document.querySelector('[data-testid=agent-layer-sheet]').getBoundingClientRect().top`);
  assert.ok(field.y - sheetTop <= 40, `the rest is the field and the handle, no empty band above it (${field.y - sheetTop}px)`);
  await browser.screenshot('one-composer-390-light-rest-tabs.png');
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('Ouvert: half', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'half'`);
  await wait(700);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]').getAttribute('aria-expanded')`), 'true');
  assert.equal(await tabHit(), true, 'Ouvert keeps the tabs in view');
  const opened = await rect('[data-testid=composer]');
  assert.ok(opened.bottom <= tabbar.y + 1, `Ouvert: the field sits above the tabs (${opened.bottom} <= ${tabbar.y})`);
  await browser.screenshot('one-composer-390-light-ouvert-tabs.png');
  // A tap on the other tab switches screens and leaves the conversation open (it used to fold the sheet instead).
  const pieces = await browser.evaluate(`(() => { const e = [...document.querySelectorAll('[data-testid=tabbar] [role=tab]')].find(t => t.textContent.includes('Pièces')); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await mouse('mousePressed', ...pieces); await mouse('mouseReleased', ...pieces);
  await browser.until('tab pressed', `window.__route === 'pieces'`);
  await wait(300);
  assert.equal(await dockState(), 'half', 'a tab tap keeps Ouvert');
  await browser.evaluate(`window.__layer.open('agent', 'full')`);
  await browser.until('full', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'full'`);
  await wait(700);
  assert.equal(await tabHit(), false, 'full screen hides the tabs');
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('back to rest', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'peek'`);
  await oneField('phone at rest again');
});

test('390: a hold on Dicter says « Relâche pour envoyer » and release sends from the phone\'s field; nothing opens (AC-11 on a phone, AC-25)', { skip, timeout: 120000 }, async () => {
  await open(390, 'tabs=1');
  await browser.until('the field at rest', `!!document.querySelector('[data-testid=agent-talk]')`);
  const [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y);
  await browser.until('holding', `!!document.querySelector('[data-testid=agent-talk-release]')`);
  assert.equal(await text('[data-testid=agent-talk-release]'), 'Relâche pour envoyer');
  await browser.screenshot('one-composer-390-light-hold.png');
  await mouse('mouseReleased', x, y);
  await browser.until('sent on release', `window.__sent.includes('Texte dicté fictif')`);
  await wait(300);
  assert.equal(await dockState(), 'peek', 'the send leaves the phone at rest (AC-25)');
});

// A software keyboard, as a phone reports it: the visual viewport shrinks from the bottom (`?kb=1` installs the stand-in before the page runs).
const KEYBOARD = `if (location.search.includes('kb=1')) { const real = window.visualViewport; const fake = new EventTarget(); let inset = 0;
  for (const key of ['width', 'offsetLeft', 'pageLeft', 'pageTop']) Object.defineProperty(fake, key, { get: () => real[key] });
  Object.defineProperty(fake, 'height', { get: () => window.innerHeight - inset }); Object.defineProperty(fake, 'offsetTop', { get: () => 0 }); Object.defineProperty(fake, 'scale', { get: () => 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  window.__keyboard = px => { inset = px; fake.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); }; }`;

test('390: with the keyboard up the tabs hide, the box sits on the keyboard and the text keeps at least 140 px; the tabs keep the home-bar inset under them (AC-20)', { skip, timeout: 120000 }, async () => {
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: KEYBOARD });
  try {
    await open(390, 'tabs=1&kb=1');
    assert.match(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=tabbar]')).getPropertyValue('padding-bottom') + '|' + [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch { return []; } }).filter(t => t.includes('--app-shell-safe-bottom')).join(' ')`), /safe-area-inset-bottom/, 'the tab bar pads the home-bar inset (env(safe-area-inset-bottom)) under its tabs');
    await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
    await browser.evaluate('window.__keyboard(320)');
    await wait(800);
    const kbTop = 844 - 320;
    const shown = await browser.evaluate(`(() => { const t = document.querySelector('[data-testid=tabbar]').getBoundingClientRect(); const f = document.querySelector('[data-testid=composer]').getBoundingClientRect(); const i = document.querySelector('[data-testid=composer-input]').getBoundingClientRect(); return { tabsTop: t.top, tabsBottom: t.bottom, fieldBottom: f.bottom, input: i.width, state: document.querySelector('[data-testid=agent-layer]')?.dataset.state }; })()`);
    await browser.screenshot('one-composer-390-light-keyboard.png');
    assert.ok(shown.tabsTop >= kbTop - 1, `the tabs are under the keyboard, out of sight (${shown.tabsTop} >= ${kbTop})`);
    assert.ok(shown.fieldBottom <= kbTop + 1 && kbTop - shown.fieldBottom <= 24, `the box sits on the keyboard (${shown.fieldBottom} vs ${kbTop})`);
    assert.ok(shown.input >= 140, `the text keeps at least 140 px (${shown.input})`);
  } finally { await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
});

test('AC-21: the shell\'s words are French defaults the app overrides; 44 px targets on touch; a visible focus; tokens in light and dark', { skip, timeout: 120000 }, async () => {
  await open(1280, 'words=1');
  assert.equal(await actionName(), 'Parler', 'the app\'s word for Dicter');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]').getAttribute('aria-label')`), 'Le fil', 'the app\'s word for the chevron');
  // Focus by keyboard: the box draws a visible ring.
  const ring = () => browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=agent-composer-box]')).boxShadow`);
  const resting = await ring();
  await browser.evaluate(`document.querySelector('[data-testid=agent-bar-conversation]').focus()`);
  await browser.evaluate(`document.querySelector('[data-testid=composer-bar-attach]').focus()`);
  await browser.press('Tab');
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'composer-input', 'Tab reaches the field');
  assert.notEqual(await ring(), resting, `focus shows on the box (${resting} → ${await ring()})`);
  // Tokens: the box follows the theme in dark (no fixed colour).
  const colours = () => browser.evaluate(`[document.querySelector('[data-testid=agent-composer-box]'), document.querySelector('[data-testid=composer-input]')].map(e => getComputedStyle(e).backgroundColor + ' ' + getComputedStyle(e).color).join('|')`);
  const light = await colours();
  await open(1280, 'dark=1');
  assert.notEqual(await colours(), light, 'dark has its own colours');
  // Touch: every control of the phone's row and the drawer's header is at least 44 px.
  await open(390, 'tabs=1');
  await browser.evaluate(`window.__layer.open('agent', 'half')`);
  await wait(700);
  const small = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer-sheet] button')].filter(e => e.getClientRects().length > 0 && !e.closest('[data-testid=transcript]')).map(e => { const r = e.getBoundingClientRect(); return [e.dataset.testid || e.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44)`);
  assert.deepEqual(small, [], 'no control under 44 px on touch');
});

test('1280: « Discuter » on a task puts it as a mention chip in the one field and the message goes to the app\'s assistant; no second field (AC-22)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  assert.equal(await browser.evaluate(`window.__layer.talkAbout('@task:D-2219')`), true);
  await browser.until('task chip', `[...document.querySelectorAll('[data-testid=composer] [data-testid=mention-chip]')].some(e => e.dataset.path === 'task:D-2219')`);
  await oneField('talkAbout');
  assert.equal(await text('[data-testid=composer] [data-testid=mention-chip]'), 'D-2219', 'the chip names the task');
  assert.ok(!(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`)).includes('@task:'), 'no raw token in the field (no target in the field, D6)');
  await browser.screenshot('one-composer-1280-light-talk-about.png');
  await type('Relance-la');
  await click('[data-testid=composer-submit]');
  await browser.until('sent', `window.__sent.length === 1`);
  assert.ok((await browser.evaluate('window.__sent[0]')).includes('@task:D-2219'), `the message, with the task, goes to the one assistant (${await browser.evaluate('JSON.stringify(window.__sent)')})`);
  await browser.until('reply in the same thread', `!!document.querySelector('[data-testid=agent-tray]') && document.querySelector('[data-testid=agent-tray]').textContent.includes('Réponse fictive : noté.')`);
  await oneField('after the reply');
  assert.equal(await count('[data-testid=composer]'), 1, 'one composer, one conversation');
});

test('AppShell sidebar={false}: a single-screen app has no sidebar at any width, its title and account menu in one top bar, the content centred, with the one composer at the bottom centre (1440, 390)', { skip, timeout: 120000 }, async () => {
  const visible = selector => browser.evaluate(`[...document.querySelectorAll(${js(selector)})].filter(e => e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0).length`);
  for (const width of [1440, 390]) {
    await open(width, 'single=1');
    assert.equal(await visible('[data-slot=sidebar], [data-slot=sidebar-container], [data-slot=sidebar-gap], [data-testid=tabbar]'), 0, `${width}: no sidebar, no tabs`);
    const header = await rect('[data-testid=screen-header]');
    assert.ok(header && header.y <= 1 && header.h <= 64, `${width}: one slim bar at the top (${JSON.stringify(header)})`);
    assert.equal(await text('[data-testid=header-title]'), 'Compta fictive', `${width}: the app's title`);
    assert.equal(await inside('[data-testid=account-button]', '[data-testid=screen-header]'), true, `${width}: the account menu in the bar`);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=screen-header] button')].filter(e => e.getClientRects().length > 0).map(e => e.dataset.testid).filter(id => id !== 'account-button')`).then(ids => ids.length), 0, `${width}: nothing else in the bar (the field's chevron opens the conversation)`);
    await oneField(`single ${width}`);
    if (width === 1440) {
      const page = await rect('[data-testid=page]'), main = await rect('[data-boring=dock-main]'), box = await rect('[data-testid=agent-composer-box]');
      assert.ok(main.x <= 1 && main.w >= 1439, `the content column takes the whole width (${JSON.stringify(main)})`);
      assert.ok(Math.abs((page.x + page.w / 2) - 720) <= 2 && page.w <= 800, `the content is centred (${JSON.stringify(page)})`);
      assert.ok(Math.abs(box.w - 720) <= 1 && Math.abs((box.x + box.w / 2) - 720) <= 2, `the composer at the bottom centre, 720 px (${JSON.stringify(box)})`);
    } else {
      const field = await rect('[data-testid=composer]');
      assert.ok(844 - field.bottom < 40, `390: the field rests at the bottom (no tabs under it): ${field.bottom}`);
    }
    await browser.screenshot(`one-composer-${width}-light-single.png`);
  }
  // The default (no `sidebar` prop) keeps the sidebar.
  await open(1440);
  assert.ok(await visible('[data-slot=sidebar-container], [data-slot=sidebar]') > 0, 'default: the sidebar is there');
});

test('1440: the geometry: the field at most 720 px at the bottom centre, the page ends above it, the sidebar never moves; Ouvert ~30 %, Agrandir ~70 %; Ancré a ~380 px full-height column (AC-15, AC-16, AC-17)', { skip, timeout: 120000 }, async () => {
  await open(1440);
  const H = 800;
  const sidebar = async () => browser.evaluate(`(() => { const e = document.querySelector('[data-slot=sidebar-container]') ?? document.querySelector('[data-slot=sidebar]'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })()`);
  const rail = await sidebar();
  assert.ok(rail, 'the fixture has a sidebar to watch');
  // AC-15, at rest.
  const box = await rect('[data-testid=agent-composer-box]'), main = await rect('[data-boring=dock-main]'), page = await rect('[data-testid=agent-page]');
  assert.ok(Math.abs(box.w - 720) <= 1, `the field's box is 720 px wide on a wide column (${box.w})`);
  assert.ok(Math.abs((box.x + box.w / 2) - (main.x + main.w / 2)) <= 2, 'centred in the content column');
  assert.ok(main.bottom - box.bottom >= 0 && main.bottom - box.bottom < 24, `at the bottom (${main.bottom - box.bottom}px)`);
  assert.ok(page.bottom <= box.y + 1, `the page's scroll ends above the composer stack (${page.bottom} <= ${box.y})`);
  // AC-16: Ouvert, one box at the field's width; the thread about 30 % of the height, Agrandir 70 %; the page shrinks above it.
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await wait(200);
  let tray = await rect('[data-testid=agent-tray]'), openBox = await rect('[data-testid=agent-composer-box]'), openPage = await rect('[data-testid=agent-page]');
  assert.ok(Math.abs(tray.h - 0.3 * H) <= 0.03 * H, `Ouvert: the thread takes ~30 % (${tray.h}px of ${H})`);
  assert.ok(Math.abs(openBox.w - 720) <= 1 && Math.abs(openBox.x - box.x) <= 1, 'the open box keeps the field\'s width and place');
  assert.ok(openPage.bottom <= openBox.y + 1 && openPage.h > 0, 'the page shrinks above the box, never under it');
  assert.deepEqual(await sidebar(), rail, 'the sidebar did not move (Ouvert)');
  await click('[data-testid=agent-tray-grow]');
  await wait(200);
  tray = await rect('[data-testid=agent-tray]'); openPage = await rect('[data-testid=agent-page]');
  assert.ok(Math.abs(tray.h - 0.7 * H) <= 0.03 * H, `Agrandir: ~70 % (${tray.h}px of ${H})`);
  assert.ok(openPage.h > 0 && openPage.bottom <= (await rect('[data-testid=agent-composer-box]')).y + 1, 'the page still shows above, never covered');
  await browser.screenshot('one-composer-1440-light-agrandir.png');
  // AC-17: Ancré, a full-height right column of about 380 px with the thread and the field; nothing at the bottom.
  await click('[data-testid=agent-tray-dock]');
  await browser.until('Ancré', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await wait(300);
  const column = await rect('[data-testid=agent-layer]');
  assert.ok(Math.abs(column.w - 380) <= 20, `the docked column is ~380 px (${column.w})`);
  assert.ok(column.h >= H - 2 && column.right >= 1440 - 1, `full height, at the right edge (${JSON.stringify(column)})`);
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-boring=dock-main] [data-testid=agent-composer-box]')].filter(e => e.getClientRects().length > 0).length`), 0, 'nothing stays at the bottom, not even an empty frame');
  assert.deepEqual(await sidebar(), rail, 'the sidebar did not move (Ancré)');
  await browser.screenshot('one-composer-1440-light-ancre.png');
});

// Kit 0.4.85 (Coach Max on a phone). K-1..K-6. The shots (`kit-*`) are the before/after pictures of the phone.
const touch = (type, x, y) => browser.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const pageVisible = () => browser.evaluate(`(() => { const e = document.querySelector('[data-testid=page]'); const r = e.getBoundingClientRect(); const probe = document.elementFromPoint(r.x + 24, r.y + 24); return { height: r.height, top: r.y, covered: !probe || !e.contains(probe) }; })()`);

test('K-1, 390: typing in the folded field never opens the conversation: the field stays above the keyboard, the page stays visible, only the chevron opens it (AC-25)', { skip, timeout: 120000 }, async () => {
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: KEYBOARD });
  try {
    await open(390, 'single=1&kb=1');
    await browser.screenshot('kit-390-1-rest.png');
    const [x, y] = await center('[data-testid=composer-input]');
    await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
    await browser.until('focused', `document.activeElement?.dataset.testid === 'composer-input'`);
    await browser.evaluate('window.__keyboard(320)');
    await wait(800);
    await type('Deux oeufs et un café');
    await wait(500);
    await browser.screenshot('kit-390-2-focused-keyboard.png');
    assert.equal(await dockState(), 'peek', 'the field is focused and the bar is still folded');
    assert.equal(await count('[data-testid=agent-tray]'), 0);
    const shown = await pageVisible();
    assert.ok(shown.height >= 300 && !shown.covered, `the page stays visible behind the field (${JSON.stringify(shown)})`);
    const field = await rect('[data-testid=composer]');
    assert.ok(field.bottom <= 844 - 320 + 1 && 844 - 320 - field.bottom <= 24, `the field sits on the keyboard (${field.bottom})`);
    await oneField('typing');
    await click('[data-testid=composer-submit]');
    await browser.until('working card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
    await browser.until('reply card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
    assert.equal(await dockState(), 'peek', 'a send leaves it folded');
    await click('[data-testid=agent-bar-conversation]');
    await browser.until('chevron opens', `['half', 'full'].includes(document.querySelector('[data-testid=agent-layer]')?.dataset.state)`);
  } finally { await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
});

test('K-2, 390: one field in every dictation state: it stays in the DOM while listening, while held and when the words arrive (AC-1)', { skip, timeout: 120000 }, async () => {
  await open(390, 'single=1');
  await oneField('rest');
  let [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
  await browser.until('listening', `!!document.querySelector('[data-testid=agent-talk-listening]')`);
  await browser.screenshot('kit-390-3-dictating.png');
  await oneField('listening');
  await click('[data-testid=agent-talk-stop]');
  await browser.until('words in the field', `document.querySelector('[data-testid=composer-input]')?.value === 'Texte dicté fictif'`);
  await oneField('words');
  await browser.evaluate(`window.__setText('')`);
  [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y);
  await browser.until('holding', `!!document.querySelector('[data-testid=agent-talk-release]')`);
  await oneField('holding');
  await mouse('mouseReleased', x, y);
  await browser.until('sent', `window.__sent.length === 1`);
  await oneField('sent');
});

test('K-3, 390: the folded reply card carries one app action (agent.replyAction) and a tap on the reply opens the conversation', { skip, timeout: 120000 }, async () => {
  await open(390, 'single=1&action=1');
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('working', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  await browser.evaluate(`window.__run('reply')`);
  await browser.until('reply card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
  await wait(700);
  await browser.screenshot('kit-390-4-reply-action.png');
  const onCard = await rect('[data-testid=agent-card]'), onField = await rect('[data-testid=composer]');
  assert.ok(onField.bottom <= 844 + 1 && onCard.bottom <= onField.y + 1, `the card and the whole field are in view, the card right above the field (${onCard.bottom} → ${onField.y}..${onField.bottom})`);
  assert.equal(await text('[data-testid=agent-card-action]'), 'Annuler', 'the app\'s action, on the card');
  assert.equal(await inside('[data-testid=agent-card-action]', '[data-testid=agent-card]'), true);
  const action = await rect('[data-testid=agent-card-action]');
  assert.ok(action.h >= 44, `a 44 px target on touch (${action.h})`);
  await click('[data-testid=agent-card-action]');
  assert.equal(await browser.evaluate('window.__undone'), 1);
  assert.equal(await dockState(), 'peek', 'the action does not open the conversation');
  await click('[data-testid=agent-card-reply]');
  await browser.until('the reply opens it', `['half', 'full'].includes(document.querySelector('[data-testid=agent-layer]')?.dataset.state)`);
  await open(390, 'single=1');
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('working', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  await browser.evaluate(`window.__run('reply')`);
  await browser.until('reply card', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'reply'`);
  assert.equal(await count('[data-testid=agent-card-action]'), 0, 'no action unless the app gave one');
});

test('K-4, 390: the folded working card shows the app\'s words per phase (agent.workingWords); without them it says what the tool does, then « En cours »', { skip, timeout: 120000 }, async () => {
  await open(390, 'single=1&status=1');
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('working', `document.querySelector('[data-testid=agent-card]')?.dataset.state === 'working'`);
  await wait(700);
  await browser.screenshot('kit-390-5-working.png');
  assert.ok((await rect('[data-testid=composer]')).bottom <= 844 + 1, 'the whole field stays in view under the working card');
  assert.equal(await text('[data-testid=agent-card-status]'), 'Max compte…', 'a tool runs: the app\'s words for it');
  await browser.evaluate(`window.__run('think')`);
  await browser.until('thinking', `document.querySelector('[data-testid=agent-card-status]')?.textContent === 'Max réfléchit…'`);
  await open(390, 'single=1');
  await browser.evaluate(`window.__run('tool')`);
  await browser.until('default', `document.querySelector('[data-testid=agent-card-status]')?.textContent.includes('releve-janvier.pdf')`);
  await browser.evaluate(`window.__run('think')`);
  await browser.until('default words', `document.querySelector('[data-testid=agent-card-status]')?.textContent === 'En cours'`);
});

test('K-5, 390: every default word of the composer is overridable through agent.words, the empty conversation included (« tu »)', { skip, timeout: 120000 }, async () => {
  await open(390, 'single=1&tu=1&empty=1');
  await oneField('empty');
  const words = () => browser.evaluate(`(() => { const label = s => document.querySelector(s)?.getAttribute('aria-label'); return {
    placeholder: document.querySelector('[data-testid=composer-input]').placeholder, chevron: label('[data-testid=agent-bar-conversation]'), attach: label('[data-testid=composer-bar-attach]'), dictate: label('[data-testid=agent-talk]') }; })()`);
  assert.deepEqual(await words(), { placeholder: 'Dis-moi ce que tu as mangé', chevron: 'Ton fil', attach: 'Joins un fichier', dictate: 'Dicte' });
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('empty state', `!!document.querySelector('[data-testid=empty-state]')`);
  await browser.screenshot('kit-390-6-empty-tu.png');
  assert.equal(await text('[data-testid=empty-state]'), 'Parle-moi' + 'Dis-moi ce que tu as mangé.', 'the empty conversation in « tu »');
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('folded', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'peek'`);
  await type('Un yaourt');
  assert.equal(await actionName(), 'Envoie');
  await browser.evaluate(`window.__failNext = true`);
  await click('[data-testid=composer-submit]');
  await browser.until('failed', `!!document.querySelector('[data-testid=agent-send-problem]')`);
  assert.equal(await text('[data-testid=agent-send-problem] span'), 'Ton message n’est pas parti : il est revenu dans le champ.');
  assert.equal(await text('[data-testid=agent-send-retry]'), 'Réessaie');
  await browser.evaluate(`window.__setText('')`);
  await wait(600);
  const [x, y] = await center('[data-testid=agent-talk]');
  await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
  await browser.until('listening', `!!document.querySelector('[data-testid=agent-talk-listening]')`);
  assert.equal(await text('[data-testid=agent-talk-listening]'), 'Je t’écoute…');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-talk-stop]').getAttribute('aria-label') + '|' + document.querySelector('[data-testid=agent-talk-cancel]').getAttribute('aria-label')`), 'Arrête de m’écouter|Annule');
});

test('K-6, 390 touch: the first press-and-hold on Dicter in a session sends on release, like the next ones, even when the first open of the microphone is slower than the hold', { skip, timeout: 120000 }, async () => {
  await open(390, 'single=1&slowmic=1');
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    for (const round of [1, 2]) {
      const [x, y] = await center('[data-testid=agent-talk]');
      await touch('touchStart', x, y);
      await browser.until(`holding ${round}`, `!!document.querySelector('[data-testid=agent-talk-release]')`);
      if (round === 1) await browser.screenshot('kit-390-3b-hold.png');
      await touch('touchEnd', x, y);
      await browser.until(`hold ${round} sent`, `window.__sent.length === ${round}`);
      await browser.until(`rest ${round}`, `document.querySelector('[data-testid=agent-talk]')?.dataset.state === 'idle'`);
      await wait(900);
    }
  } finally { await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
});


test('1280, pane review: preview keeps one identity, an update of the top never moves focus, Échap acts only from the pane or with nothing focused, a stray listbox does not hold the tray open', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await browser.evaluate(`window.__preview = window.__layer.preview`);
  await browser.evaluate(`window.__openFile('uploads/ecarts-janvier.csv')`);
  await browser.until('preview', `!!document.querySelector('[data-testid=agent-preview] [data-testid=fixture-preview]')`);
  await browser.evaluate(`window.__openFile('uploads/releve-fevrier.pdf')`);
  await browser.until('second entry', `document.querySelector('[data-testid=agent-preview]')?.dataset.depth === '2'`);
  assert.equal(await browser.evaluate(`window.__layer.preview === window.__preview`), true, 'preview keeps its identity across pushes');
  await wait(300);
  await browser.evaluate(`document.querySelector('[data-testid=composer-input]').focus()`);
  await browser.evaluate(`window.__openFile('uploads/releve-fevrier.pdf')`);
  await wait(500);
  assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), 'composer-input', 'an app updating its top view leaves focus on the field');
  assert.equal(await browser.evaluate(`window.__layer.preview === window.__preview`), true, 'and after a replace');
  await browser.evaluate(`(() => { const input = document.createElement('input'); input.id = 'outside'; document.body.append(input); input.focus(); })()`);
  await browser.press('Escape');
  await wait(400);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-preview]')?.dataset.depth`), '2', 'Échap in a field outside the pane keeps the pane');
  await browser.evaluate(`document.activeElement.blur()`);
  await browser.press('Escape');
  await browser.until('Échap with nothing focused steps back', `document.querySelector('[data-testid=agent-preview]')?.dataset.depth === '1'`);
  await browser.evaluate(`window.__layer.preview(null)`);
  await browser.until('closed', `!document.querySelector('[data-testid=agent-preview]')`);
  await browser.evaluate(`window.__layer.open('agent')`);
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=agent-tray-dock]');
  await browser.until('Ancré', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'open'`);
  await browser.evaluate(`(() => { const list = document.createElement('div'); list.setAttribute('role', 'listbox'); document.body.append(list); document.activeElement.blur(); })()`);
  await browser.press('Escape');
  await browser.until('the dock closes by Escape although a listbox sits on the page', `document.querySelector('[data-testid=agent-layer]')?.dataset.state !== 'open'`);
});

// Defaults every app gets from the bar, held through the interface: a phone keeps its camera, its multi-line Enter, and the app's own colours.
test('390 touch, camera: an app that gives the camera sheet reaches Take a photo from the bar\'s « + » menu', { skip, timeout: 120000 }, async () => {
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
  await open(390, 'camera=1');
  await browser.until('the plus', `!!document.querySelector('[data-testid=composer-plus]')`);
  await click('[data-testid=composer-plus]');
  await browser.until('the menu', `!!document.querySelector('[data-testid=composer-take-photo]')`);
  await click('[data-testid=composer-take-photo]');
  await browser.until('the camera sheet', `!!document.querySelector('[data-testid=fixture-camera]')`);
  } finally { await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
});

test('390 touch: Enter in the field inserts a new line and sends nothing', { skip, timeout: 120000 }, async () => {
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
  await open(390);
  assert.equal(await browser.evaluate(`matchMedia('(pointer: coarse)').matches`), true, 'the phone emulation reports a touch pointer');
  await type('première ligne');
  await browser.press('Enter');
  await type('seconde ligne');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`), 'première ligne\nseconde ligne');
  assert.equal(await browser.evaluate(`(window.__sent ?? []).length`), 0, 'Enter sent nothing');
  } finally { await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
});

test('1280: the send button takes the app\'s primary colour pairing, not the shell\'s own accent', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await type('Bonjour');
  const colours = await browser.evaluate(`(() => { const probe = document.createElement('button'); probe.className = 'bg-primary text-primary-foreground'; document.body.append(probe);
    const want = getComputedStyle(probe), send = getComputedStyle(document.querySelector('[data-testid=composer-submit]'));
    const out = { want: [want.backgroundColor, want.color], got: [send.backgroundColor, send.color] }; probe.remove(); return out; })()`);
  assert.deepEqual(colours.got, colours.want);
});

// `chatProps.enterSends` (kit 0.5): the shell's one composer keeps Enter = a new line on a touch device unless the app asks `'always'`.
// The composer is the same PiChat in the bar's pill row (peek, Ouvert) and in the content composer's card; the touch case needs a real `(pointer: coarse)`.
const imeEnter = init => browser.evaluate(`(() => { const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...${js(init)} }); document.querySelector('[data-testid=composer-input]').dispatchEvent(e); return e.defaultPrevented; })()`);
const fieldText = () => browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`);
const sentCount = () => browser.evaluate('window.__sent.length');
const pointerCoarse = () => browser.evaluate(`matchMedia('(pointer: coarse)').matches`);
const withTouch = async run => {
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try { await run(); } finally { await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
};

test('390 touch, default: Enter adds a line and only Send sends, in the pill row', { skip, timeout: 120000 }, async () => {
  await open(390, 'tabs=1');
  await withTouch(async () => {
    assert.equal(await pointerCoarse(), true, 'the page reports a touch device');
    await type('Première ligne');
    await browser.press('Enter');
    await wait(250);
    assert.equal(await sentCount(), 0, 'Enter sent nothing');
    assert.equal(await fieldText(), 'Première ligne\n', 'Enter added a line');
    await click('[data-testid=composer-submit]');
    await browser.until('Send sent it', `window.__sent.length === 1`);
  });
});

test('390 touch, enterSends="always": Enter sends from the pill row at rest and open; Shift+Enter adds a line; an IME Enter never sends', { skip, timeout: 120000 }, async () => {
  await open(390, 'tabs=1&enter=always');
  await withTouch(async () => {
    assert.equal(await pointerCoarse(), true, 'the page reports a touch device');
    assert.equal(await dockState(), 'peek', 'the phone drawer at rest');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer]').dataset.layout`), 'pill');
    await type('Première ligne');
    await browser.press('Enter', { shift: true });
    await browser.send('Input.insertText', { text: 'Seconde ligne' });
    await wait(250);
    assert.equal(await sentCount(), 0, 'Shift+Enter sent nothing');
    assert.equal(await fieldText(), 'Première ligne\nSeconde ligne', 'Shift+Enter added a line');
    assert.equal(await imeEnter({ isComposing: true }), false, 'a composing Enter is left to the input method');
    assert.equal(await imeEnter({ keyCode: 229 }), false, 'a keyCode 229 Enter is left to the input method');
    assert.equal(await sentCount(), 0, 'an IME Enter sent nothing');
    await browser.press('Enter');
    await browser.until('Enter sent it', `window.__sent.length === 1`);
    assert.deepEqual(await browser.evaluate('window.__sent'), ['Première ligne\nSeconde ligne']);
    assert.equal(await fieldText(), '', 'the field is empty after the send');
    // The same field in the open drawer (half).
    await click('[data-testid=agent-bar-conversation]');
    await browser.until('Ouvert: half', `document.querySelector('[data-testid=agent-layer]')?.dataset.state === 'half'`);
    await wait(700);
    await oneField('phone, Ouvert');
    await type('Dans le tiroir ouvert');
    await browser.press('Enter');
    await browser.until('Enter sent it in the open drawer', `window.__sent.length === 2`);
    assert.equal((await browser.evaluate('window.__sent'))[1], 'Dans le tiroir ouvert');
  });
});

test('390 touch, enterSends="always" in the content composer (the two-row card): Enter sends, and without the option it adds a line', { skip, timeout: 120000 }, async () => {
  await open(390, 'composer=content&enter=always');
  await withTouch(async () => {
    assert.equal(await pointerCoarse(), true);
    await browser.evaluate(`window.__layer.open('agent', 'half')`);
    await browser.until('the drawer\'s field', `!!document.querySelector('[data-testid=composer-input]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer]').dataset.layout`), 'card');
    await type('Un message court');
    await browser.press('Enter');
    await browser.until('Enter sent it', `window.__sent.length === 1`);
    assert.equal((await browser.evaluate('window.__sent'))[0], 'Un message court');
  });
  await open(390, 'composer=content');
  await withTouch(async () => {
    await browser.evaluate(`window.__layer.open('agent', 'half')`);
    await browser.until('the drawer\'s field', `!!document.querySelector('[data-testid=composer-input]')`);
    await type('Un message court');
    await browser.press('Enter');
    await wait(250);
    assert.equal(await sentCount(), 0, 'default: Enter did not send on a touch device');
    assert.equal(await fieldText(), 'Un message court\n');
  });
});

test('1280 fine pointer: Enter sends by default and with enterSends="always"; Shift+Enter adds a line either way', { skip, timeout: 120000 }, async () => {
  for (const query of ['', 'enter=always']) {
    await open(1280, query);
    assert.equal(await pointerCoarse(), false, 'a fine pointer');
    await type('Première ligne');
    await browser.press('Enter', { shift: true });
    await browser.send('Input.insertText', { text: 'Seconde ligne' });
    await wait(250);
    assert.equal(await sentCount(), 0, `${query || 'default'}: Shift+Enter sent nothing`);
    assert.equal(await fieldText(), 'Première ligne\nSeconde ligne');
    assert.equal(await imeEnter({ isComposing: true }), false);
    assert.equal(await imeEnter({ keyCode: 229 }), false);
    assert.equal(await sentCount(), 0, `${query || 'default'}: an IME Enter sent nothing`);
    await browser.press('Enter');
    await browser.until(`${query || 'default'}: Enter sent it`, `window.__sent.length === 1`);
    assert.equal((await browser.evaluate('window.__sent'))[0], 'Première ligne\nSeconde ligne');
  }
});

// Julien: the expand control has two levels, bigger (the tray, then Expand) and a true full screen over the nav and the right pane, with a way back.
const viewportOf = () => browser.evaluate('({ w: innerWidth, h: innerHeight })');
const focusedId = () => browser.evaluate(`document.activeElement?.dataset.testid ?? null`);
const FULL = '[data-testid=agent-full]';

test('1440: Expand goes to grown, Full fills the main area while the left nav and the right pane stay beside it, Esc goes back to grown with focus on the opener, what is covered is inert', { skip, timeout: 180000 }, async () => {
  for (const dark of [false, true]) {
    await open(1440);
    if (dark) await browser.evaluate(`document.documentElement.classList.add('dark')`);
    const view = await viewportOf();
    await browser.evaluate(`window.__openFile('uploads/ecarts-janvier.csv')`);
    await browser.until('the right pane', `!!document.querySelector('[data-testid=agent-preview]')`);
    await click('[data-testid=agent-bar-conversation]');
    await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
    assert.equal(await count('[data-testid=agent-tray-full]'), 1, 'the controller offers Full from the half-open tray (and Expand more)');
    await click('[data-testid=agent-tray-grow]');
    await wait(250);
    assert.equal(await count(FULL), 0, 'Expand is not full screen');
    assert.equal(await count('[data-testid=agent-tray-full]'), 1, 'Expand offers Full');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-tray-full]').getAttribute('aria-label')`), 'Plein écran');
    await browser.evaluate(`document.querySelector('[data-testid=agent-tray-full]').focus()`);
    await browser.screenshot(`full-1440-${dark ? 'dark' : 'light'}-before.png`);
    await click('[data-testid=agent-tray-full]');
    await browser.until('full', `!!document.querySelector('${FULL}')`);
    await wait(250);
    const full = await rect(FULL), main = await rect('[data-boring=dock-main]');
    assert.ok(Math.abs(full.x - main.x) <= 1 && Math.abs(full.y - main.y) <= 1 && Math.abs(full.w - main.w) <= 1 && Math.abs(full.h - main.h) <= 1, `the full host is the main area (${JSON.stringify(full)} vs ${JSON.stringify(main)})`);
    assert.equal(await browser.evaluate(`document.querySelector('${FULL}').parentElement === document.body`), true, 'portalled to the body');
    const paneHit = await browser.evaluate(`(() => { const r = document.querySelector('[data-testid=agent-preview]').getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + 100); return !!top && document.querySelector('[data-testid=agent-preview]').contains(top); })()`);
    assert.equal(paneHit, true, 'the right pane stays on top beside the conversation');
    const navHit = await browser.evaluate(`(() => { const e = document.querySelector('[data-slot=sidebar-container]'); if (!e) return 'none'; const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 200)); return !!top && e.contains(top) && !top.closest('[inert]') ? 'live' : 'blocked'; })()`);
    assert.ok(['live', 'none'].includes(navHit), 'the left navigation stays visible and live');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-preview]').closest('[inert]') === null`), true, 'the right pane is live');
    for (const covered of ['[data-boring=dock-main] [data-testid=agent-page]']) {
      const hit = await browser.evaluate(`(() => { const e = document.querySelector(${js(covered)}); if (!e) return 'none'; const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 200)); return top && document.querySelector('${FULL}').contains(top) ? 'covered' : 'exposed'; })()`);
      assert.notEqual(hit, 'exposed', `${covered} is under the full screen`);
    }
    assert.equal(await inside('[data-testid=transcript]', FULL), true, 'the thread is in the full host');
    assert.equal(await inside(FIELD, FULL), true, 'the one composer is in the full host');
    await oneField('full');
    assert.equal(await browser.evaluate(`document.querySelector('[data-boring=dock-main]').inert`), true, 'the page behind the conversation is inert');
    assert.equal(await browser.evaluate(`document.querySelector('[data-boring=dock-main]').getAttribute('aria-hidden')`), 'true');
    assert.equal(await browser.evaluate(`getComputedStyle(document.body).overflow`), 'hidden', 'the page does not scroll');
    assert.equal(await browser.evaluate(`document.querySelectorAll('${FULL} [data-testid=agent-layer-header] button[aria-label="Fermer"]').length`), 1, 'full screen has a Close (to the bar); the chevron is the way back to the tray');
    assert.equal(await browser.evaluate(`document.querySelector('${FULL} [data-testid=agent-full-back]').getAttribute('aria-label')`), 'Quitter le plein écran');
    assert.equal(await browser.evaluate(`document.querySelector('${FULL} [data-testid=agent-full-back]').textContent.trim()`), '', 'the back chevron is an icon only');
    await browser.screenshot(`full-1440-${dark ? 'dark' : 'light'}-after.png`);
    // The composer inside keeps working.
    const sent = (await browser.evaluate('window.__sent')).length;
    await type('Dans le plein écran');
    await click('[data-testid=composer-submit]');
    await browser.until('sent from full', `window.__sent.length === ${sent + 1}`);
    await browser.until('answer in the full thread', `document.querySelector('${FULL} [data-testid=transcript]')?.textContent.includes('Dans le plein écran') && document.querySelector('${FULL} [data-testid=transcript]').textContent.includes('Réponse fictive')`);
    // Esc goes back to grown, not closed.
    await browser.press('Escape');
    await browser.until('back to grown', `!document.querySelector('${FULL}')`);
    await wait(300);
    assert.equal(await count('[data-testid=agent-tray]'), 1, 'the tray is still there');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-tray]').dataset.expanded`), 'true', 'grown');
    assert.equal(await inside('[data-testid=transcript]', '[data-testid=agent-tray]'), true, 'the thread went back to the tray');
    assert.equal(await focusedId(), 'agent-tray-full', 'focus is on the opener');
    assert.equal(await browser.evaluate(`document.querySelector('[data-boring=dock-main]').inert`), false, 'the page is live again');
    assert.notEqual(await browser.evaluate(`getComputedStyle(document.body).overflow`), 'hidden');
    // The back arrow does the same, Close shuts the conversation.
    await click('[data-testid=agent-tray-full]');
    await browser.until('full again', `!!document.querySelector('${FULL}')`);
    await click(`${FULL} [data-testid=agent-full-back]`);
    await browser.until('grown again', `!document.querySelector('${FULL}')`);
    await click('[data-testid=agent-tray-full]');
    await browser.until('full a third time', `!!document.querySelector('${FULL}')`);
    await click(`${FULL} [data-testid=agent-full-back]`);
    await browser.until('grown', `!document.querySelector('${FULL}')`);
    await click('[data-testid=agent-tray-reduce]');
    await browser.until('closed', `!document.querySelector('${FULL}') && !document.querySelector('[data-testid=agent-tray]')`);
    await browser.until('focus is back on the field', `document.activeElement?.dataset.testid === 'composer-input'`);
    assert.equal(await focusedId(), 'composer-input', 'the chevron\'s collapse returns to the field');
    await oneField('closed');
  }
});

test('1440: Esc in full keeps its menus: an open menu keeps the key', { skip, timeout: 120000 }, async () => {
  await open(1440);
  await click('[data-testid=agent-bar-conversation]');
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await click('[data-testid=agent-tray-grow]');
  await click('[data-testid=agent-tray-full]');
  await browser.until('full', `!!document.querySelector('${FULL}')`);
  await browser.evaluate(`(() => { const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.id = 'fake-menu'; document.body.append(menu); })()`);
  await browser.press('Escape');
  await wait(300);
  assert.equal(await count(FULL), 1, 'an open menu keeps Esc');
});

test('390: the phone\'s full snap is the same state: it covers the tab bar, one composer, the grabber goes back', { skip, timeout: 120000 }, async () => {
  await open(390);
  await browser.evaluate(`window.__layer.open('agent', 'half')`);
  await browser.until('the drawer', `!!document.querySelector('[data-testid=composer-input]')`);
  const tap = async () => { const [x, y] = await center('[data-slot=drawer-swipe-handle]'); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(900); };
  await tap();
  await browser.screenshot('full-390-full-snap.png');
  const view = await viewportOf();
  const sheet = await rect('[data-testid=agent-layer]');
  assert.ok(sheet.y <= 1 && sheet.bottom >= view.h - 1, `the full snap covers the viewport (${JSON.stringify(sheet)})`);
  assert.equal(await count('[data-testid=agent-full]'), 0, 'no second full-screen host on a phone');
  await oneField('phone full');
  await tap();
  const back = await rect('[data-testid=agent-layer]');
  assert.ok(back.h < sheet.h, 'a tap on the grabber goes back down');
});
