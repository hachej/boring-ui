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
  await browser.until('Ouvert', `!!document.querySelector('[data-testid=agent-tray]')`);
  await browser.until('reply in the thread', `document.querySelector('[data-testid=agent-tray]').textContent.includes('Réponse fictive : noté.')`);
  assert.deepEqual(await browser.evaluate('window.__sent'), ['Combien de pièces manquent ?']);
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
  const row = await rect('[data-testid=agent-composer-box] [data-slot=input-group]'), chevron = await rect('[data-testid=agent-bar-conversation]');
  assert.ok(row.h >= 55 && chevron.x - row.x >= 6, `the row breathes: room inside the box (${row.h}px high, ${chevron.x - row.x}px before the chevron)`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=agent-tray] [data-testid=agent-layer-library]').textContent.trim()`), '', '« Bibliothèque » is an icon (its name is the label)');
  assert.equal(await browser.evaluate(`(() => { const b = document.querySelector('[data-testid=agent-bar-conversation]'); const r = parseFloat(getComputedStyle(b).borderTopLeftRadius); return r >= b.getBoundingClientRect().height / 2 - 1; })()`), true, 'round buttons in the row, as the agent bar (Julien)');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=agent-composer-box]')).backgroundColor === getComputedStyle(document.querySelector('[data-slot=sidebar-inset]')).backgroundColor && getComputedStyle(document.querySelector('[data-testid=agent-composer-box] [data-boring=pi-chat-composer]')).backgroundColor === getComputedStyle(document.querySelector('[data-slot=sidebar-inset]')).backgroundColor && getComputedStyle(document.querySelector('[data-testid=agent-composer-box]').parentElement).backgroundColor === getComputedStyle(document.querySelector('[data-slot=sidebar-inset]')).backgroundColor`), true, 'the box, the field and the strip around them take the main view\'s colour (Julien, demo review)');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=composer-bar-attach]')).borderTopWidth === '0px' || getComputedStyle(document.querySelector('[data-testid=composer-bar-attach]')).borderTopColor.includes('0, 0, 0, 0')`), true, 'the attach button has no border in the one composer');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=agent-composer-box] [data-slot=input-group]')).borderTopColor.includes('0, 0, 0, 0') || getComputedStyle(document.querySelector('[data-testid=agent-composer-box] [data-slot=input-group]')).borderTopColor === 'transparent'`), true, 'one frame: the input group draws no border of its own inside the box');
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

test('1280: typing keeps the buttons on the last line; a file is a name-only chip; « / » is filtered by the field; a question asks in the box (AC-4, AC-5, AC-6, AC-8)', { skip, timeout: 120000 }, async () => {
  await open(1280);
  await type('Prépare la relance du dossier Cèdre :');
  for (const line of ['– les deux relevés de février', '– la facture du loyer']) { await browser.press('Enter', { shift: true }); await browser.send('Input.insertText', { text: line }); }
  await wait(150);
  const input = await rect(FIELD), send = await rect('[data-testid=composer-submit]');
  assert.ok(input.h > 40, `the field grew (${input.h}px)`);
  assert.ok(Math.abs(send.bottom - input.bottom) <= 8, `the action button sits on the last line (${send.bottom} vs ${input.bottom})`);
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
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer] [data-testid=conversation-content]')].every(e => e.getClientRects().length === 0)`), true, 'the thread waits under the preview');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer] [data-testid=conversation-files], [data-testid=agent-layer] [data-testid=preparing]')].filter(e => e.getClientRects().length > 0).length`), 0, 'under the file only the field: no files button, no status line (Julien, demo review)');
  assert.ok((await text('[data-testid=agent-preview-title]')).includes('ecarts-janvier.csv'));
  assert.equal(await count('[data-testid=agent-layer-header] [data-testid=agent-preview-back]'), 1, 'one header: « ← <file> » is the dock\'s own title row');
  assert.equal(await count('[data-testid=agent-layer-header] [data-testid=agent-layer-title]'), 0, 'no second title row above the file');
  await click('[data-testid=agent-layer-header] [data-testid=agent-layer-library]');
  await browser.until('library over the docked chat', `!!document.querySelector('[data-testid=agent-layer] [data-testid=fixture-library]')`);
  assert.equal(await text('[data-testid=agent-layer-header] [data-testid=agent-preview-title]'), 'Bibliothèque', 'the library takes the dock\'s header, « ← Bibliothèque »');
  await browser.evaluate(`document.querySelector('[data-testid=agent-layer] [data-testid=fixture-library-file][data-path="uploads/releve-janvier.pdf"]').click()`);
  await browser.until('picked file over the docked chat', `(document.querySelector('[data-testid=agent-layer-header] [data-testid=agent-preview-title]')?.textContent ?? '').includes('releve-janvier.pdf')`);
  await browser.screenshot('one-composer-1280-light-preview-docked.png');
  await click('[data-testid=agent-preview-back]');
  await browser.until('back to the thread', `!document.querySelector('[data-testid=agent-preview]')`);
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer] [data-testid=conversation-content]')].some(e => e.getClientRects().length > 0)`), true, 'the thread is back');
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
  // At rest on a phone the field comes with the drawer (its place above the tabs is slice 2, AC-20): open it at peek first.
  await browser.evaluate(`window.__layer.open('agent', 'peek')`);
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
