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

// D-2084: files and actions in the agent bar. A real Chromium mounts the public `agent-bar` block (test/fixtures/themes/agent-bar.jsx, `?files=1` turns on
// `attachments` and `slash`) at 390 touch and 1280 fine, light and dark: a file dropped on the bar or pasted into it shows its chip, the Actions button and a typed `/`
// open the commands list and a choice fills the bar; without the props the bar's DOM is the one it always had. Shots go to AGENT_BAR_FILES_EVIDENCE (CI uploads them).
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const skip = !process.env.CHROMIUM && !process.env.CI;
const shots = process.env.AGENT_BAR_FILES_EVIDENCE ?? join(root, '.cache/evidence/agent-bar-files-actions');

let server, browser, port;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(shots, { recursive: true });
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/agent-bar-files-'));
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
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'agent-bar', 'pi-chat'].map(name => registryCss(item(name))).join('\n')}`;
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
const input = `document.querySelector('[data-testid=agent-bar-input]')`;
const label = name => `document.querySelector('[aria-label=${JSON.stringify(name)}]')`;
const press = name => touch ? browser.tap(label(name)) : browser.click(label(name));
const shot = name => browser.screenshot(`${name}.png`);
const sent = () => browser.evaluate(`JSON.stringify(window.__sent)`).then(JSON.parse);
const rectOf = expression => browser.evaluate(`(() => { const e = ${expression}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
// A fictional PDF, handed over the way the browser does it: a drag over then a drop on the bar, or a paste into the field.
const withFile = (target, events) => browser.evaluate(`(() => { const data = new DataTransfer(); data.items.add(new File(['%PDF fictif'], 'releve-fictif.pdf', { type: 'application/pdf' }));
  const node = ${target}; ${events} })()`);
const drop = () => withFile(`document.querySelector('[data-testid=agent-bar]')`, `node.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true })); node.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));`);
const paste = () => withFile(input, `node.focus(); node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));`);
const chip = `[...document.querySelectorAll('[data-testid=attachment]')].filter(node => node.textContent.includes('releve-fictif.pdf'))`;

for (const [width, theme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
  test(`files and actions in the agent bar (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    const at = `${width}-${theme}`;
    await open(width, theme, 'files=1');

    // A file dropped on the bar shows its chip above the field; so does a pasted one; the chips are removable.
    await drop();
    await browser.until('the dropped file has its chip', `${chip}.length === 1`);
    assert.deepEqual(await browser.evaluate('window.__uploaded'), ['releve-fictif.pdf'], 'the drop went through attachments.upload');
    await paste();
    await browser.until('the pasted file has its chip', `${chip}.length === 2`);
    await shot(`files-${at}`);
    await press('Retirer releve-fictif.pdf');
    await browser.until('a chip is removed', `${chip}.length === 1`);

    // The chips go with the message: the uploaded path is a mention in the text, as PiChat sends it.
    await browser.click(input);
    await browser.send('Input.insertText', { text: 'Voici le relevé' });
    await press('Envoyer');
    await browser.until('sent', `window.__sent.length === 1`);
    assert.deepEqual(await sent(), [{ text: 'Voici le relevé @uploads/releve-fictif.pdf' }]);
    assert.equal(await browser.evaluate(`${chip}.length`), 0, 'the chips are cleared after the send');

    // The attach button opens the file picker (counted, then cancelled).
    await browser.evaluate(`window.__picker = 0; document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('[data-testid=agent-bar-file]')) { window.__picker += 1; event.preventDefault(); } }, true)`);
    await press('Ajouter des fichiers');
    assert.equal(await browser.evaluate('window.__picker'), 1, 'attach opens the file picker');

    // The Actions button opens the commands list; choosing one fills the bar.
    await press('Actions du dossier');
    await browser.until('the list opens', `!!document.querySelector('[data-testid=slash-item]')`);
    await shot(`actions-${at}`);
    await browser.click(`document.querySelector('[data-testid=slash-item][data-name=relance]')`);
    await browser.until('the command filled the bar', `${input}.value === 'Relance du dossier Cèdre'`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=slash-item]') === null`), true, 'the list closes');

    // Typing / opens the same list.
    await browser.evaluate(`window.__sent.length = 0`);
    await open(width, theme, 'files=1');
    await browser.click(input);
    await browser.send('Input.insertText', { text: '/' });
    await browser.until('the list opens on /', `!!document.querySelector('[data-testid=slash-item]')`);
    await browser.click(`document.querySelector('[data-testid=slash-item][data-name=relance]')`);
    await browser.until('the command filled the bar', `${input}.value === 'Relance du dossier Cèdre'`);
    if (width === 390) assert.equal(await browser.evaluate('document.scrollingElement.scrollWidth <= 390'), true, 'no horizontal scroll at 390');
    if (touch) for (const name of ['Ajouter des fichiers', 'Actions du dossier']) {
      const box = await rectOf(label(name));
      assert.ok(box && box.w >= 44 && box.h >= 44, `${name} is a 44px target, got ${JSON.stringify(box)}`);
    }
  });

  test(`without the props the agent bar is unchanged (${width}, ${theme})`, { skip, timeout: 240000 }, async () => {
    await open(width, theme);
    const shape = await browser.evaluate(`(() => { const bar = document.querySelector('[data-testid=agent-bar]');
      return { root: [...bar.parentElement.children].map(node => node.dataset.testid ?? node.tagName), bar: [...bar.children].map(node => node.getAttribute('aria-label') ?? node.dataset.testid ?? node.tagName),
        files: document.querySelectorAll('input[type=file]').length, actions: document.querySelectorAll('[data-testid=agent-bar-actions], [data-testid=agent-bar-attach]').length }; })()`);
    assert.deepEqual(shape, { root: ['agent-bar'], bar: ['SPAN', 'agent-bar-input', 'Parler', 'Envoyer'], files: 0, actions: 0 });
    await browser.click(input);
    await browser.send('Input.insertText', { text: '/' });
    await wait(200);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=slash-item]') === null`), true, 'a / is only text without slash');
    const bar = await rectOf(`document.querySelector('[data-testid=agent-bar]')`);
    if (width === 390) assert.equal(bar.h <= 56, true, `the bar keeps its height, got ${bar.h}`);
  });
}
