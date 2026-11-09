import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { CORE_ROLES } from '../../packages/ui/bin/boring-ui-blocks.mjs';
import { DATA_PREFIX, buildDesignSystem } from '../../scripts/build-design-system.mjs';
import { RENDERED_SLOTS, slotExpectations, uncovered } from './design-system-slots.mjs';

// D-1888: a real Chromium opens the built design-system page over file:// and over http, in a sandboxed iframe with an opaque origin (how Factory shows it) and
// drives the three toggles. Every section renders, the contrast figures are numbers measured from the painted colours, dark switching changes --background, and a
// changed token in a copy of theme.derived.css changes the page with no page edit. Every shadcn/ui export is rendered by its real component (its data-slot is
// inside the demo that names it, the overlays open and inside their boxes, the toasts real), and the shell text reads at 4.5:1 in every theme and mode, also for a
// theme that sets two roles. Set EVIDENCE_DIR to also write the shots (390 and 1280, light and dark; the header in two themes).
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const FRAME = 'document.querySelector("iframe[data-ds-frame]")';
const dataOf = dir => JSON.parse(readFileSync(join(dir, 'data.js'), 'utf8').slice(DATA_PREFIX.length).replace(/;\s*$/, ''));
const pause = ms => new Promise(done => setTimeout(done, ms));

/**
 * Measures the text of the shell (the header title and the note under it) against the colours painted behind it: every ancestor background is laid over white on a
 * canvas, which also resolves oklch and color-mix values. Returns the lowest contrast ratio.
 */
const SHELL_CONTRAST = `(() => {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const paint = (color, base) => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = 'rgb(' + base.join(',') + ')'; context.fillRect(0, 0, 1, 1);
    context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data; return [r, g, b];
  };
  const luminance = rgb => { const [r, g, b] = rgb.map(value => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratios = [document.querySelector('[data-ds-section=header] h1'), document.querySelector('[data-ds-applied]')].map(node => {
    const chain = []; for (let at = node; at; at = at.parentElement) chain.unshift(at);
    const behind = chain.reduce((base, at) => paint(getComputedStyle(at).backgroundColor, base), [255, 255, 255]);
    const text = paint(getComputedStyle(node).color, behind);
    const [high, low] = [luminance(text), luminance(behind)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  });
  return Math.min(...ratios);
})()`;

/** Reads what the frame shows. It runs inside the frame, so it works from an opaque origin too. */
const INSPECT = `(() => {
  const all = selector => [...document.querySelectorAll(selector)];
  const overlays = all('[data-ds-bounded]').map(box => {
    const id = box.dataset.dsBounded, outer = box.getBoundingClientRect();
    const popups = [...box.querySelectorAll('[data-ds-overlay]')].map(node => node.getBoundingClientRect());
    const rects = popups.map(r => [r.left, r.top, r.right, r.bottom].map(Math.round).join(",") + " in " + [outer.left, outer.top, outer.right, outer.bottom].map(Math.round).join(","));
    const inside = popups.length > 0 && popups.every(inner => inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1 && inner.left >= outer.left - 1 && inner.right <= outer.right + 1);
    return { id, inside, rects, count: popups.length, popup: popups.length ? popups[0].height : 0, box: outer.height };
  });
  const card = name => { const node = document.querySelector(name); return node ? getComputedStyle(node).getPropertyValue('--card').trim() : ''; };
  return {
    sections: all('[data-ds-section]').map(node => node.dataset.dsSection),
    roles: all('[data-ds-role]').map(node => node.dataset.dsRole),
    swatches: all('[data-ds-swatch]').length,
    ratios: all('[data-ds-contrast]').map(node => node.dataset.ratio),
    pairs: all('[data-ds-pair]').length,
    rendered: [...new Set(all('[data-ds-component]').flatMap(node => node.dataset.dsComponent.split(/\\s+/)))],
    errors: all('[data-ds-error]').map(node => node.textContent),
    toasts: all('[data-sonner-toast]').length,
    cells: all('iframe[data-ds-cell]').length,
    cards: { light: card('.ds-light'), dark: card('.ds-dark') },
    slots: ${RENDERED_SLOTS},
    steps: all('[data-ds-step-size]').map(node => node.textContent),
    heights: Object.fromEntries(all('[data-ds-density]').map(node => [node.dataset.dsDensity, node.querySelector('[data-ds-control-height]').textContent])),
    radii: all('[data-ds-radius]').length,
    shadows: all('[data-ds-shadow]').length,
    overlays,
    mutedLight: (document.querySelector('[data-ds-pair="muted-foreground/background"] [data-ds-contrast="light"]') || {}).dataset?.ratio,
    foregroundLight: (document.querySelector('[data-ds-pair="foreground/background"] [data-ds-contrast="light"]') || {}).dataset?.ratio,
    foregroundDark: (document.querySelector('[data-ds-pair="foreground/background"] [data-ds-contrast="dark"]') || {}).dataset?.ratio,
  };
})()`;

test('The design-system page renders every section, measures contrast, switches mode, width and theme (file://, http, sandboxed iframe) and follows a changed token', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 240000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/design-system-browser-'));
  const shots = process.env.EVIDENCE_DIR; if (shots) mkdirSync(shots, { recursive: true });

  // The page as built, a copy with a second theme (added by the kit's own command), and a copy built from a changed theme.derived.css.
  const site = join(work, 'site');
  const { data } = await buildDesignSystem(root, { outDir: site });
  const kit = join(work, 'kit');
  mkdirSync(join(kit, 'bin'), { recursive: true });
  copyFileSync(join(root, 'packages/ui/bin/boring-ui-blocks.mjs'), join(kit, 'bin/boring-ui-blocks.mjs'));
  await buildDesignSystem(root, { outDir: join(kit, 'design-system') });
  const harborCss = join(work, 'harbor.css');
  writeFileSync(harborCss, ':root {\n  --background: oklch(0.93 0.05 230);\n  --foreground: oklch(0.2 0.02 230);\n}\n.dark {\n  --background: oklch(0.2 0.05 230);\n}\n');
  const harbor = join(work, 'harbor');
  // A theme that sets two roles only: every other role, and the whole dark column, must come from the default.
  const partialCss = join(work, 'partial.css');
  writeFileSync(partialCss, ':root {\n  --background: oklch(0.95 0.04 40);\n  --foreground: oklch(0.25 0.04 40);\n}\n');
  const added = spawnSync(process.execPath, [join(kit, 'bin/boring-ui-blocks.mjs'), 'design-system', '--out', harbor, '--theme', `harbor=${harborCss}`, '--theme', `partial=${partialCss}`], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const derivedCss = readFileSync(join(root, 'packages/ui/styles/theme.derived.css'), 'utf8');
  const changed = derivedCss.replace('--muted-foreground: color-mix(in oklab, var(--foreground) 57%, var(--background));', '--muted-foreground: var(--background);');
  assert.notEqual(changed, derivedCss);
  const derived = join(work, 'derived');
  await buildDesignSystem(root, { outDir: derived, derivedCss: changed });

  const dirs = { '/site': site, '/harbor': harbor, '/derived': derived };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/host.html') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html><body><iframe id="sandboxed" sandbox="allow-scripts" src="/harbor/index.html" style="width:1400px;height:800px;border:0"></iframe></body></html>');
      return;
    }
    const base = Object.keys(dirs).find(prefix => path.startsWith(`${prefix}/`));
    if (!base || path.includes('..')) { res.statusCode = 404; res.end('missing'); return; }
    try {
      const body = readFileSync(join(dirs[base], path.slice(base.length)));
      res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(body);
    } catch { res.statusCode = 404; res.end('missing'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: shots ?? work });
  const problems = [];
  const applied = () => `(() => { const raw = (document.querySelector('[data-ds-applied]') || {}).dataset?.dsApplied; return raw ? JSON.parse(raw) : null; })()`;
  const inFrame = (expression, frame = FRAME) => browser.frameEvaluate(frame, expression);
  const untilIn = async (label, expression, frame = FRAME, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await inFrame(expression, frame).catch(() => undefined);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await pause(200);
    }
  };
  const READY = `document.querySelectorAll('[data-ds-bounded]').length > 0 && [...document.querySelectorAll('[data-ds-bounded]')].every(box => box.querySelector('[data-ds-overlay]')) && document.querySelectorAll('[data-sonner-toast]').length > 0 && document.querySelectorAll('iframe[data-ds-cell]').length === 2 && document.querySelectorAll('[data-ds-contrast]').length > 0 && [...document.querySelectorAll('[data-ds-contrast]')].every(node => node.dataset.ratio)`;
  const expected = slotExpectations(root);

  const checkSections = (label, seen) => {
    for (const name of ['colors', 'type', 'shape', 'density', 'components']) if (!seen.sections.includes(name)) problems.push(`${label}: section ${name} is missing`);
    const roles = new Set(seen.roles);
    for (const name of CORE_ROLES) if (!roles.has(name)) problems.push(`${label}: role ${name} is not drawn`);
    if (seen.swatches < 2 * data.roles.filter(role => role.kind === 'color').length) problems.push(`${label}: ${seen.swatches} swatches`);
    if (seen.pairs !== data.pairs.length || seen.ratios.length !== 2 * data.pairs.length) problems.push(`${label}: ${seen.ratios.length} contrast figures for ${data.pairs.length} pairs`);
    if (!seen.ratios.every(ratio => /^\d+\.\d\d$/.test(ratio))) problems.push(`${label}: a contrast figure is not a number: ${seen.ratios.filter(ratio => !/^\d+\.\d\d$/.test(ratio))}`);
    if (!(Number(seen.foregroundLight) > 7 && Number(seen.foregroundDark) > 7)) problems.push(`${label}: foreground on background measures ${seen.foregroundLight} light and ${seen.foregroundDark} dark`);
    for (const message of seen.errors) problems.push(`${label}: a demo failed to render: ${message}`);
    if (seen.toasts < 2) problems.push(`${label}: ${seen.toasts} toasts`);
    for (const scope of ['light', 'dark']) if (!seen.cards[scope] || /^(transparent|rgba?\(0, 0, 0, 0\))$/.test(seen.cards[scope])) problems.push(`${label}: --card is "${seen.cards[scope]}" in the ${scope} column`);
    if (seen.steps.length !== data.textSteps.length || !seen.steps.every(text => /^\d+(\.\d+)?px \/ \S+/.test(text))) problems.push(`${label}: text steps ${JSON.stringify(seen.steps)}`);
    if (seen.heights.fine !== '36px' || seen.heights.touch !== '44px') problems.push(`${label}: control heights ${JSON.stringify(seen.heights)}`);
    if (seen.radii !== data.radii.length || seen.shadows !== 4) problems.push(`${label}: ${seen.radii} radii, ${seen.shadows} shadows`);
    for (const frame of seen.overlays) if (!frame.inside) problems.push(`${label}: ${frame.id} is not inside its box (${frame.count} popups: ${frame.rects.join(" ; ")})`);
    for (const frame of seen.overlays.filter(entry => entry.id.endsWith('-tall'))) if (!(frame.popup <= frame.box * 0.85 + 1)) problems.push(`${label}: ${frame.id} is ${frame.popup}px in a ${frame.box}px box`);
  };

  /** Drives mode, width and theme through the header buttons of the page whose shell is `frame` (null: the top document). */
  const drive = async (label, run) => {
    const shell = expression => run.shell(expression);
    const state = () => shell(applied());
    const waitState = (what, test) => untilState(label, what, test);
    const untilState = async (name, what, test) => {
      const deadline = Date.now() + 30000;
      for (;;) {
        const value = await state().catch(() => null);
        if (value && test(value)) return value;
        if (Date.now() > deadline) throw new Error(`Timed out: ${name} ${what}: ${JSON.stringify(value)}`);
        await pause(200);
      }
    };
    const click = mark => shell(`document.querySelector('${mark}').click()`);
    const first = await waitState('first frame', value => value.sections === 5);
    const before = await shell(`getComputedStyle(document.documentElement).getPropertyValue('--background').trim()`);
    assert.equal(first.dark, false, `${label}: starts light`);
    await click('[data-ds-mode=dark]');
    const dark = await waitState('dark', value => value.dark === true);
    const after = await shell(`getComputedStyle(document.documentElement).getPropertyValue('--background').trim() + '|' + document.documentElement.classList.contains('dark')`);
    assert.notEqual(after.split('|')[0], before, `${label}: --background changes with dark in the shell`);
    assert.equal(after.split('|')[1], 'true', `${label}: the shell has .dark`);
    assert.notEqual(dark.background, first.background, `${label}: --background changes with dark in the frame`);
    await click('[data-ds-width="390"]');
    await waitState('width 390', value => value.width === 390);
    assert.equal(await shell(`document.querySelector('iframe[data-ds-frame]').getBoundingClientRect().width`), 390, `${label}: the frame is 390 wide`);
    await click('[data-ds-width="1280"]');
    await waitState('width 1280', value => value.width === 1280);
    await click('[data-ds-theme=harbor]');
    const themed = await waitState('theme harbor', value => value.theme === 'harbor');
    assert.notEqual(themed.background, dark.background, `${label}: the theme changes --background`);
    await click('[data-ds-mode=light]');
    const light = await waitState('light harbor', value => value.dark === false && value.theme === 'harbor');
    assert.notEqual(light.background, themed.background);
    assert.notEqual(light.background, first.background, `${label}: harbor light differs from default light`);
    // The shell reads in every theme and mode (4.5:1), including a theme that sets only two roles.
    for (const theme of ['default', 'harbor', 'partial']) {
      for (const mode of ['light', 'dark']) {
        await click(`[data-ds-theme=${theme}]`);
        await click(`[data-ds-mode=${mode}]`);
        await waitState(`${theme} ${mode}`, value => value.theme === theme && value.dark === (mode === 'dark'));
        const ratio = await shell(SHELL_CONTRAST);
        assert.ok(ratio >= 4.5, `${label}: shell text in ${theme} ${mode} measures ${Number(ratio).toFixed(2)}:1`);
      }
    }
    await click('[data-ds-mode=light]');
    await click('[data-ds-theme=default]');
    const back = await waitState('theme default', value => value.theme === 'default' && value.dark === false);
    assert.equal(back.background, first.background, `${label}: switching back restores the default`);
  };

  /** Every shadcn/ui export is rendered by its real component: the slots found in the frame and in each cell frame, merged, leave nothing uncovered. Needs a same-origin frame. */
  const checkCoverage = async (label, seen) => {
    const slots = { ...seen.slots };
    for (let index = 0; index < seen.cells; index++) {
      const cell = `document.querySelector("iframe[data-ds-frame]").contentDocument.querySelectorAll("iframe[data-ds-cell]")[${index}]`;
      const deadline = Date.now() + 30000;
      while (!(await browser.evaluate(`!!${cell}.contentDocument.querySelector('[data-slot=alert-dialog-content]')`).catch(() => false))) {
        if (Date.now() > deadline) {
          const seen = await browser.evaluate(`(() => { const doc = ${cell}.contentDocument; return doc ? doc.location.href + ' | ' + doc.body.innerHTML.slice(0, 600) : 'no document'; })()`).catch(error => String(error));
          throw new Error(`${label} cell ${index} shows no alert dialog: ${seen}\n${browser.problems.join('\n')}`);
        }
        await pause(200);
      }
      Object.assign(slots, await browser.evaluate(`(() => { const win = ${cell}.contentWindow; return win.eval(${JSON.stringify(RENDERED_SLOTS)}); })()`));
    }
    problems.push(...uncovered(expected, slots).map(line => `${label}: ${line}`));
  };

  try {
    // 1. Over http and over file://: every section, numeric contrast, the three toggles.
    for (const [label, url] of [['http', `${origin}/harbor/index.html`], ['file', pathToFileURL(join(harbor, 'index.html')).href]]) {
      await browser.send('Page.navigate', { url });
      await browser.until(`${label} shell`, `document.querySelector('iframe[data-ds-frame]') !== null`);
      await untilIn(`${label} sections`, READY);
      const seen = await inFrame(INSPECT);
      checkSections(label, seen);
      if (label === 'http') await checkCoverage(label, seen);
      await drive(label, { shell: expression => browser.evaluate(expression) });
    }

    // 2. A sandboxed iframe, no allow-same-origin (opaque origin): storage throws, the toggles still work, and the page needs no parent or contentDocument access.
    await browser.send('Page.navigate', { url: `${origin}/host.html` });
    await browser.until('host', `document.querySelector('#sandboxed') !== null`);
    const SHELL = 'document.querySelector("#sandboxed")';
    await untilIn('sandboxed shell', `document.querySelector('[data-ds-section=header]') !== null && document.querySelector('iframe[data-ds-frame]') !== null`, SHELL);
    const storage = await inFrame(`(() => { try { localStorage.getItem('x'); return 'works'; } catch { return 'throws'; } })()`, SHELL);
    assert.equal(storage, 'throws', 'the sandboxed page has no storage, so the test is the real case');
    await drive('sandboxed', { shell: expression => inFrame(expression, SHELL) });
    const sandboxed = await inFrame(`(async () => { const raw = JSON.parse(document.querySelector('[data-ds-applied]').dataset.dsApplied); return raw; })()`, SHELL);
    assert.equal(sandboxed.sections, 5);

    // 3. A token changed in theme.derived.css moves the page with no page edit: muted text on the background reads 1.0:1 and is marked.
    await browser.send('Page.navigate', { url: `${origin}/derived/index.html` });
    await browser.until('derived shell', `document.querySelector('iframe[data-ds-frame]') !== null`);
    await untilIn('derived sections', READY);
    const moved = await inFrame(INSPECT);
    assert.ok(Number(moved.mutedLight) < 1.5, `muted-foreground on background measures ${moved.mutedLight} after the change`);
    await browser.send('Page.navigate', { url: `${origin}/site/index.html` });
    await browser.until('site shell', `document.querySelector('iframe[data-ds-frame]') !== null`);
    await untilIn('site sections', READY);
    const original = await inFrame(INSPECT);
    assert.ok(Number(original.mutedLight) >= 4.5, `muted-foreground on background measures ${original.mutedLight} unchanged`);
    // A surface with an alpha is composited over what lies under it: black text on 50% white over black is about 5.3:1 (over white it would be 21:1).
    const alpha = await browser.evaluate(`${FRAME}.contentWindow.boringDsContrast('black', 'rgb(255 255 255 / 50%)', ['black'])`); // the page's own world (an isolated world has no page globals)
    assert.ok(alpha > 5 && alpha < 5.6, `alpha contrast composites over the surface behind: ${alpha}`);

    // 4. Shots: the sections at 390 (touch) and 1280, light and dark, the whole frame page tall; and the header with its frame.
    if (shots) {
      for (const [width, mobile] of [[1280, false], [390, true]]) {
        for (const mode of ['light', 'dark']) {
          await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
          await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
          // A hash-only change from /site/index.html is a same-document navigation, so leave the page first.
          await browser.send('Page.navigate', { url: 'about:blank' });
          await browser.send('Page.navigate', { url: `${origin}/site/index.html#frame=1&mode=${mode}&theme=default` });
          await browser.until('frame page', READY);
          await pause(400);
          const height = await browser.evaluate('Math.min(document.documentElement.scrollHeight, 14000)');
          await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
          await pause(400);
          await browser.screenshot(`design-system-${width}-${mode}.png`);
        }
      }
      await browser.send('Emulation.clearDeviceMetricsOverride');
      for (const [theme, mode] of [['harbor', 'dark'], ['partial', 'dark'], ['partial', 'light']]) {
        await browser.send('Page.navigate', { url: 'about:blank' });
        await browser.send('Page.navigate', { url: `${origin}/harbor/index.html#mode=${mode}&theme=${theme}` });
        await untilIn(`header shot ${theme} ${mode}`, READY);
        await browser.screenshot(`design-system-header-${theme}-${mode}.png`);
      }
      writeFileSync(join(shots, 'design-system-measurements.json'), JSON.stringify({ original: { muted: original.mutedLight, foreground: original.foregroundLight }, changedToken: { muted: moved.mutedLight }, steps: original.steps, heights: original.heights }, null, 1));
    }
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
