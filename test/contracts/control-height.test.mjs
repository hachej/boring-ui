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

// D-1741: one token, --control-h, sizes Button, Input, Textarea, NativeSelect, the composer's mic and send, sidebar rows and header actions:
// 44px under md or on a coarse pointer, 36px on a fine pointer at md+, and [data-density="compact"] forces 36px (and drops the touch floor).
// Text fields are 16px on a phone (iOS zooms the page on focus under 16px) and 14px at md+. A real Chromium measures the real shared sources
// and registry blocks with the registry items' own CSS. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

// The kit's shadcn/ui primitives, and the example app's pinned copy (examples/app-shell/components/ui) that Studio and the app-shell example really render.
for (const primitives of ['shadcn/ui', 'examples/app-shell/components/ui']) for (const withTheme of [true, false]) test(`--control-h sizes the controls (${primitives}, ${withTheme ? 'with' : 'without'} the theme item) at 1440 fine, 1024 coarse, 390 coarse, in a nested data-density="compact" frame and on a compact <html>; text fields are 16px on a phone; an InputGroup and a collapsed Sidebar contain their controls`, { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 240000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const evidence = mkdtempSync(join(root, '.cache/control-height-'));
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => { const file = `${args.path.split('/').at(-1)}.tsx`; return { path: existsSync(join(root, primitives, file)) ? join(root, primitives, file) : join(root, 'shadcn/ui', file) }; });
    // The kit's published subpaths point at dist/; the test reads the same files from src/ so it needs no build.
    const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/control-height.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const items = [...(withTheme ? ['theme'] : []), 'pi-chat', 'app-shell', 'inline-question'].map(name => registryCss(item(name))).join('\n');
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${items}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  for (const [name, content] of Object.entries({ 'app.js': js, 'app.css': css })) writeFileSync(join(evidence, name), content);
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(evidence, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(evidence, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence });
  // sm, xs, icon-sm, icon-xs and the small NativeSelect keep each primitive set's own sizes (the example's pinned copy is a size larger).
  const small = primitives === 'shadcn/ui' ? [24, 20, 24, 20] : [28, 24, 28, 24], nativeSm = primitives === 'shadcn/ui' ? 32 : 28;
  const violations = [];
  const expect = (label, actual, wanted) => { if (JSON.stringify(actual) !== JSON.stringify(wanted)) violations.push(`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`); };
  // Each control as [scope selector, control selector, what to read].
  const measure = scope => browser.evaluate(`(() => {
    const scope = document.querySelector('[data-case="${scope}"]');
    const box = selector => { const node = scope.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(), s = getComputedStyle(node); return { h: r.height, w: r.width, font: s.fontSize }; };
    const buttons = Object.fromEntries(['default', 'lg', 'sm', 'xs', 'icon', 'icon-sm', 'icon-xs'].map(size => [size, box('[data-testid="button-' + size + '"]')]));
    return { coarse: matchMedia('(pointer: coarse)').matches, buttons, input: box('[data-testid="field-input"]'), textarea: box('[data-testid="field-textarea"]'), native: box('select[data-slot="native-select"]:not([data-size="sm"])'),
      nativeSm: box('select[data-size="sm"]'), trigger: box('[data-testid="field-select"]'), sidebarRow: box('[data-testid="sidebar-row"]'), headerAction: box('[data-testid="hdr-action-share"]'),
      send: box('[data-testid="composer-send-case"] [data-testid="composer-submit"]'), mic: box('[data-testid="voice-message-record"]'), composerInput: box('[data-testid="composer-send-case"] textarea'),
      question: box('[data-testid="question-input"]'), questionSubmit: box('[data-testid="question-submit"]'), questionGroup: box('[data-slot="question-field"] [data-slot="input-group"]'), token: getComputedStyle(scope).getPropertyValue('--control-h').trim(),
      group: box('[data-testid="generic-group"]'), groupInside: ['[data-testid="group-button-start"]', '[data-testid="group-input"]', '[data-testid="group-button-end"]'].map(selector => { const g = scope.querySelector('[data-testid="generic-group"]').getBoundingClientRect(), c = scope.querySelector(selector).getBoundingClientRect(); return [selector, c.top >= g.top - 0.5 && c.bottom <= g.bottom + 0.5, c.height]; }),
      railRow: box('[data-testid="collapsed-row"]'), rail: box('[data-slot="sidebar-container"]'), railInside: (() => { const row = scope.querySelector('[data-testid="collapsed-row"]'), rail = scope.querySelector('[data-slot="sidebar-container"]'); if (!row || !rail) return null; const a = row.getBoundingClientRect(), b = rail.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5; })() };
  })()`);
  const sizes = (m, wanted, label) => {
    const defaults = { 'button default': m.buttons.default, 'button lg': m.buttons.lg, 'button icon': m.buttons.icon, input: m.input, native: m.native, select: m.trigger, 'sidebar row': m.sidebarRow, 'header action': m.headerAction, 'composer send': m.send, 'composer mic': m.mic };
    for (const [name, box] of Object.entries(defaults)) expect(`${label} ${name} height`, box?.h, name === 'button lg' && wanted === 36 ? 36 : wanted);
    expect(`${label} icon width`, m.buttons.icon?.w, wanted);
    expect(`${label} generic InputGroup height`, m.group?.h, wanted);
    for (const [selector, inside, height] of m.groupInside) if (selector.includes('group-input') && height < wanted) violations.push(`${label} the group's input is ${height}px, a tap target of ${wanted} was asked`); else if (!inside) violations.push(`${label} ${selector} (${height}px) sticks out of its ${m.group?.h}px InputGroup`);
    // The collapsed rail: the row follows the token and sits inside the rail (the rail is a Sheet under md, so only from md).
    if (m.railRow) { expect(`${label} collapsed sidebar row`, [m.railRow.h, m.railRow.w], [wanted, wanted]); if (!m.railInside) violations.push(`${label} collapsed sidebar row ${m.railRow.w}px sticks out of the ${m.rail?.w}px rail`); }
    expect(`${label} native-select wrapper stays level`, m.native?.h, m.input?.h);
    if (!(m.textarea?.h >= wanted)) violations.push(`${label} textarea height ${m.textarea?.h} under ${wanted}`);
  };
  try {
    for (const [width, mobile] of [[1440, false], [1024, true], [390, true]]) {
      const phone = width < 768;
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?${width}` });
      await browser.until('fixture mounted', `document.querySelectorAll('[data-testid="question-input"]').length === 2 && document.readyState === 'complete'`);
      const normal = await measure('normal'), compact = await measure('compact');
      expect(`${width} pointer: coarse matches by matchMedia`, normal.coarse, mobile);
      // Without the theme item there is no token: the primitives fall back to 36px and the 44px touch floor (phone or coarse pointer) still holds; compact does nothing.
      const real = mobile ? 44 : 36, kept = withTheme ? 36 : real;
      expect(`${width} token resolved`, [normal.token, compact.token], withTheme ? (mobile ? ['2.75rem', '2.25rem'] : ['2.25rem', '2.25rem']) : ['', '']);
      sizes(normal, real, `${width} ${mobile ? 'coarse' : 'fine'}`);
      sizes(compact, kept, `${width} compact frame`);
      // Smaller sizes: unchanged on a fine pointer at md+ and in a compact frame, 44px on touch.
      expect(`${width} sm/xs/icon-sm/icon-xs`, ['sm', 'xs', 'icon-sm', 'icon-xs'].map(size => normal.buttons[size].h), mobile ? [44, 44, 44, 44] : small);
      expect(`${width} compact frame sm/xs/icon-sm/icon-xs`, ['sm', 'xs', 'icon-sm', 'icon-xs'].map(size => compact.buttons[size].h), withTheme || !mobile ? small : [44, 44, 44, 44]);
      expect(`${width} native sm`, [normal.nativeSm.h, compact.nativeSm.h], mobile ? [44, withTheme ? nativeSm : 44] : [nativeSm, nativeSm]);
      expect(`${width} question group and submit`, [normal.questionGroup.h, normal.questionSubmit.h, compact.questionGroup.h, compact.questionSubmit.h], withTheme ? (mobile ? [44, 44, 36, 36] : [36, 32, 36, 32]) : (mobile ? [44, 44, 44, 44] : [36, 32, 36, 32]));
      // Text fields: 16px on a phone (no iOS zoom), 14px at md+. A compact frame changes the height, never the font.
      for (const [name, m] of [['normal', normal], ['compact', compact]]) for (const field of ['input', 'textarea', 'native', 'composerInput', 'question']) {
        const font = m[field]?.font, px = parseFloat(font);
        if (phone && !(px >= 16)) violations.push(`${width} ${name} ${field} font-size ${font} under 16px`);
        if (!phone && font !== '14px') violations.push(`${width} ${name} ${field} font-size ${font}, expected 14px (md:text-sm)`);
      }
      // A compact <html> (a whole page in compact): the media rule must lose to [data-density="compact"] wherever the rules land.
      if (withTheme) {
        await browser.evaluate(`document.documentElement.setAttribute('data-density', 'compact')`);
        await new Promise(done => setTimeout(done, 500)); // buttons transition their size (transition-all)
        const page = await measure('normal');
        expect(`${width} html compact token`, page.token, '2.25rem');
        sizes(page, 36, `${width} compact <html>`);
        expect(`${width} compact <html> sm/xs/icon-sm/icon-xs`, ['sm', 'xs', 'icon-sm', 'icon-xs'].map(size => page.buttons[size].h), small);
        await browser.evaluate(`document.documentElement.removeAttribute('data-density')`);
      }
      // The Select trigger is a button (no keyboard opens, so iOS does not zoom): it keeps the 12px of a button at every width.
      expect(`${width} select trigger font`, [normal.trigger.font, compact.trigger.font], ['12px', '12px']);
      await browser.screenshot(`control-height-${width}.png`);
    }
    assert.deepEqual(violations, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
