import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_ROLES } from '../../packages/ui/bin/boring-ui-blocks.mjs';
import { DATA_PREFIX, buildDesignSystem } from '../../scripts/build-design-system.mjs';

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

/** The components the page renders: the names its demos mark with data-ds-component (the Chromium test reads the same marks off the running page). */
function renderedByDemos() {
  const text = readFileSync(join(root, 'lab/design-system/components.jsx'), 'utf8');
  return new Set([...text.matchAll(/names="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
}

const REQUIRED = ['Button', 'Badge', 'Input', 'Select', 'Textarea', 'Checkbox', 'Switch', 'Tabs', 'Table', 'Card', 'Field', 'Dialog', 'Sheet', 'Toaster'];

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
  // The named demos exist, and every other export is listed on the page rather than dropped.
  const shown = renderedByDemos();
  assert.deepEqual(REQUIRED.filter(name => !shown.has(name)), []);
});

test('The page has no fetch and no storage, and its data is a script (it works on file:// and from an opaque origin)', async () => {
  const out = join(work, 'plain');
  await buildDesignSystem(root, { outDir: out });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /<script src="data\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  assert.ok(!/\btype="module"/.test(html), 'a module script does not load from file://');
  const data = readFileSync(join(out, 'data.js'), 'utf8');
  assert.ok(data.startsWith(DATA_PREFIX));
  for (const file of readdirSync(join(root, 'lab/design-system')).filter(name => /\.(jsx?|html)$/.test(name))) {
    const text = readFileSync(join(root, 'lab/design-system', file), 'utf8');
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
  const bad = [['plain.css', 'body { color: red; }'], ['import.css', '@import url(https://example.test/x.css);\n:root { --background: red; }'], ['open.css', ':root { --background: red;']];
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
