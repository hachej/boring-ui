import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { CORE_ROLES, themeFileProblem } from '../../packages/ui/bin/boring-ui-blocks.mjs';
import { DATA_PREFIX, buildDesignSystem, cvaVariants } from '../../scripts/build-design-system.mjs';
import { layerTheme } from '../../lab/design-system/layers.mjs';
import { RENDERED_SLOTS, slotExpectations, uncovered } from './design-system-slots.mjs';

// D-1888: the kit builds a design-system page (packages/ui/design-system/) from the real components, tokens and rule data. This test needs no browser: it builds the
// page into a temp folder and checks that what the page is made of covers the sources it claims to show (a colour role or a shadcn/ui export that the build
// missed fails here), that no page code fetches or stores, and that `boring-ui-blocks design-system` adds a theme and refuses a file that is not a theme.
// The rendering (sections, contrast figures, toggles, a sandboxed frame) is design-system-page-browser.test.mjs.
const root = fileURLToPath(new URL('../../', import.meta.url));
mkdirSync(join(root, '.cache'), { recursive: true });
const work = mkdtempSync(join(root, '.cache/design-system-page-'));
const dataOf = dir => JSON.parse(readFileSync(join(dir, 'data.js'), 'utf8').slice(DATA_PREFIX.length).replace(/;\s*$/, ''));

/** The exports of the kit's shadcn/ui files, read from the sources (a component is a capitalised name in `export { ... }`). */
function sourceExports() {
  const found = new Set();
  for (const name of readdirSync(join(root, 'shadcn/ui')).filter(file => file.endsWith('.tsx'))) {
    for (const block of readFileSync(join(root, 'shadcn/ui', name), 'utf8').matchAll(/^export \{([^}]*)\}/gm)) {
      for (const item of block[1].split(',').map(text => text.trim().split(/\s+as\s+/).at(-1)).filter(Boolean)) if (/^[A-Z]/.test(item)) found.add(item);
    }
  }
  return found;
}

/** What the page lacks: roles missing from its data, exports neither shown nor listed. */
function missing(data, { roles, exports }) {
  const have = new Set(data.roles.map(role => role.name));
  const listed = new Set(Object.values(data.components).flatMap(file => file.exports));
  return [...roles.filter(name => !have.has(name)).map(name => `role ${name}`), ...[...exports].filter(name => !listed.has(name)).map(name => `component ${name}`)];
}

/** The components the page renders: the names its demos mark (names="..." on a Demo, data-ds-cell-names on a cell); the Chromium test reads the same marks off the running page. */
function renderedByDemos() {
  const dir = join(root, 'lab/design-system');
  const text = readdirSync(dir).filter(file => file.endsWith('.jsx')).map(file => readFileSync(join(dir, file), 'utf8')).join('\n');
  return new Set([...text.matchAll(/(?:names|data-ds-cell-names)="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
}

/** Runs the built page in happy-dom at a hash; returns the demo errors and the slots found inside each marked demo. */
async function renderedSlots(out, hash) {
  const window = new Window({ url: `http://localhost/index.html${hash}`, width: 1280, height: 900 });
  window.document.write('<!doctype html><html><head><style id="ds-theme"></style></head><body><div id="root"></div></body></html>');
  window.eval(readFileSync(join(out, 'data.js'), 'utf8'));
  window.eval(readFileSync(join(out, 'app.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 600));
  const errors = [...window.document.querySelectorAll('[data-ds-error]')].map(node => node.textContent);
  const found = window.eval(RENDERED_SLOTS);
  await window.happyDOM.close();
  return { errors, found };
}

test('The built page covers every colour role and every shadcn/ui export, and its checker fails when one is missing', async () => {
  const out = join(work, 'built');
  const { data } = await buildDesignSystem(root, { outDir: out });
  for (const file of ['index.html', 'app.js', 'app.css', 'data.js', 'themes/default.css']) assert.ok(existsSync(join(out, file)), `${file} is built`);
  const exports = sourceExports();
  assert.ok(exports.size > 40, `the source scan finds the components (${exports.size})`);
  assert.deepEqual(missing(dataOf(out), { roles: CORE_ROLES, exports }), []);
  assert.deepEqual(data.roles.map(role => role.name), [...CORE_ROLES]);
  // Fail first: the checker names a dropped role and a dropped export.
  const dropped = structuredClone(dataOf(out));
  dropped.roles = dropped.roles.filter(role => role.name !== 'primary');
  dropped.components.button.exports = [];
  assert.deepEqual(missing(dropped, { roles: CORE_ROLES, exports }), ['role primary', 'component Button']);
  // Every export is named by a demo (a demo is where the next test finds its real output).
  const shown = renderedByDemos();
  assert.deepEqual([...exports].filter(name => !shown.has(name)), []);
});

test('Every demo renders its components for real: the data-slot output of each export is inside the demo that names it', async () => {
  const out = join(work, 'slots');
  await buildDesignSystem(root, { outDir: out });
  const page = await renderedSlots(out, '#frame=1');
  const cell = await renderedSlots(out, '#frame=1&cell=alertdialog-default');
  assert.deepEqual([...page.errors, ...cell.errors], [], 'no demo failed to render');
  const found = { ...page.found, ...cell.found };
  const expected = slotExpectations(root);
  assert.ok(expected.size > 100, `the expectations cover the sources (${expected.size})`);
  assert.deepEqual(uncovered(expected, found), []);
  // Fail first: an export named by a demo that shows none of its output is refused (a label or a listing instead of the component).
  const byName = structuredClone(found);
  byName.Button = ['not-a-button'];
  delete byName.Badge;
  const problems = uncovered(expected, byName);
  assert.deepEqual(problems.map(line => line.split(':')[0]), ['Badge', 'Button']);
  assert.match(problems[1], /rendered by name only/);
  // The toast is the kit's Toaster with real toasts in it.
  assert.ok(found.Toaster.includes('sonner-toaster'));
});

test('Theme layering: a theme that sets two roles keeps every default role, in both modes', () => {
  const defaults = ':root {\n  --background: white;\n  --card: ivory;\n  --foreground: black;\n}\n.dark {\n  --background: black;\n  --card: navy;\n  --foreground: white;\n}';
  const layered = layerTheme(defaults, ':root { --background: pink; --foreground: maroon; }');
  const light = layered.slice(0, layered.indexOf('.dark'));
  assert.match(light, /--card: ivory/, 'the light default card survives');
  assert.ok(light.indexOf('--background: white') < light.indexOf('--background: pink'), 'the app value comes after the default');
  assert.match(layered, /\.dark\s*\{[^}]*--card: navy/, 'the dark default card survives');
  assert.match(layered, /\.dark\s*\{[^}]*--background: black/, 'a theme without a .dark block keeps the default dark values');
  assert.ok(layered.lastIndexOf('.dark') > layered.indexOf('--background: pink'), 'dark blocks come last, so .dark beats the light selector list');
});

test('Variant parsing reads every key form of a cva block', () => {
  const source = `const fixtureVariants = cva("base", { variants: {
    tone: { default: "a", 'brand-new': "b", "double-quoted": "c", [\`template\`]: "d", ["computed"]: "e", 3: "f" },
    size: { sm: "a", lg: "b" },
  } });
  const second = cva("x", { variants: { shape: { round: "r" } } });`;
  assert.deepEqual(cvaVariants(source), [
    { name: 'fixtureVariants', groups: { tone: ['default', 'brand-new', 'double-quoted', 'template', 'computed', '3'], size: ['sm', 'lg'] } },
    { name: 'second', groups: { shape: ['round'] } },
  ]);
  assert.throws(() => cvaVariants('const x = cva("a", { variants: { tone: { [name]: "b" } } });', 'fixture.tsx'), /fixture\.tsx: a cva key is not a plain string/);
});

test('Theme files: only custom properties on :root and .dark are accepted, and a refusal names the line', () => {
  assert.equal(themeFileProblem(':root { --background: red; }\n.dark { --background: blue; }'), undefined);
  assert.equal(themeFileProblem(':root.dark { --background: red; }\n.dark:root { --foreground: red; }'), undefined);
  assert.match(themeFileProblem(':root{--background:red} body{display:none}'), /^line 1: selector "body"/);
  assert.match(themeFileProblem(':root { --background: red; }\n\nbody { display: none; }'), /^line 3: selector "body"/);
  assert.match(themeFileProblem('@import url(x.css);'), /^line 1: an @ rule/);
  assert.match(themeFileProblem(':root { --background: url(https://example.test/x); }'), /^line 1: /);
  assert.match(themeFileProblem(':root { color: red; }'), /^line 1: /);
  assert.match(themeFileProblem('.card { --background: red; }'), /^line 1: selector ".card"/);
});

test('The page has no fetch and no storage, and its data is a script (it works on file:// and from an opaque origin)', async () => {
  const out = join(work, 'plain');
  await buildDesignSystem(root, { outDir: out });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /<script src="data\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  assert.ok(!/\btype="module"/.test(html), 'a module script does not load from file://');
  const data = readFileSync(join(out, 'data.js'), 'utf8');
  assert.ok(data.startsWith(DATA_PREFIX));
  const sources = dir => readdirSync(join(root, dir), { withFileTypes: true }).filter(entry => entry.isFile() && /\.(jsx?|mjs|html)$/.test(entry.name)).map(entry => `${dir}/${entry.name}`);
  for (const file of [...sources('lab/design-system'), ...sources('lab/design-system/standins')]) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.ok(!/\b(fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|contentDocument|contentWindow\.document)/.test(text), `${file} uses no fetch, storage or parent/contentDocument access`);
  }
});

test('Data: the derived tokens a role feeds come from theme.derived.css, and a changed token changes the data with no page edit', async () => {
  const derived = readFileSync(join(root, 'packages/ui/styles/theme.derived.css'), 'utf8');
  const out = join(work, 'derived');
  const { data } = await buildDesignSystem(root, { outDir: out });
  const foreground = data.roles.find(role => role.name === 'foreground');
  assert.ok(foreground.feeds.includes('card-foreground'), 'foreground feeds card-foreground');
  assert.ok(data.pairs.some(pair => pair.fg === 'card-foreground' && pair.bg === 'card'));
  const changed = derived.replace('--secondary: var(--muted);', '--secondary: var(--accent);');
  assert.notEqual(changed, derived);
  const next = (await buildDesignSystem(root, { outDir: join(work, 'derived-2'), derivedCss: changed })).data;
  assert.ok(!next.roles.find(role => role.name === 'muted').feeds.includes('secondary'));
  assert.ok(next.roles.find(role => role.name === 'accent').feeds.includes('secondary'));
});

test('boring-ui-blocks design-system copies the page, adds a theme and refuses a file that is not a theme', async () => {
  const kit = join(work, 'kit');
  mkdirSync(join(kit, 'bin'), { recursive: true });
  copyFileSync(join(root, 'packages/ui/bin/boring-ui-blocks.mjs'), join(kit, 'bin/boring-ui-blocks.mjs'));
  await buildDesignSystem(root, { outDir: join(kit, 'design-system') });
  const run = (...args) => spawnSync(process.execPath, [join(kit, 'bin/boring-ui-blocks.mjs'), 'design-system', ...args], { encoding: 'utf8' });
  const theme = join(work, 'harbor.css');
  writeFileSync(theme, ':root {\n  --background: oklch(0.98 0.01 230);\n  --foreground: oklch(0.2 0.02 230);\n}\n.dark {\n  --background: oklch(0.2 0.02 230);\n}\n');
  const out = join(work, 'site');
  const added = run('--out', out, '--theme', `harbor=${theme}`);
  assert.equal(added.status, 0, added.stderr);
  const data = dataOf(out);
  assert.deepEqual(data.themes.map(entry => entry.name), ['default', 'harbor']);
  assert.match(readFileSync(join(out, 'themes/harbor.css'), 'utf8'), /--background: oklch\(0\.98/);
  assert.ok(existsSync(join(out, 'index.html')) && existsSync(join(out, 'app.js')));
  // Adding again replaces the entry; it does not duplicate it.
  assert.equal(run('--out', out, '--theme', `harbor=${theme}`).status, 0);
  assert.deepEqual(dataOf(out).themes.map(entry => entry.name), ['default', 'harbor']);
  // Refusals: not custom properties, an import, the reserved name, a missing file.
  const bad = [['plain.css', 'body { color: red; }'], ['mixed.css', ':root { --background: red; }\nbody { display: none; }'], ['import.css', '@import url(https://example.test/x.css);\n:root { --background: red; }'], ['open.css', ':root { --background: red;']];
  for (const [name, text] of bad) {
    const file = join(work, name);
    writeFileSync(file, text);
    const refused = run('--out', join(work, `refused-${name}`), '--theme', `bad=${file}`);
    assert.notEqual(refused.status, 0, `${name} is refused`);
    assert.ok(!existsSync(join(work, `refused-${name}`, 'themes/bad.css')), `${name} adds no theme`);
  }
  assert.notEqual(run('--out', join(work, 'reserved'), '--theme', `default=${theme}`).status, 0);
  assert.notEqual(run('--out', join(work, 'absent'), '--theme', `ghost=${join(work, 'nope.css')}`).status, 0);
});
