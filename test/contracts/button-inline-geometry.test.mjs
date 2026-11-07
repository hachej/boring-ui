import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../../lab/studio/tailwind.mjs';

// D-1767: Button size="inline" is a link-style label inside a table row or a sentence. Happy-dom has no layout, so a real Chromium mounts the real
// Button (shadcn/ui/button.tsx) in a table row and measures it at 390 touch and 1280 fine: the rows are as tall as with plain text, the box is the
// text height with no padding or border, the touch hit area is a 44px pseudo-element (elementFromPoint outside the box, inside the area), a fine
// pointer has none, and a bare size="inline" is rendered with the link variant. Set EVIDENCE_DIR to also write the screenshots there.
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('Button size="inline" keeps a table row at text height and keeps a 44px touch hit area as a pseudo-element only (390 coarse, 1280 fine; light, dark)', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/button-inline-'));
  const shots = process.env.EVIDENCE_DIR; if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/button-inline.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${registryCss(item('theme'))}`;
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
    await browser.until('fixture mounted', `document.querySelectorAll('[data-case]').length === 3 && document.readyState === 'complete'`);
    await new Promise(done => setTimeout(done, 250));
  };
  const rows = scope => `[...document.querySelectorAll('[data-case=${scope}] tr')].map(tr => tr.getBoundingClientRect().height)`;
  const measure = () => browser.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-case=table] button')], tag = buttons[0];
    const style = getComputedStyle(tag), after = getComputedStyle(tag, '::after'), r = tag.getBoundingClientRect();
    const who = (el, list) => { const i = list.indexOf(el); return i === -1 ? (el ? el.tagName.toLowerCase() : null) : 'button' + i; };
    const reach = (dy) => who(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2 + dy), buttons);
    const dense = [...document.querySelectorAll('[data-case=dense] button')], d = dense.map(b => b.getBoundingClientRect());
    const sentence = document.querySelector('[data-case=sentence] button'), sr = sentence.getBoundingClientRect();
    return { table: ${rows('table')}, dense: ${rows('dense')}, box: { w: r.width, h: r.height }, lineHeight: parseFloat(style.lineHeight),
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], border: [style.borderTopWidth, style.borderBottomWidth],
      minHeight: style.minHeight, minWidth: style.minWidth, link: tag.className.includes('text-primary') && !tag.className.includes('bg-primary'), decoration: style.textDecorationLine,
      after: after.content === 'none' || after.content === 'normal' ? null : { w: parseFloat(after.width), h: parseFloat(after.height), position: after.position },
      reach: { above: reach(-20), below: reach(20), far: reach(-26) },
      adjacent: { rowGap: d[1].top - d[0].bottom, between: who(document.elementFromPoint(d[0].x + d[0].width / 2, (d[0].bottom + d[1].top) / 2), dense),
        justBelowFirst: who(document.elementFromPoint(d[0].x + d[0].width / 2, d[0].bottom + 1), dense), justAboveSecond: who(document.elementFromPoint(d[1].x + d[1].width / 2, d[1].top - 1), dense) },
      sentence: { h: sr.height, line: parseFloat(getComputedStyle(sentence).lineHeight), overflowX: document.documentElement.scrollWidth > innerWidth } };
  })()`);
  const report = [], problems = [];
  try {
    for (const [width, mobile] of [[390, true], [1280, false]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      for (const theme of ['light', 'dark']) {
        await open(`theme=${theme}&with=0`);
        const plain = await browser.evaluate(`({ table: ${rows('table')}, dense: ${rows('dense')} })`);
        await open(`theme=${theme}&with=1`);
        const m = await measure();
        report.push({ width, theme, plain, ...m });
        if (shots) await browser.screenshot(`button-inline-${width}-${theme}.png`);
        const label = `${width} ${theme}`;
        const check = (ok, message) => { if (!ok) problems.push(`${label}: ${message}`); };
        check(JSON.stringify(m.table) === JSON.stringify(plain.table), `table rows with the button ${m.table} vs plain text ${plain.table}`);
        check(JSON.stringify(m.dense) === JSON.stringify(plain.dense), `dense rows with the button ${m.dense} vs plain text ${plain.dense}`);
        check(Math.abs(m.box.h - m.lineHeight) <= 1, `the box is ${m.box.h}px, the text line is ${m.lineHeight}px`);
        check(m.padding.every(value => value === '0px') && m.border.every(value => value === '0px'), `padding ${m.padding} border ${m.border} must be zero`);
        check(m.minHeight === '0px' && m.minWidth === '0px', `min size ${m.minHeight} x ${m.minWidth} must be cancelled`);
        check(m.link && m.decoration === 'none', `a bare size="inline" is the link variant (link ${m.link}, decoration ${m.decoration})`);
        if (mobile) {
          check(m.after && m.after.h === 44 && m.after.w >= 44 && m.after.position === 'absolute', `touch hit area ${JSON.stringify(m.after)}`);
          check(m.reach.above === 'button0' && m.reach.below === 'button0', `a tap 20px above or below the box must reach the button, got ${JSON.stringify(m.reach)}`);
          check(m.reach.far !== 'button0', `a tap 26px away is outside the 44px area, got ${m.reach.far}`);
        } else {
          check(m.after === null, `a fine pointer has no pseudo-element, got ${JSON.stringify(m.after)}`);
          check(m.reach.above !== 'button0' && m.reach.below !== 'button0', `on a fine pointer the hit area is the box, got ${JSON.stringify(m.reach)}`);
        }
        check(m.sentence.h > m.sentence.line * 1.5 && !m.sentence.overflowX, `a long label wraps in a sentence: ${JSON.stringify(m.sentence)}`);
      }
    }
    if (shots) writeFileSync(join(shots, 'button-inline-measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
