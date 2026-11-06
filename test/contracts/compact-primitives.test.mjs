import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Optional read-only pinned toolchain; never installs into the source workspace.
const require = createRequire(process.env.COMPACT_TOOLCHAIN_DIR ? join(resolve(process.env.COMPACT_TOOLCHAIN_DIR), '../package.json') : import.meta.url);
const { build } = require('esbuild');
const { compile } = require('tailwindcss');
const names = ['button', 'card', 'input', 'select', 'badge', 'alert', 'tabs', 'empty', 'table', 'textarea', 'input-group', 'message', 'bubble', 'attachment', 'field', 'label', 'separator', 'dropdown-menu', 'native-select'];
const hash = value => createHash('sha256').update(value).digest('hex');

// Runs the real shared source through a browser bundle. Set COMPACT_EVIDENCE to a fresh directory to retain a review snapshot.
test('bundled compact primitives: rendered defaults, states, keyboard behavior and bounded tables', { skip: !process.env.CHROMIUM && !process.env.CI }, async () => {
  // In CI a missing browser fails the test; it never skips (D-1731).
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const evidence = process.env.COMPACT_EVIDENCE ? resolve(process.env.COMPACT_EVIDENCE) : mkdtempSync(join(root, '.cache/compact-primitives-'));
  mkdirSync(evidence, { recursive: true });
  const sourceDirectory = process.env.COMPACT_BASELINE_DIR ? resolve(process.env.COMPACT_BASELINE_DIR) : join(root, 'shadcn/ui');
  const sources = Object.fromEntries(names.map(name => [`shadcn/ui/${name}.tsx`, readFileSync(join(sourceDirectory, `${name}.tsx`), 'utf8')]));
  const fixturePath = 'test/fixtures/themes/compact-primitives.tsx';
  sources[fixturePath] = readFileSync(join(root, fixturePath), 'utf8');
  sources['registry.json'] = readFileSync(join(root, 'registry.json'), 'utf8');
  sources['test/contracts/compact-primitives.test.mjs'] = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const fixture = await build({ entryPoints: [join(root, fixturePath)], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'captured-primitive-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', args.path.split('/').at(-1) + '.tsx') }));
    builder.onLoad({ filter: /shadcn\/ui\/[^/]+\.tsx$/ }, args => ({ contents: sources[`shadcn/ui/${args.path.split('/').at(-1)}`], loader: 'tsx' }));
  } }] });
  const js = fixture.outputFiles[0].text;
  const vars = JSON.parse(sources['registry.json']).items.find(item => item.name === 'theme').cssVars;
  const block = roles => Object.entries(roles).map(([key, value]) => `--${key}: ${value};`).join('\n');
  const fontDir = process.env.COMPACT_FONT_DIR;
  const fontCss = fontDir ? ['Geist', 'Geist Mono'].map(family => `@font-face { font-family: '${family}'; font-style: normal; font-weight: 100 900; src: url('/${family === 'Geist' ? 'sans' : 'mono'}.woff2') format('woff2'); }`).join('\n') : '';
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${fontCss}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(Object.values(sources).flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  for (const [name, content] of Object.entries({ 'app.js': js, 'app.css': css, 'host.css': cssSource, 'index.html': html })) writeFileSync(join(evidence, name), content);
  for (const [path, content] of Object.entries(sources)) { mkdirSync(dirname(join(evidence, 'sources', path)), { recursive: true }); writeFileSync(join(evidence, 'sources', path), content); }
  const manifest = { sourceDirectory, bundle: hash(js), css: hash(css), sources: Object.fromEntries(Object.entries(sources).map(([path, content]) => [path, hash(content)])), fonts: fontDir ? ['sans', 'mono'].map(name => ({ name, sha256: hash(readFileSync(join(fontDir, `${name}.woff2`))) })) : [], coverage: 'Shared primitives only; not shell/chat/tasks/PM, published Factory bundle or schema-aware stacked DataTable.' };
  writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (fontDir && ['/sans.woff2', '/mono.woff2'].includes(path)) { res.setHeader('content-type', 'font/woff2'); res.end(readFileSync(join(fontDir, path.slice(1)))); return; }
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(evidence, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(evidence, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence });
  const measurements = [], violations = [];
  const click = selector => browser.click(`document.querySelector(${JSON.stringify(selector)})`);
  const check = (condition, message) => { if (!condition) violations.push(message); };
  try {
    for (const width of [1440, 390]) for (const mode of ['light', 'dark']) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390, maxTouchPoints: 5 });
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?${width}-${mode}` });
      await browser.until('shared fixture mounted', `document.querySelector('[data-slot="empty-title"]') && document.readyState === 'complete'`);
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'}); document.fonts.ready`);
      await browser.evaluate(`new Promise(requestAnimationFrame).then(() => Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))))`);
      const result = await browser.evaluate(`(() => {
        const style = n => { const s = getComputedStyle(n), r = n.getBoundingClientRect(); return { height: r.height, width: r.width, font: s.fontFamily, fontSize: s.fontSize, radius: s.borderRadius, color: s.color, background: s.backgroundColor, border: s.borderTopWidth, borderColor: s.borderTopColor, shadow: s.boxShadow, opacity: s.opacity, foreground: s.getPropertyValue('--foreground').trim(), card: s.getPropertyValue('--card').trim() }; };
        const one = selector => style(document.querySelector(selector));
        const resolveColor = token => { const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--' + token + ')'; document.body.append(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; };
        // Canvas resolves CSS Color 4 tokens to rendered sRGB; transparent description nodes use their actual Alert fill.
        const luminance = color => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        };
        const contrast = (node, background) => { const fg = luminance(getComputedStyle(node).color), bg = luminance(getComputedStyle(background).backgroundColor); return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05); };
        const statusContrast = ['default', 'success', 'warning', 'info', 'destructive'].map(status => {
          const badge = document.querySelector('[data-testid="badge-' + status + '"]'), alert = document.querySelector('[data-testid="alert-' + status + '"]');
          return { status, badge: contrast(badge, badge), description: contrast(alert.querySelector('[data-slot=alert-description]'), alert) };
        });
        const neutralContrast = ['background', 'card', 'muted'].map(surface => ({ surface, ratio: contrast(document.querySelector('[data-testid="neutral-copy-' + surface + '"]'), document.querySelector('[data-testid="neutral-surface-' + surface + '"]')) }));
        const list = document.querySelector('[data-slot="tabs-list"]'), panel = document.querySelector('[data-slot="tabs-content"]');
        const destructiveButton = document.querySelector('[data-testid="button-destructive"]');
        const chatBody = Object.fromEntries(['textarea', 'group-textarea', 'group-text', 'group-button', 'message', 'bubble', 'attachment-title', 'attachment-description'].map(name => [name, one('[data-testid="body-' + name + '"]')]));
        const ordinaryFields = [...document.querySelectorAll('[data-testid=ordinary-role-fields] [data-slot=field-label],[data-testid=ordinary-role-fields] [data-slot=field-description],[data-testid=ordinary-role-fields] [data-slot=field-error]')].map(n => ({ slot: n.dataset.slot, text: n.textContent, fontSize: getComputedStyle(n).fontSize }));
        return { neutralContrast, ordinaryFields, chatBody, destructiveButtonContrast: contrast(destructiveButton, destructiveButton), statusContrast, statuses: Object.fromEntries(['success', 'warning', 'info', 'destructive'].map(status => [status, { badge: one('[data-testid="badge-' + status + '"]'), alert: one('[data-testid="alert-' + status + '"]'), expectedBackground: resolveColor(status + '-soft') }])), sizes: Object.fromEntries(['xs', 'sm', 'default', 'lg'].map(size => [size, one('[data-testid="size-' + size + '"]')])), tabs: { list: style(list), direction: getComputedStyle(list.parentElement).flexDirection, panelBelow: panel.getBoundingClientRect().top >= list.getBoundingClientRect().bottom }, width: innerWidth, mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light', body: one('body'), card: one('[data-slot="card"]'), cardTitle: one('[data-slot="card-title"]'), cardCopy: one('[data-slot="card-content"]'), emptyTitle: one('[data-slot="empty-title"]'), emptyCopy: one('[data-slot="empty-description"]'), button: one('[data-testid="button-default"]'), outline: one('[data-testid="button-outline"]'), input: one('input'), invalid: one('input[aria-invalid="true"]'), select: one('[data-slot="select-trigger"]'), tab: one('[data-slot="tabs-trigger"]'), row: one('tbody tr'), cell: one('td'), head: one('th'), disabled: one('button[disabled]'), tables: [...document.querySelectorAll('[data-table-width]')].map(n => ({ requested: +n.dataset.tableWidth, actual: n.clientWidth, wrapperClient: n.firstElementChild.clientWidth, wrapperScroll: n.firstElementChild.scrollWidth, tableClient: n.querySelector('table').clientWidth, tableScroll: n.querySelector('table').scrollWidth, maxCellOverflow: Math.max(...[...n.querySelectorAll('td,th')].map(c => c.scrollWidth - c.clientWidth)) })), pageOverflow: document.documentElement.scrollWidth > innerWidth, fonts: [...document.fonts].map(f => ({ family: f.family, status: f.status })) };
      })()`);
      const label = `${width}-${mode}`;
      measurements.push(result);
      // D-1727: on a phone NativeSelect (both sizes) is 44px, level with Input, Button and the Select trigger.
      const touch = await browser.evaluate(`(() => {
        const box = s => document.querySelector(s).getBoundingClientRect().height;
        const row = '[data-testid="touch-targets"] ';
        return { native: [...document.querySelectorAll(row + 'select')].map(n => n.getBoundingClientRect().height), wrappers: [...document.querySelectorAll(row + '[data-slot="native-select-wrapper"]')].map(n => n.getBoundingClientRect().height),
          input: box('[data-testid="touch-input"]'), button: box('[data-testid="touch-button"]'), select: box('[data-testid="touch-select"]') };
      })()`);
      if (width === 390) {
        check(touch.native.length === 2 && touch.native.every(h => h >= 44), `${width}-${mode} NativeSelect <select> (default and sm) must be 44px: ${JSON.stringify(touch.native)}`);
        check(touch.wrappers.every((h, i) => h === touch.native[i]), `${width}-${mode} NativeSelect wrapper follows the select: ${JSON.stringify(touch)}`);
        check([touch.input, touch.button, touch.select].every(h => h === 44) && touch.native[0] === 44, `${width}-${mode} Select, Input, Button and NativeSelect in a row are equal at 44px: ${JSON.stringify(touch)}`);
      }
      check(result.ordinaryFields.length === 4 && result.ordinaryFields.every(n => n.fontSize === '12px'), `${label} ordinary FieldLabel/FieldTitle/description/error must be 12px: ${JSON.stringify(result.ordinaryFields)}`);
      for (const key of ['cardCopy', 'emptyCopy', 'button', 'select', 'tab', 'row']) check(result[key].fontSize === '12px', `${label} ${key}: expected 12px, got ${result[key].fontSize}`);
      for (const key of ['cardTitle', 'emptyTitle']) check(result[key].fontSize === '14px', `${label} ${key}: expected 14px, got ${result[key].fontSize}`);
      check(result.card.shadow === 'none' && result.card.border === '0px', `${label} Card must be flat`);
      check(result.card.radius === '8px', `${label} Card radius`);
      for (const key of ['button', 'input', 'select']) check(result[key].height === (width === 390 ? 44 : 28), `${label} ${key} height: ${result[key].height}`);
      check(result.input.fontSize === (width === 390 ? '16px' : '12px'), `${label} input font exception`);
      check(result.input.border === '1px' && result.outline.border === '1px', `${label} control hairlines`);
      check(!result.pageOverflow, `${label} page overflow`);
      for (const table of result.tables) check(table.wrapperScroll <= table.wrapperClient && table.tableScroll <= table.tableClient && table.maxCellOverflow <= 1, `${label} internal table overflow at ${table.requested}px: ${JSON.stringify(table)}`);
      check(Number(result.disabled.opacity) <= 0.5, `${label} disabled opacity`);
      check(result.cell.color === result.body.color, `${label} settled table foreground inherits body`);
      check(result.outline.background === (mode === 'dark' ? vars.dark.card : vars.light.card), `${label} outline uses card, not primary fill`);
      for (const [name, value] of Object.entries(result.chatBody)) check(value.fontSize === (width === 390 && name.includes('textarea') ? '16px' : '12px'), `${label} ${name} chat body font ${value.fontSize}`);
      for (const value of result.neutralContrast) check(value.ratio >= 4.5, `${label} muted-foreground/${value.surface} contrast ${value.ratio} below 4.5:1`);
      check(result.destructiveButtonContrast >= 4.5, `${label} enabled destructive Button contrast ${result.destructiveButtonContrast} below 4.5:1`);
      for (const value of result.statusContrast) for (const key of ['badge', 'description']) check(value[key] >= 4.5, `${label} ${value.status} ${key} contrast ${value[key]} below 4.5:1`);
      for (const [status, value] of Object.entries(result.statuses)) check(value.badge.background === value.expectedBackground && value.alert.background === value.expectedBackground, `${label} ${status} soft status roles`);
      for (const [size, value] of Object.entries(result.sizes)) check(value.height === (width === 390 ? 44 : { xs: 20, sm: 24, default: 28, lg: 36 }[size]), `${label} ${size} size height`);
      check(result.tabs.direction === 'column' && result.tabs.panelBelow, `${label} horizontal tab content below list`);
      check(result.tabs.list.height === (width === 390 ? 48 : 28), `${label} tab list height`);
      if (fontDir) for (const family of ['Geist', 'Geist Mono']) check(result.fonts.some(f => f.family === family && f.status === 'loaded'), `${label} declared ${family} face loaded`);
      // Full-page captures retain every primitive and all internal table containers.
      const height = await browser.evaluate('document.documentElement.scrollHeight');
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.screenshot(`primitives-${label}.png`);
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await click('[data-testid="button-default"]');
      check(await browser.evaluate(`document.querySelector('[data-testid="clicks"]').textContent`) === 'Actions: 1', `${label} native Button click`);
      await click('input[aria-label="Name"]');
      await browser.press('Tab');
      await browser.press('Tab', { shift: true });
      await browser.evaluate(`new Promise(requestAnimationFrame).then(() => Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))))`);
      result.focus = await browser.evaluate(`({ active: document.activeElement.getAttribute('aria-label'), shadow: getComputedStyle(document.activeElement).boxShadow, border: getComputedStyle(document.activeElement).borderTopColor })`);
      check(result.focus.active === 'Name' && result.focus.shadow !== 'none', `${label} keyboard input focus visible independent of invalid state`);
      await browser.screenshot(`focus-${label}.png`);
      await click('[data-slot="select-trigger"]');
      await browser.until('portalled Select open', `!!document.querySelector('[data-slot="select-content"]')`);
      result.popup = await browser.evaluate(`(() => { const n = document.querySelector('[data-slot="select-content"]'), s = getComputedStyle(n); return { shadow: s.boxShadow, fontSize: getComputedStyle(n.querySelector('[data-slot="select-item"]')).fontSize, outsideMain: !n.closest('main') }; })()`);
      check(result.popup.outsideMain && result.popup.shadow !== 'none', `${label} floating portal retained`);
      await browser.screenshot(`portal-${label}.png`);
      await browser.press('ArrowDown'); await browser.press('Enter');
      await browser.until('selection committed', `document.querySelector('[data-slot="select-trigger"]').textContent.includes('Last 30 days')`);
      await click('[data-testid="role-menu"]');
      await browser.until('all ordinary menu roles mounted', `!!document.querySelector('[data-slot=dropdown-menu-radio-item]')`);
      result.ordinaryMenu = await browser.evaluate(`[...document.querySelectorAll('[data-slot=dropdown-menu-item],[data-slot=dropdown-menu-checkbox-item],[data-slot=dropdown-menu-radio-item],[data-slot=dropdown-menu-sub-trigger]')].map(n=>({slot:n.dataset.slot,fontSize:getComputedStyle(n).fontSize}))`);
      check(result.ordinaryMenu.length === 4 && result.ordinaryMenu.every(n => n.fontSize === '12px'), `${label} item/checkbox/radio/submenu must be 12px: ${JSON.stringify(result.ordinaryMenu)}`);
      await browser.screenshot(`ordinary-menu-${label}.png`);
      await browser.press('Escape');
      await click('[data-slot="tabs-trigger"]');
      await browser.press('ArrowRight'); await browser.press('Enter');
      await browser.until('keyboard Tab selection', `document.querySelector('[data-slot="tabs-content"]').textContent.includes('Recent activity')`);
    }
    writeFileSync(join(evidence, 'measurements.json'), JSON.stringify({ manifest, measurements, violations, browserProblems: browser.problems }, null, 2));
    assert.deepEqual(browser.problems, []);
    assert.deepEqual(violations, []);
  } finally { writeFileSync(join(evidence, 'final-dom.html'), await browser.evaluate('document.documentElement.outerHTML')); await browser.close(); await new Promise(done => server.close(done)); }
});

