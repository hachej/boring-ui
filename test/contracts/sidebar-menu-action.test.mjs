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
  // A mouse (hover and fine pointer) for CSS media queries, as shots-0473.test.mjs does: a headless Chromium reports neither, so Tailwind's `hover:` and `pointer-fine:` would never apply. Touch runs in a default Chromium with mobile emulation (the coarse pointer).
  const fineBrowser = await launch('about:blank', { evidence: shots ?? work, args: ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] });
  const touchBrowser = await launch('about:blank', { evidence: shots ?? work });
  let browser = fineBrowser;
  const measure = () => browser.evaluate(`(() => {
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, cy: r.y + r.height / 2 }; };
    const out = {};
    for (const row of document.querySelectorAll('[data-row]')) {
      const label = row.querySelector('[data-sidebar=menu-button] > span:not([data-slot=badge])'), badge = row.querySelector(':scope > [data-sidebar=menu-badge]');
      out[row.dataset.row] = { row: box(row), button: box(row.querySelector('[data-sidebar=menu-button]')), sub: box(row.querySelector('[data-sidebar=menu-sub]')), action: box(row.querySelector(':scope > [data-sidebar=menu-action]')), badge: box(badge), label: box(label), icon: box(row.querySelector('[data-sidebar=menu-button] > svg')),
        labelDisplay: getComputedStyle(label).display, labelClip: getComputedStyle(label).overflow, labelText: label.textContent,
        actionOpacity: Number(getComputedStyle(row.querySelector(':scope > [data-sidebar=menu-action]') ?? row).opacity), badgeOpacity: badge ? Number(getComputedStyle(badge).opacity) : null,
        buttonFont: getComputedStyle(row.querySelector('[data-sidebar=menu-button]')).fontSize, subFont: row.querySelector('[data-sidebar=menu-sub-button]') ? getComputedStyle(row.querySelector('[data-sidebar=menu-sub-button]')).fontSize : null,
        childActionOpacity: row.querySelector('[data-sidebar=menu-sub] [data-sidebar=menu-action]') ? Number(getComputedStyle(row.querySelector('[data-sidebar=menu-sub] [data-sidebar=menu-action]')).opacity) : null, childBadgeOpacity: row.querySelector('[data-sidebar=menu-sub] [data-sidebar=menu-badge]') ? Number(getComputedStyle(row.querySelector('[data-sidebar=menu-sub] [data-sidebar=menu-badge]')).opacity) : null,
        childButton: box(row.querySelector('[data-sidebar=menu-sub-button]')), childBadge: box(row.querySelector('[data-sidebar=menu-sub] [data-sidebar=menu-badge]')), childAction: box(row.querySelector('[data-sidebar=menu-sub] [data-sidebar=menu-action]')), dotBadge: box(row.querySelector('[data-sidebar=menu-button] > [data-slot=badge]')), menuBadges: row.querySelectorAll(':scope > [data-sidebar=menu-badge]').length,
        labelTruncates: label.scrollWidth > label.clientWidth, badgeClipped: badge ? badge.scrollWidth > badge.clientWidth : false };
    }
    return { rows: out, rail: box(document.querySelector('[data-slot=sidebar-container]')), overflowX: document.documentElement.scrollWidth > innerWidth };
  })()`);
  const intersects = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  const report = [], problems = [];
  try {
    for (const [name, width, touch, mode] of [['390-touch', 390, true, ''], ['1280-fine', 1280, false, ''], ['390-fine', 390, false, ''], ['1024-touch-collapsed', 1024, true, 'collapsed'], ['1280-fine-collapsed', 1280, false, 'collapsed'], ['390-touch-sheet', 390, true, 'sheet'], ['390-touch-sheet-row', 390, true, 'sheet-row'], ['390-touch-sheet-tap', 390, true, 'sheet-tap']]) {
      browser = touch ? touchBrowser : fineBrowser;
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 560, deviceScaleFactor: 1, mobile: touch });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
      for (const theme of ['light', 'dark']) {
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?theme=${theme}&mode=${mode}` });
        if (mode === 'sheet-tap') { await browser.until('trigger mounted', `!!document.querySelector('[data-sidebar=trigger]')`); await browser.tap(`document.querySelector('[data-sidebar=trigger]')`); }
        await browser.until('fixture mounted', `document.querySelectorAll('[data-row]').length === 8 && document.readyState === 'complete'`);
        await new Promise(done => setTimeout(done, 250));
        const m = await measure();
        const tree = await browser.send('Accessibility.getFullAXTree');
        m.buttonNames = tree.nodes.filter(n => !n.ignored && n.role?.value === 'button').map(n => n.name?.value ?? '');
        report.push({ name, theme, ...m });
        if (shots && name !== '390-fine') await browser.screenshot(`sidebar-action-${name}-${theme}.png`);
        const check = (ok, message) => { if (!ok) problems.push(`${name} ${theme}: ${message}`); };
        const { plain, action, badge, folder, nested } = m.rows;
        // D-2020: a sub-row's count and « … » share the parent's right column (4px in from the row's edge) and their own row's vertical centre, within 2px, and an empty or 0 count renders nothing.
        const childChecks = () => {
          for (const id of ['subbadge', 'subaction']) for (const what of ['childBadge', 'childAction']) {
            const r = m.rows[id]; if (!r[what]) continue;
            check(Math.abs(r[what].cy - r.childButton.cy) <= 2, `${id}: the sub-row ${what.slice(5).toLowerCase()} centre ${r[what].cy} is its sub-row's centre ${r.childButton.cy} (within 2px)`);
            check(Math.abs((r.row.right - r[what].right) - 4) <= 2, `${id}: the sub-row ${what.slice(5).toLowerCase()} right edge is ${r.row.right - r[what].right}px in from the row edge, the parent's column is 4px (within 2px)`);
          }
          // The Importer row holds a 0 count, an empty count (both render nothing), and a count that only wraps an empty Badge (hidden with it). The status dot, an empty Badge in the row's button, is not a count: it stays drawn.
          check(m.rows.dot.menuBadges === 1 && m.rows.dot.badge !== null && m.rows.dot.badge.w === 0 && m.rows.dot.badge.h === 0, `a 0 or empty SidebarMenuBadge renders nothing, and one wrapping an empty Badge is hidden (${m.rows.dot.menuBadges} rendered, box ${JSON.stringify(m.rows.dot.badge)})`);
          check(m.rows.dot.dotBadge !== null && m.rows.dot.dotBadge.w > 0 && m.rows.dot.dotBadge.h === 18, `an empty Badge outside a count (a status dot) is unchanged: still drawn, 18 high (${JSON.stringify(m.rows.dot.dotBadge)})`);
        };
        if (mode.startsWith('sheet')) childChecks();
        if (mode === 'sheet-tap') {
          // D-2020: a sheet opened by a tap shows no focus ring (focus may land inside, but the ring is for a keyboard open), and its list has no visible scrollbar on a coarse pointer yet still scrolls.
          const s = await browser.evaluate(`(() => { const a = document.activeElement, c = document.querySelector('[data-mobile=true] [data-slot=sidebar-content]'); if (c) c.scrollTop = 40;
            return { focusVisible: !!a?.matches(':focus-visible') && !!a.closest('[data-mobile=true]'), ring: a ? getComputedStyle(a).boxShadow : '', scrollbarWidth: c ? getComputedStyle(c).scrollbarWidth : null, overflows: !!c && c.scrollHeight > c.clientHeight, scrolled: !!c && c.scrollTop > 0 }; })()`);
          check(!s.focusVisible && !/ 0px 0px 0px [1-9]/.test(s.ring), `a tap-opened sheet shows no focus ring (focus-visible ${s.focusVisible}; shadow ${s.ring})`);
          check(s.scrollbarWidth === 'none', `the sheet list hides its scrollbar on a coarse pointer (scrollbar-width ${s.scrollbarWidth})`);
          check(s.overflows && s.scrolled, `the sheet list still scrolls (overflows ${s.overflows}, scrolled ${s.scrolled})`);
          // Opened from the keyboard, the ring is shown.
          await browser.press('Escape');
          await browser.until('sheet closed', `!document.querySelector('[data-mobile=true]')`);
          await browser.evaluate(`document.querySelector('[data-sidebar=trigger]').focus()`);
          await browser.press('Enter');
          await browser.until('sheet reopened', `!!document.querySelector('[data-mobile=true] [data-slot=sidebar-content]')`);
          await new Promise(done => setTimeout(done, 250));
          const k = await browser.evaluate(`(() => { const a = document.activeElement; return { focusVisible: !!a?.matches(':focus-visible'), inside: !!a?.closest('[data-mobile=true]') }; })()`);
          check(k.inside && k.focusVisible, `a keyboard-opened sheet takes focus with a visible ring (inside ${k.inside}, focus-visible ${k.focusVisible})`);
        }
        if (mode === 'sheet' || mode === 'sheet-row' || mode === 'sheet-tap') {
          // D-1972: in the real phone sheet (portaled outside the SidebarProvider wrapper) the count and the « … » are as tall as their row button and start at its top.
          check(await browser.evaluate(`document.querySelector('[data-mobile=true]')?.closest('[data-slot=sidebar-wrapper]') === null`), 'the rows are in the portaled sheet, outside the provider wrapper');
          for (const [id, r] of Object.entries(m.rows)) for (const what of ['badge', 'action']) {
            if (!r[what]) continue;
            check(Math.abs(r[what].y - r.button.y) <= 1 && Math.abs(r[what].h - r.button.h) <= 1, `${id}: the ${what} (top ${r[what].y}, ${r[what].h} high) matches its row button (top ${r.button.y}, ${r.button.h} high)`);
          }
          if (mode === 'sheet-row') for (const [id, r] of Object.entries(m.rows)) for (const what of ['button', 'badge', 'action']) if (r[what]) check(r[what].h === 56, `${id}: the ${what} follows the provider's --sidebar-row of 3.5rem in the sheet (${r[what].h}px, expected 56)`);
          continue;
        }
        if (mode === 'collapsed') {
          for (const [id, r] of Object.entries(m.rows)) check(r.button.w > 0 && r.button.right <= m.rail.right && r.button.w <= m.rail.w, `${id}: the collapsed button (${r.button.w}px wide, to ${r.button.right}) stays inside the ${m.rail.w}px rail (to ${m.rail.right})`);
          // D-1914: on touch the 44px collapsed button must not show the start of the label beside the icon, and the icon sits in the middle of its button.
          if (touch) for (const [id, r] of Object.entries(m.rows)) {
            check(r.label.w <= 1 && r.labelClip !== 'visible', `${id}: the collapsed label is ${r.label.w}px wide (${r.labelClip}), nothing of it shows beside the icon`);
            check(Math.abs((r.icon.x + r.icon.w / 2) - (r.button.x + r.button.w / 2)) <= 1, `${id}: the icon centre ${r.icon.x + r.icon.w / 2} is its button centre ${r.button.x + r.button.w / 2}`);
          }
          // D-1918: hiding the label must keep it in the accessibility tree: every collapsed button is named by its label (a badge inside the button does not take its place).
          for (const [id, r] of Object.entries(m.rows)) check(r.labelDisplay !== 'none' && m.buttonNames.includes(r.labelText), `${id}: the collapsed button has no accessible name « ${r.labelText} » (label display ${r.labelDisplay}; names ${JSON.stringify(m.buttonNames)})`);
          check(!m.overflowX, 'the page does not scroll sideways');
          continue;
        }
        childChecks();
        // D-1961: a sub-row reads at the same size as its parent row, on fine and touch.
        check(nested.subFont !== null && nested.subFont === nested.buttonFont, `the sub-row font-size ${nested.subFont} is its parent row's ${nested.buttonFont}`);
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
          // D-1960: at rest the count shows and the action waits; hovered, the action takes the count's place (the count hides). What is drawn never overlaps.
          const drawn = (r, what) => r[`${what}Opacity`] > 0 ? r[what] : null;
          const overlap = r => drawn(r, 'badge') !== null && drawn(r, 'action') !== null && intersects(r.badge, r.action);
          for (const [id, r] of Object.entries({ folder, nested })) {
            check(r.badgeOpacity === 1 && r.actionOpacity === 0, `${id} at rest: the count is shown (${r.badgeOpacity}) and the action is not (${r.actionOpacity})`);
            check(!overlap(r), `${id} at rest: the drawn count and action do not overlap`);
          }
          check(action.actionOpacity === 1, `a row with an action and no count keeps its action shown at rest (${action.actionOpacity})`);
          for (const id of ['folder', 'nested']) {
            await browser.hover(`document.querySelector('[data-row=${id}]')`);
            await new Promise(done => setTimeout(done, 250));
            const h = (await measure()).rows[id];
            if (shots && id === 'nested') await browser.screenshot(`sidebar-action-${name}-${theme}-hover.png`);
            check(h.actionOpacity === 1 && h.badgeOpacity === 0, `${id} hovered: the action is shown (${h.actionOpacity}) and the count hidden (${h.badgeOpacity})`);
            check(!overlap(h), `${id} hovered: the drawn count and action boxes ${JSON.stringify(drawn(h, 'badge'))} and ${JSON.stringify(drawn(h, 'action'))} do not overlap`);
            check(h.action.w === 20 && h.action.y - h.row.y === 6 && h.row.right - h.action.right === 4, `${id} hovered: the action sits where the count was`);
          }
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
          // D-2020: hovering a sub-row hovers its own button, not the parent's: the parent keeps its count and its action stays waiting.
          await browser.hover(`document.querySelector('[data-row=nested] [data-sidebar=menu-sub-button]')`);
          await new Promise(done => setTimeout(done, 250));
          const ns = (await measure()).rows.nested;
          check(ns.badgeOpacity === 1 && ns.actionOpacity === 0, `nested, a sub-row hovered: the parent's count stays (${ns.badgeOpacity}) and its action stays hidden (${ns.actionOpacity})`);
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
          // D-1960 round 2: a child's count does not hide a parent's action at rest; a child's action does not hide a parent's count on hover.
          check(m.rows.subaction.childActionOpacity === 1, `subaction at rest: the child's own action-only « … » stays shown (${m.rows.subaction.childActionOpacity})`);
          check(m.rows.subbadge.childBadgeOpacity === 1, `subbadge at rest: the child's count stays shown (${m.rows.subbadge.childBadgeOpacity})`);
          check(m.rows.subbadge.actionOpacity === 1, `subbadge at rest: the parent's action (no count of its own) stays shown (${m.rows.subbadge.actionOpacity})`);
          await browser.hover(`document.querySelector('[data-row=subbadge] > [data-sidebar=menu-button]')`);
          await new Promise(done => setTimeout(done, 250));
          const sb = (await measure()).rows.subbadge;
          check(sb.childBadgeOpacity === 1 && sb.actionOpacity === 1, `subbadge, parent hovered: the child's count stays shown (${sb.childBadgeOpacity}) and the parent's action too (${sb.actionOpacity})`);
          await browser.hover(`document.querySelector('[data-row=subaction] > [data-sidebar=menu-button]')`);
          await new Promise(done => setTimeout(done, 250));
          const sa = (await measure()).rows.subaction;
          check(sa.badgeOpacity === 1, `subaction hovered: the parent's count (no action of its own) stays shown (${sa.badgeOpacity})`);
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        }
      }
    }
    if (shots) writeFileSync(join(shots, 'sidebar-action-measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual([...fineBrowser.problems, ...touchBrowser.problems], []);
  } finally { await fineBrowser.close(); await touchBrowser.close(); await new Promise(done => server.close(done)); }
});
