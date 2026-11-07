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

// D-1759: tapping the microphone keeps the composer's box and its trailing control. Happy-dom has no layout, so a real Chromium measures the real
// composer with the real voice-message parts, in both layouts, light and dark, at 390 coarse and 1280 fine: the box height and the trailing
// control's rect are the same idle, starting and recording. Set EVIDENCE_DIR to also write the card-layout screenshots there.
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('the composer keeps its box and its trailing control from idle to starting to recording (390 coarse, 1280 fine; light, dark; card, pill)', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/composer-recording-'));
  const shots = process.env.EVIDENCE_DIR; if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/composer-recording.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
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
    for (const id of ['replace', 'beside']) { const scope = document.querySelector('[data-case="' + id + '"]');
      out[id] = { box: rect('[data-slot=input-group]', scope), controls: rect('[data-testid=composer-controls]', scope),
        stop: rect(id === 'replace' ? '[data-testid=composer-when-empty] button' : '[data-testid=composer-tools] button:last-child', scope), send: rect('[data-testid=composer-submit]', scope),
        starting: !!scope.querySelector('[data-testid=voice-starting]'), dot: !!scope.querySelector('[data-testid=voice-recording-dot]'), timer: scope.querySelector('[data-testid=voice-recording]')?.textContent.trim() ?? null,
        label: scope.querySelector(id === 'replace' ? '[data-testid=composer-when-empty] button' : '[data-testid=composer-tools] button:last-child')?.getAttribute('aria-label'),
        dotColor: (() => { const dot = scope.querySelector('[data-testid=voice-recording-dot]'); return dot ? getComputedStyle(dot).color : null; })() }; }
    return out; })()`);
  const report = [], violations = [];
  const same = (label, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) violations.push(`${label}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); };
  try {
    for (const [width, mobile] of [[390, true], [1280, false]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      for (const theme of ['light', 'dark']) for (const layout of ['card', 'pill']) {
        const seen = {};
        for (const state of ['idle', 'starting', 'recording']) {
          await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?layout=${layout}&state=${state}&theme=${theme}&w=${width}` });
          await browser.until('fixture mounted', `document.querySelectorAll('[data-slot=input-group]').length === 2 && document.readyState === 'complete'`);
          await new Promise(done => setTimeout(done, 400));
          seen[state] = await measure();
          if (shots && layout === 'card') await browser.screenshot(`composer-${width}-${theme}-${state}.png`);
          report.push({ width, theme, layout, state, replace: seen[state].replace, beside: seen[state].beside });
        }
        for (const id of ['replace', 'beside']) for (const state of ['starting', 'recording']) {
          const label = `${width} ${theme} ${layout} ${id} ${state}`;
          same(`${label} box height`, seen.idle[id].box.h, seen[state][id].box.h);
          same(`${label} trailing control rect`, seen.idle[id].stop && [seen.idle[id].stop.x, seen.idle[id].stop.y, seen.idle[id].stop.w, seen.idle[id].stop.h], seen[state][id].stop && [seen[state][id].stop.x, seen[state][id].stop.y, seen[state][id].stop.w, seen[state][id].stop.h]);
          same(`${label} send rect`, seen.idle[id].send, seen[state][id].send);
          assert.equal(seen[state][id].stop?.h, mobile ? 44 : 36, `${label} the stop is ${mobile ? 44 : 36}px`);
        }
        for (const id of ['replace', 'beside']) {
          const s = seen.starting[id], r = seen.recording[id];
          assert.equal(s.starting && !s.dot && s.timer === null, true, `${width} ${theme} ${layout} ${id}: Starting… with no dot and no timer`);
          assert.equal(!r.starting && r.dot && r.timer !== null && r.timer.endsWith('0:07'), true, `${width} ${theme} ${layout} ${id}: dot and timer once recording`);
          assert.equal(r.label, 'Stop recording');
        }
      }
    }
    if (shots) writeFileSync(join(shots, 'measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(violations, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
