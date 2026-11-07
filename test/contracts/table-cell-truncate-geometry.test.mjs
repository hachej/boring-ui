import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';

// D-1861: <TableCell truncate> is one line with an ellipsis (also in a table-auto table, and at 390 touch) and its row is as tall as a row of short text. Happy-dom has no layout, so a real Chromium mounts the real
// Table, TableRow and TableCell (shadcn/ui) and measures at 1280 fine (light, dark): one line box, scrollWidth > clientWidth, equal row heights (0px), the label cell
// still wrapping-capable, no sideways scroll. The Table has no stacked mode (DataTable's phone list is a separate render), so 390 touch checks the same one line and bound. A focused inline Button keeps its 3px ring (overflow: clip with a clip margin). Set EVIDENCE_DIR to also write the screenshots there. In CI a missing browser fails the test; it never skips (D-1731).
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
    await browser.until('fixture mounted', `document.querySelectorAll('[data-case] tr').length === 6 && document.readyState === 'complete'`);
    await new Promise(done => setTimeout(done, 250));
  };
  const measure = () => browser.evaluate(`(() => {
    const trs = [...document.querySelectorAll('[data-case=table] table:not([data-auto]) tr')].slice(0, 3);
    const inner = document.querySelector('[data-cell=long] [data-slot=table-cell-truncate]');
    if (!inner) return { noInner: true };
    const cs = getComputedStyle(inner), cell = document.querySelector('[data-cell=long]');
    const line = parseFloat(cs.lineHeight);
    const btn = document.querySelector('[data-btn]'), bi = document.querySelector('[data-cell=button] [data-slot=table-cell-truncate]');
    btn.focus();
    const bcs = getComputedStyle(bi), br = btn.getBoundingClientRect(), ir = bi.getBoundingClientRect();
    const ring = { margin: parseFloat(bcs.overflowClipMargin) || 0, overflow: bcs.overflow, leftGap: br.left - ir.left, btnH: br.height, lineH: parseFloat(bcs.lineHeight) };
    const au = document.querySelector('[data-cell=auto] [data-slot=table-cell-truncate]'), acs = getComputedStyle(au);
    const auto = { h: au.getBoundingClientRect().height, line: parseFloat(acs.lineHeight), w: au.getBoundingClientRect().width, max: parseFloat(getComputedStyle(document.documentElement).fontSize) * 16, sw: au.scrollWidth, cw: au.clientWidth, layout: getComputedStyle(au.closest('table')).tableLayout };
    return { ring, auto, heights: trs.map(tr => tr.getBoundingClientRect().height), inner: { h: inner.getBoundingClientRect().height, line, scrollWidth: inner.scrollWidth, clientWidth: inner.clientWidth,
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
        if (!mobile && (m.plainInner || !m.plainClass.includes('whitespace-normal') || m.plainWhiteSpace !== 'normal')) problems.push(`${label}: a cell without the prop changed (${m.plainClass}, ${m.plainWhiteSpace})`);
        // The Table never stacks (DataTable's phone list is a separate render): at 390 touch the truncate cell is still one line within the same bound.
        if (m.auto.layout !== 'auto') problems.push(`${label}: the second table is ${m.auto.layout}, not auto`);
        if (Math.abs(m.auto.h - m.auto.line) > 0.5) problems.push(`${label}: the table-auto identifier cell is ${m.auto.h}px tall, one line is ${m.auto.line}px`);
        if (m.auto.w > m.auto.max + 0.5) problems.push(`${label}: the table-auto identifier cell is ${m.auto.w}px wide, over the ${m.auto.max}px bound`);
        if (m.auto.sw <= m.auto.cw) problems.push(`${label}: the identifier has no ellipsis in table-auto (${m.auto.sw} <= ${m.auto.cw})`);
        if (m.ring.margin < m.ring.leftGap + 4) problems.push(`${label}: the clip margin ${m.ring.margin}px does not leave the 3px focus ring of a flush inline Button unclipped (${m.ring.overflow})`);
        if (m.inner.h > 0 && Math.abs(m.inner.h - m.inner.line) > 0.5) problems.push(`${label}: the truncate cell is ${m.inner.h}px tall, one line is ${m.inner.line}px`);
        if (m.inner.clientWidth > m.auto.max + 0.5) problems.push(`${label}: the truncate cell is ${m.inner.clientWidth}px wide, over the ${m.auto.max}px bound`);
        if (mobile) continue;
        if (!m.truncateAttr) problems.push(`${label}: the cell has no data-truncate`);
        if (Math.abs(m.inner.h - m.inner.line) > 0.5) problems.push(`${label}: the truncate cell is ${m.inner.h}px tall, one line is ${m.inner.line}px`);
        if (m.inner.scrollWidth <= m.inner.clientWidth) problems.push(`${label}: no ellipsis, scrollWidth ${m.inner.scrollWidth} <= clientWidth ${m.inner.clientWidth}`);
        if (m.inner.overflow !== 'clip' || m.inner.whiteSpace !== 'nowrap' || m.inner.textOverflow !== 'ellipsis') problems.push(`${label}: inner styles ${JSON.stringify(m.inner)}`);
        if (m.heights[0] !== m.heights[1]) problems.push(`${label}: the long row is ${m.heights[0]}px, the short row ${m.heights[1]}px`);
        if (!m.title.startsWith('Camille Durand-Lefebvre') || m.shortTitle !== 'Camille') problems.push(`${label}: the full text is not in the title (${m.title} / ${m.shortTitle})`);
      }
    }
    if (shots) writeFileSync(join(shots, 'table-cell-truncate-measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
