import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { CORE_ROLES } from '../../packages/ui/bin/boring-ui-blocks.mjs';
import { DATA_PREFIX, buildDesignSystem } from '../../scripts/build-design-system.mjs';

// D-1888: a real Chromium opens the built design-system page over file:// and over http, in a sandboxed iframe with an opaque origin (how Factory shows it) and
// drives the three toggles. Every section renders, the contrast figures are numbers measured from the painted colours, dark switching changes --background, and a
// changed token in a copy of theme.derived.css changes the page with no page edit. Set EVIDENCE_DIR to also write the shots (390 and 1280, light and dark).
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const REQUIRED = ['Button', 'Badge', 'Input', 'Select', 'Textarea', 'Checkbox', 'Switch', 'Tabs', 'Table', 'Card', 'Field', 'Dialog', 'Sheet', 'Toaster'];
const FRAME = 'document.querySelector("iframe[data-ds-frame]")';
const dataOf = dir => JSON.parse(readFileSync(join(dir, 'data.js'), 'utf8').slice(DATA_PREFIX.length).replace(/;\s*$/, ''));
const pause = ms => new Promise(done => setTimeout(done, ms));

function sourceExports() {
  const found = new Set();
  for (const name of readdirSync(join(root, 'shadcn/ui')).filter(file => file.endsWith('.tsx'))) {
    for (const block of readFileSync(join(root, 'shadcn/ui', name), 'utf8').matchAll(/^export \{([^}]*)\}/gm)) {
      for (const item of block[1].split(',').map(text => text.trim().split(/\s+as\s+/).at(-1)).filter(Boolean)) if (/^[A-Z]/.test(item)) found.add(item);
    }
  }
  return found;
}

/** Reads what the frame shows. It runs inside the frame, so it works from an opaque origin too. */
const INSPECT = `(() => {
  const all = selector => [...document.querySelectorAll(selector)];
  const overlays = all('[data-ds-bounded]').map(box => {
    const id = box.dataset.dsBounded, popup = document.querySelector('[data-ds-overlay="' + id + '"]');
    const outer = box.getBoundingClientRect(), inner = popup && popup.getBoundingClientRect();
    return { id, inside: !!inner && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1 && inner.left >= outer.left - 1 && inner.right <= outer.right + 1, popup: inner && inner.height, box: outer.height };
  });
  return {
    sections: all('[data-ds-section]').map(node => node.dataset.dsSection),
    roles: all('[data-ds-role]').map(node => node.dataset.dsRole),
    swatches: all('[data-ds-swatch]').length,
    ratios: all('[data-ds-contrast]').map(node => node.dataset.ratio),
    pairs: all('[data-ds-pair]').length,
    rendered: [...new Set(all('[data-ds-component]').flatMap(node => node.dataset.dsComponent.split(/\\s+/)))],
    listed: all('[data-ds-listed]').map(node => node.dataset.dsListed),
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
  const added = spawnSync(process.execPath, [join(kit, 'bin/boring-ui-blocks.mjs'), 'design-system', '--out', harbor, '--theme', `harbor=${harborCss}`], { encoding: 'utf8' });
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
  const READY = `document.querySelectorAll('[data-ds-listed-block]').length === 1 && document.querySelectorAll('[data-ds-bounded] [data-ds-overlay]').length === 6 && document.querySelectorAll('[data-ds-contrast]').length > 0 && [...document.querySelectorAll('[data-ds-contrast]')].every(node => node.dataset.ratio)`;
  const exports = sourceExports();

  const checkSections = (label, seen) => {
    for (const name of ['colors', 'type', 'shape', 'density', 'components']) if (!seen.sections.includes(name)) problems.push(`${label}: section ${name} is missing`);
    const roles = new Set(seen.roles);
    for (const name of CORE_ROLES) if (!roles.has(name)) problems.push(`${label}: role ${name} is not drawn`);
    if (seen.swatches < 2 * data.roles.filter(role => role.kind === 'color').length) problems.push(`${label}: ${seen.swatches} swatches`);
    if (seen.pairs !== data.pairs.length || seen.ratios.length !== 2 * data.pairs.length) problems.push(`${label}: ${seen.ratios.length} contrast figures for ${data.pairs.length} pairs`);
    if (!seen.ratios.every(ratio => /^\d+\.\d\d$/.test(ratio))) problems.push(`${label}: a contrast figure is not a number: ${seen.ratios.filter(ratio => !/^\d+\.\d\d$/.test(ratio))}`);
    if (!(Number(seen.foregroundLight) > 7 && Number(seen.foregroundDark) > 7)) problems.push(`${label}: foreground on background measures ${seen.foregroundLight} light and ${seen.foregroundDark} dark`);
    const rendered = new Set(seen.rendered), listed = new Set(seen.listed);
    for (const name of REQUIRED) if (!rendered.has(name)) problems.push(`${label}: ${name} is not rendered`);
    for (const name of exports) if (!rendered.has(name) && !listed.has(name)) problems.push(`${label}: export ${name} is neither rendered nor listed`);
    if (seen.steps.length !== data.textSteps.length || !seen.steps.every(text => /^\d+(\.\d+)?px \/ \S+/.test(text))) problems.push(`${label}: text steps ${JSON.stringify(seen.steps)}`);
    if (seen.heights.fine !== '36px' || seen.heights.touch !== '44px') problems.push(`${label}: control heights ${JSON.stringify(seen.heights)}`);
    if (seen.radii !== data.radii.length || seen.shadows !== 4) problems.push(`${label}: ${seen.radii} radii, ${seen.shadows} shadows`);
    for (const frame of seen.overlays) if (!frame.inside) problems.push(`${label}: ${frame.id} is not inside its box`);
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
    await click('[data-ds-theme=default]');
    const back = await waitState('theme default', value => value.theme === 'default' && value.dark === false);
    assert.equal(back.background, first.background, `${label}: switching back restores the default`);
  };

  try {
    // 1. Over http and over file://: every section, numeric contrast, the three toggles.
    for (const [label, url] of [['http', `${origin}/harbor/index.html`], ['file', pathToFileURL(join(harbor, 'index.html')).href]]) {
      await browser.send('Page.navigate', { url });
      await browser.until(`${label} shell`, `document.querySelector('iframe[data-ds-frame]') !== null`);
      await untilIn(`${label} sections`, READY);
      checkSections(label, await inFrame(INSPECT));
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

    // 4. Shots: the sections at 390 (touch) and 1280, light and dark, the whole frame page tall; and the header with its frame.
    if (shots) {
      for (const [width, mobile] of [[1280, false], [390, true]]) {
        for (const mode of ['light', 'dark']) {
          await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
          await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
          // A hash-only change from /site/index.html is a same-document navigation, so leave the page first.
          await browser.send('Page.navigate', { url: 'about:blank' });
          await browser.send('Page.navigate', { url: `${origin}/site/index.html#frame=1&mode=${mode}&theme=default` });
          await browser.until('frame page', `document.querySelectorAll('[data-ds-bounded] [data-ds-overlay]').length === 6 && [...document.querySelectorAll('[data-ds-contrast]')].every(node => node.dataset.ratio)`);
          await pause(400);
          const height = await browser.evaluate('Math.min(document.documentElement.scrollHeight, 14000)');
          await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
          await pause(400);
          await browser.screenshot(`design-system-${width}-${mode}.png`);
        }
      }
      await browser.send('Emulation.clearDeviceMetricsOverride');
      await browser.send('Page.navigate', { url: `${origin}/harbor/index.html#mode=dark&theme=harbor` });
      await untilIn('header shot', READY);
      await browser.screenshot('design-system-header-harbor-dark.png');
      writeFileSync(join(shots, 'design-system-measurements.json'), JSON.stringify({ original: { muted: original.mutedLight, foreground: original.foregroundLight }, changedToken: { muted: moved.mutedLight }, steps: original.steps, heights: original.heights }, null, 1));
    }
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
