import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const kit = name => join(root, 'packages/ui/styles', name);

// A core that pins two derived roles on purpose (the EXCEPTIONS block), in light and in dark.
const core = `:root { --foreground: #111; --background: #fff; --card: #fff; --primary: #36c; --radius: 0.5rem; }
.dark { --foreground: #eee; --background: #111; --card: #181818; }
/* EXCEPTIONS */
:root { --muted-foreground: oklch(0.41 0.01 250); --destructive-soft: oklch(0.95 0.03 25); }
.dark { --muted-foreground: oklch(0.76 0.01 250); --destructive-soft: oklch(0.3 0.08 25); }
`;

async function build(order) {
  const index = `@import "tailwindcss";\n${order.map(name => `@import "${name}";`).join('\n')}\n`;
  const compiler = await compile(index, { base: root, loadStylesheet: async (id, base) => {
    if (id === 'tailwindcss') { const path = require.resolve('tailwindcss/index.css'); return { path, base: dirname(path), content: readFileSync(path, 'utf8') }; }
    if (id === './theme.core.css') return { path: join(base, id), base, content: core };
    const file = id.replace('@hachej/boring-ui-kit/', '');
    return { path: kit(file), base: dirname(kit(file)), content: readFileSync(kit(file), 'utf8') };
  } });
  return compiler.build(['rounded-md', 'text-link']);
}

// The value a selector ends up with: the last declaration in a rule whose selector list is exactly that selector (same specificity, later wins).
function winner(css, selector, name) {
  let value;
  // Tailwind adds a plain fallback and a nested @supports for color-mix; flatten it so the later declaration (the colour-mix one) is read last.
  const flat = css.replace(/@supports[^{]*\{([^{}]*)\}/g, '$1');
  for (const [, selectors, body] of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').map(s => s.trim()).includes(selector)) continue;
    for (const [, prop, val] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) if (prop === name) value = val.trim();
  }
  return value;
}

const right = ['@hachej/boring-ui-kit/app.css', '@hachej/boring-ui-kit/theme.derived.css', './theme.core.css'];

test('the kit ships theme.derived.css, exported, with its header', () => {
  assert.equal(JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports['./theme.derived.css'], './styles/theme.derived.css');
  assert.ok(existsSync(kit('theme.derived.css')), 'packages/ui/styles/theme.derived.css exists');
  assert.match(readFileSync(kit('theme.derived.css'), 'utf8'), /an app imports it and keeps no copy/);
});

test('core last: pinned roles win in light and dark, unpinned roles get the derived value', async () => {
  assert.ok(existsSync(kit('theme.derived.css')), 'packages/ui/styles/theme.derived.css exists');
  const css = await build(right);
  assert.equal(winner(css, ':root', '--muted-foreground'), 'oklch(0.41 0.01 250)');
  assert.equal(winner(css, '.dark', '--muted-foreground'), 'oklch(0.76 0.01 250)');
  assert.equal(winner(css, ':root', '--destructive-soft'), 'oklch(0.95 0.03 25)');
  assert.equal(winner(css, '.dark', '--destructive-soft'), 'oklch(0.3 0.08 25)');
  assert.equal(winner(css, ':root', '--input'), 'color-mix(in oklab, var(--border) 65%, var(--foreground))');
  assert.equal(winner(css, '.dark', '--input'), 'color-mix(in oklab, var(--border) 75%, var(--foreground))');
  assert.equal(winner(css, ':root', '--success-soft'), 'color-mix(in oklab, var(--success) 14%, var(--card))');
  assert.match(css, /border-radius:\s*calc\(var\(--radius\) \* 0\.8\)/, 'the @theme inline radius scale is inlined into utilities');
});

test('reversed order (derived after core) loses the pins', async () => {
  const css = await build([right[0], right[2], right[1]]);
  assert.notEqual(winner(css, ':root', '--muted-foreground'), 'oklch(0.41 0.01 250)');
  assert.notEqual(winner(css, '.dark', '--destructive-soft'), 'oklch(0.3 0.08 25)');
});
