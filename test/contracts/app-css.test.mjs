import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const kitCss = join(root, 'packages/ui/styles/app.css');

// The Factory maps `@hachej/boring-ui-kit/<file>` to packages/ui/styles/<file>; a fixture theme stands in for theme.core.css.
const themeCore = ':root { --primary: oklch(0.5 0.2 30); --text-body: 0.8125rem; --shell: oklch(0.5 0 0); }\n.dark { --primary: oklch(0.8 0.1 30); }\n';
const index = `@import "tailwindcss";
@import "@hachej/boring-ui-kit/app.css";
@import "./theme.core.css";
`;

async function build(candidates) {
  const compiler = await compile(index, { base: root, loadStylesheet: async (id, base) => {
    if (id === 'tailwindcss') { const path = require.resolve('tailwindcss/index.css'); return { path, base: dirname(path), content: readFileSync(path, 'utf8') }; }
    if (id === '@hachej/boring-ui-kit/app.css') return { path: kitCss, base: dirname(kitCss), content: readFileSync(kitCss, 'utf8') };
    if (id === './theme.core.css') return { path: join(base, id), base, content: themeCore };
    throw new Error(`unexpected import ${id}`);
  } });
  return compiler.build(candidates);
}

test('an older overlay with an unconditional backdrop-blur-xs: no blur without the attribute, blur with "on"', async () => {
  const css = await build(['backdrop-blur-xs']);
  const flat = css.replace(/\s+/g, ' ');
  const util = flat.indexOf('.backdrop-blur-xs');
  const off = flat.indexOf(':root:not([data-overlay-blur="on"]) :is(');
  const on = flat.indexOf(':root[data-overlay-blur="on"] :is(');
  assert.ok(util >= 0, 'the utility is generated');
  // Both rules are (0,3,0), above the single-class (0,1,0) utility, so they win whatever the order: the default is none, "on" is blur.
  assert.ok(off >= 0 && on >= 0, 'both overlay rules are in the built CSS');
  assert.match(flat.slice(off, flat.indexOf('}', off)), /backdrop-filter: none/);
  assert.match(flat.slice(on, flat.indexOf('}', on)), /backdrop-filter: blur\(var\(--overlay-blur, 4px\)\)/);
});

test('app.css is exported by the kit and says apps import it', () => {
  assert.equal(JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports['./app.css'], './styles/app.css');
  assert.ok(existsSync(kitCss), 'packages/ui/styles/app.css exists');
  assert.match(readFileSync(kitCss, 'utf8'), /never copy it/);
});

test('an app index.css of imports + app.css + a theme file: theme wins, scale, map and resets are present', async () => {
  assert.ok(existsSync(kitCss), 'packages/ui/styles/app.css exists');
  const css = await build(['text-xs', 'text-sm', 'bg-primary', 'bg-shell', 'text-muted-foreground', 'dark:bg-card', 'font-medium']);
  assert.match(css, /--text-xs:\s*var\(--text-body\)/, 'type scale reads the theme token');
  assert.match(css, /--text-sm:\s*var\(--text-title\)/);
  assert.match(css, /background-color:\s*var\(--primary\)/, 'colour map reads the theme variable');
  assert.match(css, /--primary:\s*oklch\(0\.5 0\.2 30\)/, 'theme token present');
  assert.ok(css.indexOf('--shell: var(--background)') < css.indexOf('--shell: oklch(0.5 0 0)'), 'theme --shell comes after the kit default, so it wins');
  assert.match(css, /--text-body:\s*0\.8125rem/);
  assert.match(css, /:is\(\.dark \*\)/, 'dark variant');
  assert.match(readFileSync(kitCss, 'utf8'), /@keyframes pi-chat-shimmer[\s\S]*@keyframes pi-chat-caret/);
  assert.match(css, /\.app-shell :where\(button/);
  assert.match(css, /\.pi-chat \[hidden\]/);
  assert.match(css, /\[data-boring="feedback"\] :where\(button/);
  assert.match(css, /:root:not\(\[data-overlay-blur="on"\]\) :is\([^)]*\) \{\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/, 'default: no overlay blur');
  assert.match(css, /:root\[data-overlay-blur="on"\] :is\([^)]*\) \{\s*-webkit-backdrop-filter: blur\(var\(--overlay-blur, 4px\)\)/, 'opt-in: blur by --overlay-blur');
  assert.match(css, /--duration-normal:\s*150ms/);
});
