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

// D-1904: on touch the rows of the kit Sidebar grow to the touch height, and SidebarMenuAction (the « … ») must follow: centred on its row, a 44px target, and a row
// with a count (SidebarMenuBadge) and an action must not overlap them (the badge moves left of the action, the label truncates before both). A real Chromium mounts
// the real Sidebar (shadcn/ui/sidebar.tsx) at 390 with a coarse pointer, at 1280 with a fine pointer, and at 390 with a fine pointer (the rule is the pointer, not the width),
// light and dark. The fine-pointer geometry is the one before D-1904 (action 20x20 at top 6 right 4; badge 20 high at top 6 right 4) and must not move.
// Two more cases: a parent row with an open SidebarMenuSub keeps its action and count centred on its own button, never on the whole item (they must not drift over the child rows),
// and an icon-collapsed rail on a tablet-width coarse pointer (1024) keeps every button inside the rail (the expanded end padding must not apply when collapsed).
// Set SIDEBAR_ACTION_EVIDENCE to also write the shots. In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

test('SidebarMenuAction is centred and 44px on touch, clear of the SidebarMenuBadge, and unchanged on a fine pointer (390 coarse, 1280 fine, 390 fine; light, dark)', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/sidebar-action-'));
  const shots = process.env.SIDEBAR_ACTION_EVIDENCE; if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/sidebar-action.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', 'app-shell'].map(name => registryCss(item(name))).join('\n')}`;
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
  const measure = () => browser.evaluate(`(() => {
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, cy: r.y + r.height / 2 }; };
    const out = {};
    for (const row of document.querySelectorAll('[data-row]')) {
      const label = row.querySelector('[data-sidebar=menu-button] > span'), badge = row.querySelector('[data-sidebar=menu-badge]');
      out[row.dataset.row] = { row: box(row), button: box(row.querySelector('[data-sidebar=menu-button]')), sub: box(row.querySelector('[data-sidebar=menu-sub]')), action: box(row.querySelector('[data-sidebar=menu-action]')), badge: box(badge), label: box(label), icon: box(row.querySelector('[data-sidebar=menu-button] > svg')),
        labelTruncates: label.scrollWidth > label.clientWidth, badgeClipped: badge ? badge.scrollWidth > badge.clientWidth : false };
    }
    return { rows: out, rail: box(document.querySelector('[data-slot=sidebar-container]')), overflowX: document.documentElement.scrollWidth > innerWidth };
  })()`);
  const intersects = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  const report = [], problems = [];
  try {
    for (const [name, width, touch, mode] of [['390-touch', 390, true, ''], ['1280-fine', 1280, false, ''], ['390-fine', 390, false, ''], ['1024-touch-collapsed', 1024, true, 'collapsed'], ['1280-fine-collapsed', 1280, false, 'collapsed']]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 560, deviceScaleFactor: 1, mobile: touch });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
      for (const theme of ['light', 'dark']) {
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?theme=${theme}&mode=${mode}` });
        await browser.until('fixture mounted', `document.querySelectorAll('[data-row]').length === 5 && document.readyState === 'complete'`);
        await new Promise(done => setTimeout(done, 250));
        const m = await measure();
        report.push({ name, theme, ...m });
        if (shots && name !== '390-fine') await browser.screenshot(`sidebar-action-${name}-${theme}.png`);
        const check = (ok, message) => { if (!ok) problems.push(`${name} ${theme}: ${message}`); };
        const { plain, action, badge, folder, nested } = m.rows;
        if (mode === 'collapsed') {
          for (const [id, r] of Object.entries(m.rows)) check(r.button.w > 0 && r.button.right <= m.rail.right && r.button.w <= m.rail.w, `${id}: the collapsed button (${r.button.w}px wide, to ${r.button.right}) stays inside the ${m.rail.w}px rail (to ${m.rail.right})`);
          // D-1914: on touch the 44px collapsed button must not show the start of the label beside the icon, and the icon sits in the middle of its button.
          if (touch) for (const [id, r] of Object.entries(m.rows)) {
            check(r.label.w === 0, `${id}: the collapsed label is ${r.label.w}px wide, nothing of it shows beside the icon`);
            check(Math.abs((r.icon.x + r.icon.w / 2) - (r.button.x + r.button.w / 2)) <= 1, `${id}: the icon centre ${r.icon.x + r.icon.w / 2} is its button centre ${r.button.x + r.button.w / 2}`);
          }
          check(!m.overflowX, 'the page does not scroll sideways');
          continue;
        }
        const heights = [action, badge, folder].map(r => r.row.h);
        check(heights.every(h => h === plain.row.h), `every row is as tall as the plain row: ${heights}`);
        check(nested.button.h === plain.row.h, `the parent button is as tall as the plain row: ${nested.button.h}`);
        check(touch || width < 768 ? plain.row.h >= 44 : plain.row.h < 44, `row height ${plain.row.h} (rows are 44px or more on touch and below md, shorter on a wide fine pointer)`);
        check(!m.overflowX, 'the page does not scroll sideways');
        check(!folder.badgeClipped && !badge.badgeClipped, 'the count is not clipped');
        check(width >= 768 || folder.labelTruncates, 'the long folder label truncates at 390');
        if (touch) {
          for (const [id, r] of Object.entries({ action, folder, nested })) {
            check(Math.abs(r.action.cy - r.button.cy) <= 1, `${id}: the action centre ${r.action.cy} is its button centre ${r.button.cy}`);
            check(r.action.w >= 44 && r.action.h >= 44, `${id}: the action is ${r.action.w}x${r.action.h}, 44x44 or more`);
            check(r.action.y >= r.button.y && r.action.bottom <= r.button.bottom, `${id}: the 44px target stays inside its own row`);
          }
          check(!intersects(folder.badge, folder.action), `the count ${JSON.stringify(folder.badge)} and the action ${JSON.stringify(folder.action)} overlap`);
          check(folder.badge.right <= folder.action.x, 'the count is left of the action');
          check(Math.abs(folder.badge.cy - folder.button.cy) <= 1 && Math.abs(badge.badge.cy - badge.button.cy) <= 1 && Math.abs(nested.badge.cy - nested.button.cy) <= 1, 'the count is centred on its button');
          check(folder.label.right <= folder.badge.x && folder.label.right <= folder.action.x, `the label (to ${folder.label.right}) ends before the count and the action`);
          check(nested.sub.h > 0 && nested.action.bottom <= nested.sub.y && nested.badge.bottom <= nested.sub.y, `the parent's action (to ${nested.action.bottom}) and count (to ${nested.badge.bottom}) stay above the child rows (from ${nested.sub.y})`);
        } else {
          for (const [id, r] of Object.entries({ action, folder, nested })) {
            check(r.action.w === 20 && r.action.h === 20 && r.action.y - r.row.y === 6 && r.row.right - r.action.right === 4, `${id}: the fine-pointer action is unchanged (20x20, top 6, right 4): ${JSON.stringify(r.action)} in ${JSON.stringify(r.row)}`);
          }
          for (const [id, r] of Object.entries({ badge, folder, nested })) {
            check(r.badge.h === 20 && r.badge.y - r.row.y === 6 && r.row.right - r.badge.right === 4, `${id}: the fine-pointer count is unchanged (20 high, top 6, right 4): ${JSON.stringify(r.badge)} in ${JSON.stringify(r.row)}`);
          }
        }
      }
    }
    if (shots) writeFileSync(join(shots, 'sidebar-action-measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
