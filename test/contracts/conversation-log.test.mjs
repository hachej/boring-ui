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

// D-1978 part 3: the conversation log sheet. A real Chromium mounts the public `agent-bar` and `conversation-log` blocks (test/fixtures/themes/conversation-log.jsx) at 390 touch
// and 1280 fine, light and dark, and drives the bar's history arrow with real input. Shots go to .cache/evidence/conversation-log (or EVIDENCE_DIR), uploaded by CI
// as `conversation-log-shots`. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.EVIDENCE_DIR ?? join(root, '.cache/evidence/conversation-log');

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
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/conversation-log.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'agent-bar', 'conversation-log'].map(name => registryCss(item(name))).join('\n')}`;
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
const typeInto = async text => {
  await browser.click(`document.querySelector('[data-testid=agent-bar-input]')`);
  await browser.send('Input.insertText', { text });
};


const sheet = `document.querySelector('[data-slot=drawer-popup]')`;
const focused = `(document.activeElement?.dataset?.testid ?? document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)`;

for (const [width, theme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
  test(`the day log sheet opens from the bar's arrow and closes back to it (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    const at = `${width}-${theme}`;
    const floor = width === 390 ? 44 : 36;
    await open(width, theme);
    assert.equal(await browser.evaluate(`!${sheet}`), true, 'closed at first');

    // The arrow opens it: titled sheet, the bar stays visible under it, the arrow flips, focus is inside the sheet.
    await press('Historique');
    await browser.until('sheet open', `!!${sheet} && ${label('Historique')}.getAttribute('aria-expanded') === 'true'`);
    await wait(700);
    assert.equal(await browser.evaluate(`${sheet}.textContent.includes('Avec Max · aujourd’hui')`), true, 'the sheet is titled');
    assert.equal(await browser.evaluate(`!!${sheet}.closest('[role=dialog]') || ${sheet}.getAttribute('role') === 'dialog'`), true, 'the sheet is a dialog');
    assert.equal(await browser.evaluate(`${sheet}.contains(document.activeElement)`), true, 'focus moved into the sheet');
    assert.equal(await browser.evaluate(focused), 'conversation-log-close');
    const popup = await rectOf(sheet), bar = await rectOf(`document.querySelector('[data-testid=agent-bar]')`);
    assert.equal(popup.y + popup.h <= bar.y + 1, true, `the bar stays under the sheet: sheet ends at ${popup.y + popup.h}, bar starts at ${bar.y}`);
    assert.equal(popup.y >= 40 && popup.y <= 90, true, `the day header stays above the sheet: ${popup.y}`);
    const arrow = await rectOf(label('Historique'));
    assert.equal(await browser.evaluate(`document.elementFromPoint(${arrow.x + arrow.w / 2}, ${arrow.y + arrow.h / 2}) === ${label('Historique')}`), true, 'nothing covers the arrow');
    for (const name of ['Parler']) { const r = await rectOf(label(name)); assert.equal(await browser.evaluate(`document.elementFromPoint(${r.x + r.w / 2}, ${r.y + r.h / 2}) === ${label(name)} || ${label(name)}.contains(document.elementFromPoint(${r.x + r.w / 2}, ${r.y + r.h / 2}))`), true, `nothing covers ${name} (the sheet's bleed stays off the bar)`); }
    const close = await rectOf(label('Fermer l’historique'));
    assert.equal(close.w >= floor && close.h >= floor, true, `the close button is ${close.w}x${close.h}`);

    // The entries: times, bubbles, status lines with their check chips, the question and its answer, the suggestions and their buttons.
    const text = await browser.evaluate(`document.querySelector('[data-testid=agent-log]').textContent`);
    for (const expected of ['08:10', '« Flocons d’avoine 60 g, du lait et une banane »', 'Petit-déjeuner · 420 kcal', 'Vérifié', 'Goûter noté · tarte en cours', 'D’où vient la tarte ? Boulangerie', 'Tarte fine, alors : 230 kcal la part, pas 310.', 'Corrigé', '18:40', 'Saumon 150 g', 'Prévoir le saumon', 'Autre chose']) assert.equal(text.includes(expected), true, `the log shows « ${expected} »`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=conversation-log-status] svg').length`), 2, 'a check on each finished status, none on the pending one');
    assert.equal(await browser.evaluate(`(() => { const l = document.querySelector('[data-testid=agent-log]'); return l.scrollTop > 0 && l.scrollTop + l.clientHeight >= l.scrollHeight - 2; })()`), true, 'the log opens on its latest entry');
    await shot(`soir-${at}`);
    await browser.evaluate(`document.querySelector('[data-testid=agent-log]').scrollTop = 0`);
    await wait(200);
    await shot(`historique-${at}`);
    await browser.evaluate(`document.querySelector('[data-testid=agent-log]').scrollTop = 99999`);
    const salmon = `[...document.querySelectorAll('button')].find(b => b.textContent === 'Prévoir le saumon')`;
    await (touch ? browser.tap(salmon) : browser.click(salmon));
    assert.deepEqual(await browser.evaluate(`window.__selected`), ['Prévoir le saumon']);

    // The bar stays alive under the sheet.
    await typeInto('une pomme');
    await press('Envoyer');
    await browser.until('sent', `window.__sent.length === 1`);

    // Escape closes it and gives the focus back to the arrow, which flips back.
    await press('Historique'); // the arrow toggles it closed
    await browser.until('closed by the arrow', `!${sheet} && ${label('Historique')}.getAttribute('aria-expanded') === 'false'`);
    assert.equal(await browser.evaluate(focused), 'Historique', 'focus is on the arrow after the arrow closed it');
    await press('Historique');
    await browser.until('open again', `!!${sheet}`);
    await wait(700);
    assert.equal(await browser.evaluate(`${sheet}.contains(document.activeElement)`), true);
    await browser.press('Escape');
    await browser.until('closed by Escape', `!${sheet} && ${label('Historique')}.getAttribute('aria-expanded') === 'false'`);
    assert.equal(await browser.evaluate(focused), 'Historique', 'focus is back on the arrow after Escape');

    // The sheet's own close button too.
    await press('Historique');
    await browser.until('open a third time', `!!${sheet}`);
    await wait(700);
    await press('Fermer l’historique');
    await browser.until('closed by its button', `!${sheet} && ${label('Historique')}.getAttribute('aria-expanded') === 'false'`);
    assert.equal(await browser.evaluate(focused), 'Historique', 'focus is back on the arrow after the close button');
    assert.deepEqual(browser.problems, []);
  });
}
