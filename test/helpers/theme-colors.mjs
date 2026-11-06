// The `theme` item's tokens as sRGB, for tests that judge surface contrast without a browser: `oklch()` values and
// `color-mix(in oklab, var(--a) N%, var(--b))` (the soft status fills) resolved in light and dark, WCAG contrast between them.
// (test/ui/pi-chat-surfaces.test.mjs keeps its own copy of the oklch part for the chat; this one is for the other blocks.)
import { readFileSync } from 'node:fs';

const theme = JSON.parse(readFileSync(new URL('../../registry.json', import.meta.url), 'utf8')).items.find(item => item.name === 'theme').cssVars;

/** The token's raw value in a mode (dark overrides light). */
export const raw = (token, mode) => (mode === 'dark' && theme.dark[token]) || theme.light[token];

/** A token as OKLab [L, a, b]: `oklch(L C H)` or `color-mix(in oklab, var(--x) N%, var(--y))`, following `var(--z)` references. */
export function oklab(token, mode) {
  const text = raw(token, mode);
  assertValue(text, token);
  const ref = /^var\(--([a-z-]+)\)$/.exec(text);
  if (ref) return oklab(ref[1], mode);
  const mix = /^color-mix\(in oklab, var\(--([a-z-]+)\) (\d+)%, var\(--([a-z-]+)\)\)$/.exec(text);
  if (mix) { const [x, y, share] = [oklab(mix[1], mode), oklab(mix[3], mode), Number(mix[2]) / 100]; return x.map((c, i) => share * c + (1 - share) * y[i]); }
  const lch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(text) ?? /^oklch\(([\d.]+) (0) (0)\)$/.exec(text);
  assertValue(lch, `${token}: ${text}`);
  const [L, C, H] = lch.slice(1).map(Number);
  return [L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];
}
function assertValue(value, label) { if (!value) throw new Error(`theme token not understood: ${label}`); }

/** An OKLab colour as gamma-encoded sRGB in 0..1, clipped. */
export function encoded([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
    .map(x => Math.min(1, Math.max(0, x))).map(x => x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
}
const luminance = rgb => { const [r, g, b] = rgb.map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG contrast ratio of two tokens in a mode. */
export function contrast(a, b, mode) {
  const [x, y] = [luminance(encoded(oklab(a, mode))), luminance(encoded(oklab(b, mode)))].sort((u, v) => v - u);
  return (x + 0.05) / (y + 0.05);
}

/** The surface token a `class` string paints in a mode: the plain `bg-<token>` (and `dark:bg-<token>` in dark), opaque only. */
export function surfaceOf(classList, mode) {
  const names = String(classList ?? '').split(/\s+/);
  const pick = prefix => { for (const name of names) { const found = name.startsWith(`${prefix}bg-`) && !name.slice(prefix.length).includes(':') && /^([a-z-]+)$/.exec(name.slice(prefix.length + 3)); if (found && raw(found[1], 'light') !== undefined) return found[1]; } return undefined; };
  return (mode === 'dark' && pick('dark:')) || pick('');
}
