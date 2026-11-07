import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';

// D-1861: <TableCell truncate> is one line with an ellipsis and its row is as tall as a row of short text. Happy-dom has no layout, so a real Chromium mounts the real
// Table, TableRow and TableCell (shadcn/ui) and measures at 1280 fine (light, dark): one line box, scrollWidth > clientWidth, equal row heights (0px), the label cell
// still wrapping-capable, no sideways scroll. At 390 touch the Table has no stacked layout of its own: a cell without the prop wraps as on main and its row is taller than a short row. Set EVIDENCE_DIR to also write the screenshots there. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('TableCell truncate is one line with an ellipsis, in a row as tall as short text (1280 fine; light, dark), and plain cells are unchanged (390 touch)', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/table-cell-truncate-'));
  const shots = process.env.EVIDENCE_DIR; if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/table-cell-truncate.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }`;
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
  const open = async query => {
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?${query}` });
    await browser.until('fixture mounted', `document.querySelectorAll('[data-case] tr').length === 3 && document.readyState === 'complete'`);
    await new Promise(done => setTimeout(done, 250));
  };
  const measure = () => browser.evaluate(`(() => {
    const trs = [...document.querySelectorAll('[data-case=table] tr')];
    const inner = document.querySelector('[data-cell=long] [data-slot=table-cell-truncate]');
    if (!inner) return { noInner: true };
    const cs = getComputedStyle(inner), cell = document.querySelector('[data-cell=long]');
    const line = parseFloat(cs.lineHeight);
    return { heights: trs.map(tr => tr.getBoundingClientRect().height), inner: { h: inner.getBoundingClientRect().height, line, scrollWidth: inner.scrollWidth, clientWidth: inner.clientWidth,
      overflow: cs.overflow, whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow }, truncateAttr: cell.hasAttribute('data-truncate'), title: cell.title,
      shortTitle: document.querySelector('[data-cell=short]').title, plainClass: document.querySelector('[data-cell=plain]').className, plainInner: !!document.querySelector('[data-cell=plain] [data-slot=table-cell-truncate]'),
      plainWhiteSpace: getComputedStyle(document.querySelector('[data-cell=plain]')).whiteSpace, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`);
  const report = [], problems = [];
  try {
    for (const [width, mobile] of [[1280, false], [390, true]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      for (const theme of ['light', 'dark']) {
        await open(`theme=${theme}`);
        const m = await measure();
        report.push({ width, theme, ...m });
        if (m.noInner) { problems.push(`${width} ${theme}: the truncate cell has no inner block (data-slot=table-cell-truncate)`); continue; }
        if (shots) await browser.screenshot(`table-cell-truncate-${width}-${theme}.png`);
        const label = `${width} ${theme}`;
        if (m.scrollX > 0) problems.push(`${label}: the page scrolls sideways by ${m.scrollX}px`);
        if (m.plainInner || !m.plainClass.includes('whitespace-normal') || m.plainWhiteSpace !== 'normal') problems.push(`${label}: a cell without the prop changed (${m.plainClass}, ${m.plainWhiteSpace})`);
        if (mobile) { if (m.heights[2] <= m.heights[1]) problems.push(`${label}: the plain long cell should still wrap on a phone, rows ${m.heights}`); continue; }
        if (!m.truncateAttr) problems.push(`${label}: the cell has no data-truncate`);
        if (Math.abs(m.inner.h - m.inner.line) > 0.5) problems.push(`${label}: the truncate cell is ${m.inner.h}px tall, one line is ${m.inner.line}px`);
        if (m.inner.scrollWidth <= m.inner.clientWidth) problems.push(`${label}: no ellipsis, scrollWidth ${m.inner.scrollWidth} <= clientWidth ${m.inner.clientWidth}`);
        if (m.inner.overflow !== 'hidden' || m.inner.whiteSpace !== 'nowrap' || m.inner.textOverflow !== 'ellipsis') problems.push(`${label}: inner styles ${JSON.stringify(m.inner)}`);
        if (m.heights[0] !== m.heights[1]) problems.push(`${label}: the long row is ${m.heights[0]}px, the short row ${m.heights[1]}px`);
        if (!m.title.startsWith('Camille Durand-Lefebvre') || m.shortTitle !== 'Camille') problems.push(`${label}: the full text is not in the title (${m.title} / ${m.shortTitle})`);
      }
    }
    if (shots) writeFileSync(join(shots, 'table-cell-truncate-measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
