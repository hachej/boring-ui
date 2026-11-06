import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// D-1717: status text on its soft fill reaches 4.5:1 in the published theme, light and dark, on the default
// core and on an indigo core. Values come from registry.json (and its built copy in public/r), not from a copy.
const registry = JSON.parse(readFileSync(new URL('../../registry.json', import.meta.url), 'utf8'));
const theme = registry.items.find(item => item.name === 'theme').cssVars;
const published = JSON.parse(readFileSync(new URL('../../public/r/theme.json', import.meta.url), 'utf8')).cssVars;
const STATUSES = ['warning', 'success', 'info', 'destructive'];
const MINIMUM = 4.5;

// oklch(L C H) -> oklab triple; `%` lightness accepted.
function oklch(value) {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  assert.ok(m, `not an oklch colour: ${value}`);
  const lightness = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  const hue = (parseFloat(m[3]) * Math.PI) / 180;
  return [lightness, parseFloat(m[2]) * Math.cos(hue), parseFloat(m[2]) * Math.sin(hue)];
}

// Resolve a theme value to oklab: oklch literals, var(--x), and color-mix(in oklab, A p%, B).
function resolve(value, table) {
  value = value.trim();
  if (value.startsWith('oklch(')) return oklch(value);
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  if (reference) return resolve(table[reference[1]], table);
  const mix = /^color-mix\(in oklab, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)$/.exec(value);
  assert.ok(mix, `unsupported value: ${value}`);
  const share = Number(mix[2]) / 100;
  const first = resolve(table[mix[1]], table);
  const second = resolve(table[mix[3]], table);
  return first.map((channel, index) => share * channel + (1 - share) * second[index]);
}

function luminance([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const [r, g, bl] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(channel => Math.max(0, Math.min(1, channel)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

const ratio = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

// The indigo core is Compta's (Factory build/test-template-default-style.mjs): only background, foreground and
// primary are published there, so card follows background. Status colours stay the theme's own.
const indigo = {
  light: { background: 'oklch(1.00000 0 0)', foreground: 'oklch(0.20912 0.01038 268.187)' },
  dark: { background: 'oklch(0.18588 0.00690 258.370)', foreground: 'oklch(0.94591 0.00289 264.542)' },
};
const cores = {
  default: (mode, table) => table,
  indigo: (mode, table) => ({ ...table, ...indigo[mode], card: indigo[mode].background }),
};

export function measure(vars) {
  const rows = [];
  for (const core of Object.keys(cores)) for (const mode of ['light', 'dark']) {
    const table = cores[core](mode, vars[mode]);
    for (const status of STATUSES) {
      const value = ratio(resolve(table[`${status}-soft-foreground`], table), resolve(table[`${status}-soft`], table));
      rows.push({ core, mode, status, ratio: value });
    }
  }
  return rows;
}

test('registry theme: status soft-foreground on soft reaches 4.5:1 (4 statuses x 2 modes x 2 cores)', () => {
  const rows = measure(theme);
  assert.equal(rows.length, 16);
  if (process.env.SHOW_CONTRAST) for (const r of rows) console.log(`${r.core} ${r.mode} ${r.status} ${r.ratio.toFixed(2)}`);
  const failing = rows.filter(r => r.ratio < MINIMUM).map(r => `${r.core} ${r.mode} ${r.status} ${r.ratio.toFixed(2)}`);
  assert.deepEqual(failing, [], `status text on its soft fill is under ${MINIMUM}:1`);
});

test('the built public/r theme carries the same status soft-foreground values as registry.json', () => {
  for (const mode of ['light', 'dark']) for (const status of STATUSES) {
    assert.equal(published[mode][`${status}-soft-foreground`], theme[mode][`${status}-soft-foreground`], `${mode} ${status}`);
  }
});

test('destructive keeps a visible red share; the other statuses use the template mix', () => {
  for (const [mode, share] of [['light', 75], ['dark', 55]]) {
    for (const status of ['success', 'warning', 'info']) {
      assert.equal(theme[mode][`${status}-soft-foreground`], `color-mix(in oklab, var(--${status}) ${share}%, var(--foreground))`);
    }
    assert.equal(theme[mode]['destructive-soft-foreground'], 'color-mix(in oklab, var(--destructive) 85%, var(--foreground))');
  }
});

test('every status soft fill, in every mode, is a color-mix over var(--card)', () => {
  for (const mode of ['light', 'dark']) for (const status of STATUSES) {
    assert.match(theme[mode][`${status}-soft`], /^color-mix\(in oklab, var\(--[\w-]+\) \d+%, var\(--card\)\)$/, `${mode} ${status}-soft`);
  }
});
