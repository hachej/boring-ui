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

// D-1722: in dark, destructive's soft fill reads as red, not as another amber/grey: its chroma is at least 1.5x
// warning-soft's, on both cores. The share is capped by the 4.5:1 text contrast above (28% fails on the default core).
test('registry theme: dark destructive-soft has at least 1.5x the chroma of warning-soft (both cores)', () => {
  for (const core of Object.keys(cores)) {
    const table = cores[core]('dark', theme.dark);
    const chroma = status => Math.hypot(...resolve(table[`${status}-soft`], table).slice(1));
    const [red, amber] = [chroma('destructive'), chroma('warning')];
    if (process.env.SHOW_CONTRAST) console.log(`chroma ${core} destructive ${red.toFixed(4)} warning ${amber.toFixed(4)} x${(red / amber).toFixed(2)}`);
    assert.ok(red >= 1.5 * amber, `${core}: destructive-soft chroma ${red.toFixed(4)} is under 1.5x warning-soft ${amber.toFixed(4)} (x${(red / amber).toFixed(2)})`);
  }
});

// D-1723: the field edge (--input) reaches 3:1 (WCAG 1.4.11) against card and against canvas (--background),
// light and dark, default and indigo cores. Dark --border carries alpha, so: color-mix in oklab is premultiplied,
// then the result is composited over the surface in gamma-encoded sRGB, as browsers do.
const EDGE_MINIMUM = 3;
const EDGE_VALUE = { light: 'color-mix(in oklab, var(--border) 65%, var(--foreground))', dark: 'color-mix(in oklab, var(--border) 75%, var(--foreground))' };

function alphaOf(value) {
  const m = /\/\s*([\d.]+)(%?)\s*\)$/.exec(value.trim());
  return m ? (m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1])) : 1;
}

// -> { lab, alpha } with straight (not premultiplied) lab.
function resolveAlpha(value, table) {
  value = value.trim();
  if (value.startsWith('oklch(')) return { lab: oklch(value), alpha: alphaOf(value) };
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  if (reference) return resolveAlpha(table[reference[1]], table);
  const mix = /^color-mix\(in oklab, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)$/.exec(value);
  assert.ok(mix, `unsupported value: ${value}`);
  const share = Number(mix[2]) / 100;
  const first = resolveAlpha(table[mix[1]], table);
  const second = resolveAlpha(table[mix[3]], table);
  const alpha = share * first.alpha + (1 - share) * second.alpha;
  const lab = first.lab.map((channel, index) => (share * first.alpha * channel + (1 - share) * second.alpha * second.lab[index]) / alpha);
  return { lab, alpha };
}

const gamma = linear => (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
function srgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(channel => gamma(Math.max(0, Math.min(1, channel))));
}
const relative = rgb => {
  const [r, g, b] = rgb.map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function measureEdge(vars, input = vars) {
  const rows = [];
  for (const core of Object.keys(cores)) for (const mode of ['light', 'dark']) {
    const table = cores[core](mode, vars[mode]);
    const edge = resolveAlpha(input[mode].input, table);
    const edgeRgb = srgb(edge.lab);
    for (const surface of ['card', 'background']) {
      const under = srgb(resolveAlpha(table[surface], table).lab);
      const shown = edgeRgb.map((channel, index) => edge.alpha * channel + (1 - edge.alpha) * under[index]);
      const [hi, lo] = [relative(shown), relative(under)].sort((p, q) => q - p);
      rows.push({ core, mode, surface, ratio: (hi + 0.05) / (lo + 0.05) });
    }
  }
  return rows;
}

test('registry theme: the --input field edge reaches 3:1 on card and canvas (2 modes x 2 cores x 2 surfaces)', () => {
  const rows = measureEdge(theme);
  assert.equal(rows.length, 8);
  if (process.env.SHOW_CONTRAST) for (const r of rows) console.log(`edge ${r.core} ${r.mode} on ${r.surface} ${r.ratio.toFixed(2)}`);
  const failing = rows.filter(r => r.ratio < EDGE_MINIMUM).map(r => `${r.core} ${r.mode} ${r.surface} ${r.ratio.toFixed(2)}`);
  assert.deepEqual(failing, [], `the field edge is under ${EDGE_MINIMUM}:1`);
});

test('the built public/r theme pins --input to the registry value; --border stays', () => {
  for (const mode of ['light', 'dark']) {
    assert.equal(theme[mode].input, EDGE_VALUE[mode], `registry ${mode}`);
    assert.equal(published[mode].input, EDGE_VALUE[mode], `public/r ${mode}`);
  }
  assert.equal(theme.light.border, 'oklch(0.87 0 0)');
  assert.equal(theme.dark.border, 'oklch(1 0 0 / 16%)');
});
