import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

// The chat and feedback items take every visual value from the app's token set (hachej/boring-app web/src/index.css at f57053e):
// the Tailwind type scale, weights, leading and tracking, the --radius tiers, --shadow-*, --border-width, --font-display/--font-mono,
// --duration-*/--ease-standard and the --success/--warning/--info colours. Fallbacks are the shadcn defaults.
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const ITEMS = ['pi-chat', 'pi-ambient', 'pi-workspace', 'feedback', 'feedback-preview', 'button'];
const sources = ITEMS.flatMap(item => readdirSync(new URL(`registry/${item}/`, root)).filter(name => /\.tsx?$/.test(name)).map(name => `registry/${item}/${name}`));

test('kit sources use the scale: no arbitrary text size, leading or radius, no palette or hex colour, no off-scale shadow or motion', () => {
  for (const path of sources) {
    const source = read(path);
    for (const [pattern, why] of [
      [/\btext-\[\d+(\.\d+)?(px|rem)\]/, 'an arbitrary text size (use text-xs/sm/base...)'],
      [/\bleading-\[/, 'an arbitrary line height (use leading-tight/snug/normal/relaxed)'],
      [/\btracking-\[/, 'an arbitrary letter spacing (use tracking-*)'],
      [/\bfont-\[\d+\]/, 'a fixed font weight (use font-normal/medium/semibold/bold)'],
      [/\brounded(-[a-z]+)?-\[/, 'an arbitrary radius (use the --radius tiers)'],
      [/#[0-9a-fA-F]{3,8}\b(?![\w-])/, 'a hex colour'],
      [/\b(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/, 'a Tailwind palette colour (use success/warning/info or a shadcn token)'],
      [/\bshadow-(xl|2xl)\b|\bshadow-\[/, 'a shadow outside --shadow-xs..lg'],
      [/\bduration-\d|\bease-(in|out|in-out|linear)\b/, 'a fixed duration or easing (use --duration-* and --ease-standard)'],
      [/--(control-height|touch-target-min|ring-width|ring-offset)\b/, 'a token removed from the app set'],
    ]) assert.doesNotMatch(source, pattern, `${path}: ${why}`);
  }
});

test('rounded-full only on pills (text with horizontal padding), status dots and avatars', () => {
  for (const path of sources) {
    const lines = read(path).split('\n');
    lines.forEach((line, index) => {
      for (const [className] of line.matchAll(/(['"`])[^'"`]*\brounded-full\b[^'"`]*\1/g)) {
        // A JSX tag may put its test id on the line above its className.
        const tag = `${lines[index - 1] ?? ''}\n${line}`;
        const pill = /\b(px|pl|pr)-/.test(className), dot = /\bsize-(1\.5|2|2\.5)\b/.test(className), avatar = /<img\b|avatar|pill/.test(tag);
        assert.ok(pill || dot || avatar, `${path}:${index + 1}: rounded-full on ${className}; controls use the --radius tiers (rounded-md/lg)`);
      }
    });
  }
});

test('the status colours are the app tokens: success/warning/info with foreground and soft variants, in the theme item', () => {
  const theme = JSON.parse(read('registry.json')).items.find(item => item.name === 'theme').cssVars;
  for (const status of ['success', 'warning', 'info']) for (const part of ['', '-foreground', '-soft', '-soft-foreground']) {
    assert.ok(theme.light[status + part] && theme.dark[status + part], `${status}${part} light and dark`);
    assert.equal(theme.theme[`color-${status}${part}`], `var(--${status}${part})`);
  }
  for (const [token, value] of Object.entries({ 'border-width': '1px', 'duration-fast': '100ms', 'duration-normal': '150ms', 'duration-slow': '300ms', 'ease-standard': 'cubic-bezier(0.4, 0, 0.2, 1)' })) assert.equal(theme.light[token], value, token);
  assert.equal(theme.theme['font-display'], 'var(--font-sans)');
  assert.equal(theme.theme['default-border-width'], 'var(--border-width)');
  assert.equal(theme.theme['default-transition-duration'], 'var(--duration-normal)');
  assert.equal(theme.theme['default-transition-timing-function'], 'var(--ease-standard)');
});

test('feedback.css reads the scale with shadcn-default fallbacks: no px text, fixed weights, literal shadows or 1px borders', () => {
  const css = read('registry/feedback/feedback.css'), overlay = read('registry/feedback/picker-overlay.ts');
  for (const declaration of css.match(/font-size:[^;]+/g)) assert.match(declaration, /^font-size: var\(--text-(xs|sm|base|lg|xl), [\d.]+rem\)$/, declaration);
  for (const declaration of css.match(/font-weight:[^;]+/g)) assert.match(declaration, /^font-weight: var\(--font-weight-(normal|medium|semibold|bold), \d00\)$/, declaration);
  for (const declaration of css.match(/box-shadow:[^;]+/g)) assert.match(declaration, /^box-shadow: (none|var\(--boring-feedback-shadow\)|0 0 0 0 .*)$/, declaration);
  assert.doesNotMatch(css, /border: 1px|ui-monospace, SFMono-Regular, Menlo, monospace;|\bfont: \d/, 'borders and fonts come from --border-width and --font-mono');
  assert.match(css, /\[data-status="addressed"\] \{ color: var\(--success\); \}/);
  assert.doesNotMatch(`${css}\n${overlay}`, /--(control-height|touch-target-min|ring-width|ring-offset)\b/);
  assert.doesNotMatch(overlay, /box-shadow: (?!var\(--shadow-|0 0 0 )|\bease-out\b|border-radius: \d/, 'the overlay reads --shadow-*, --ease-standard and --radius-sm');
});
