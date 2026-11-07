import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';

// D-1819: a Badge (18px, inline-flex, on the baseline) in a TableCell must not make its row taller than a row of plain text. Happy-dom has no layout, so a real Chromium
// mounts the real Table, TableRow, TableCell and Badge (shadcn/ui) and measures at 1280 fine and 390 touch, light and dark: equal row heights (0.5px), the badge 18px tall
// and centred in its row. Set EVIDENCE_DIR to also write the screenshots there. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('A Badge in a table cell keeps the row as tall as plain text and stays 18px tall and centred (390 touch, 1280 fine; light, dark)', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/badge-table-row-'));
  const shots = process.env.EVIDENCE_DIR; if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/badge-table-row.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
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
    await browser.until('fixture mounted', `document.querySelectorAll('[data-case] tr').length === 3 && document.querySelectorAll('[data-stack] [data-slot=badge]').length === 2 && document.readyState === 'complete'`);
    await new Promise(done => setTimeout(done, 250));
  };
  const measure = () => browser.evaluate(`(() => {
    const trs = [...document.querySelectorAll('[data-case=table] tr')];
    const heights = trs.map(tr => tr.getBoundingClientRect().height);
    const withBadge = trs.findIndex(tr => tr.dataset.badge === '1');
    const b = document.querySelector('[data-case=table] [data-slot=badge]').getBoundingClientRect(), r = trs[withBadge].getBoundingClientRect();
    const [first, second] = [...document.querySelectorAll('[data-stack] [data-slot=badge]')].map(el => el.getBoundingClientRect());
    return { stack: { gap: second.top - first.bottom }, heights, withBadge, badge: { h: b.height, offset: (b.top + b.height / 2) - (r.top + r.height / 2) } };
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
        if (shots) await browser.screenshot(`badge-table-row-${width}-${theme}.png`);
        const label = `${width} ${theme}`;
        const own = m.heights[m.withBadge], plain = m.heights.filter((_, i) => i !== m.withBadge);
        if (!plain.every(h => Math.abs(h - own) <= 0.5)) problems.push(`${label}: the row with a Badge is ${own}px, the rows with plain text are ${plain}px`);
        if (Math.abs(m.badge.h - 18) > 0.5) problems.push(`${label}: the badge is ${m.badge.h}px tall, not 18`);
        if (m.stack.gap < 0) problems.push(`${label}: two stacked badges overlap by ${-m.stack.gap}px`);
        if (Math.abs(m.badge.offset) > 1) problems.push(`${label}: the badge centre is ${m.badge.offset}px from the row centre`);
      }
    }
    if (shots) writeFileSync(join(shots, 'badge-table-row-measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
