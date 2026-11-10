import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../../lab/studio/tailwind.mjs';

// D-2064: with `barActions` the composer draws attach and commands as their own bar buttons, left of the field, named from the app's labels. Real Chromium, the real
// composer and slash menu, at 390 touch and 1280 fine, light and dark. Shots go to COMPOSER_BAR_EVIDENCE (CI uploads them). In CI a missing browser fails the test (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('barActions: attach and commands are bar buttons left of the field; commands opens the / list; attach opens the picker (390 touch, 1280 fine; light, dark)', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/composer-bar-actions-'));
  const shots = process.env.COMPOSER_BAR_EVIDENCE ?? join(root, '.cache/evidence/composer-bar-actions'); if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/composer-bar-actions.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'pi-chat'].map(name => registryCss(item(name))).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: shots ?? work });
  const rect = `(selector, scope) => { const node = scope.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }`;
  const measure = () => browser.evaluate(`(() => { const rect = ${rect}; const out = {};
    for (const scope of document.querySelectorAll('[data-case]')) { const id = scope.getAttribute('data-case');
      out[id] = { box: rect('[data-slot=input-group]', scope), controls: rect('[data-testid=composer-controls]', scope),
        stop: rect(id !== 'beside' ? '[data-testid=composer-when-empty] button' : '[data-testid=composer-tools] button:last-child', scope), send: rect('[data-testid=composer-submit]', scope), pause: rect('[data-testid=voice-pause]', scope),
        glyph: (() => { const g = scope.querySelector(id !== 'beside' ? '[data-testid=composer-when-empty] button svg' : '[data-testid=composer-tools] button:last-child svg'); const path = g && g.querySelector('path'); if (!path) return null; const b = path.getBBox(); return path.isPointInFill(new DOMPoint(b.x + b.width / 2, b.y + b.height / 2)); })(),
        starting: !!scope.querySelector('[data-testid=voice-starting]'), dot: !!scope.querySelector('[data-testid=voice-recording-dot]'), timer: scope.querySelector('[data-testid=voice-recording]')?.textContent.trim() ?? null,
        label: scope.querySelector(id !== 'beside' ? '[data-testid=composer-when-empty] button' : '[data-testid=composer-tools] button:last-child')?.getAttribute('aria-label'),
        dotColor: (() => { const dot = scope.querySelector('[data-testid=voice-recording-dot]'); return dot ? getComputedStyle(dot).color : null; })() }; }
    return out; })()`);
  const url = (theme, extra = '') => `http://127.0.0.1:${server.address().port}/?theme=${theme}${extra}`;
  const box = selector => browser.evaluate(`(() => { const n = document.querySelector('${selector}'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, name: n.getAttribute('aria-label') }; })()`);
  try {
    for (const [width, mobile] of [[390, true], [1280, false]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      for (const theme of ['light', 'dark']) {
        const label = `${width} ${theme}`;
        await browser.send('Page.navigate', { url: url(theme) });
        await browser.until('fixture mounted', `!!document.querySelector('[data-testid=composer-input]') && document.readyState === 'complete'`);
        await new Promise(done => setTimeout(done, 300));
        const attach = await box('[data-testid=composer-bar-attach]'), commands = await box('[data-testid=composer-bar-commands]'), field = await box('[data-testid=composer-input]');
        assert.ok(attach && commands, `${label}: both bar buttons exist`);
        assert.equal(attach.name, 'Ajouter des fichiers', `${label}: attach is named from labels.attachFiles`);
        assert.equal(commands.name, 'Actions du dossier', `${label}: commands is named from labels.commands`);
        assert.ok(attach.x + attach.w <= field.x + 1 || attach.y + attach.h <= field.y + 1, `${label}: attach is left of (or above) the field: ${JSON.stringify({ attach, field })}`);
        assert.ok(commands.x + commands.w <= field.x + 1 || commands.y + commands.h <= field.y + 1, `${label}: commands is left of (or above) the field: ${JSON.stringify({ commands, field })}`);
        if (mobile) for (const [name, rect] of [['attach', attach], ['commands', commands]]) assert.ok(rect.h >= 44 && rect.w >= 44, `${label}: ${name} is a 44px target, got ${rect.w}x${rect.h}`);
        assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-plus]') === null`), true, `${label}: no empty + menu when nothing is left in it`);
        await browser.screenshot(`composer-bar-${width}-${theme}.png`);
        await browser.click('[data-testid=composer-bar-attach]');
        assert.equal(await browser.evaluate('window.__picker'), 1, `${label}: attach opens the file picker`);
        await browser.click('[data-testid=composer-bar-commands]');
        await browser.until('the / list opens', `!!document.querySelector('[data-testid=slash-item]')`);
        assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-input]').value`), '/', `${label}: commands puts / in the field, as typing it does`);
        await browser.screenshot(`composer-bar-${width}-${theme}-list.png`);
        await browser.click('[data-testid=slash-item][data-name=relance]');
        await browser.until('the command ran', `document.querySelector('[data-testid=composer-input]').value === 'Relance du dossier Cèdre'`);
        // Off (the default): the + menu keeps attach and commands, no bar buttons.
        await browser.send('Page.navigate', { url: url(theme, '&barActions=off') });
        await browser.until('fixture mounted', `!!document.querySelector('[data-testid=composer-plus]') && document.readyState === 'complete'`);
        assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer-bar-attach]') === null && document.querySelector('[data-testid=composer-bar-commands]') === null`), true, `${label}: off by default, no bar buttons`);
      }
    }
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
