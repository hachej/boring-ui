import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

// The chat and feedback items inherit the app's style from its shadcn roles and Tailwind's token-backed utilities only (type scale,
// weights, leading, tracking, the --radius tiers, --shadow-*, font-sans/mono, default border width and transition). The template
// extras of hachej/boring-app (web/src/index.css at f57053e: --success/--warning/--info and their soft variants, --font-display,
// --border-width) are optional: read only through a kit derivation whose fallback is a shadcn role, so an app that sets only its
// shadcn roles gets a matching chat.
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

test('template extras are optional: the kit derives them from shadcn roles and the theme item requires none', () => {
  const registry = JSON.parse(read('registry.json'));
  const theme = registry.items.find(item => item.name === 'theme').cssVars;
  const EXTRA = /^(success|warning|info)|^(font-display|border-width|duration-|ease-standard|default-)/;
  for (const scope of ['light', 'dark', 'theme']) for (const name of Object.keys(theme[scope])) assert.doesNotMatch(name.replace(/^color-/, ''), EXTRA, `theme item ${scope} adds ${name}`);
  // Core extras fall back to a shadcn role; the soft variants mirror hachej/boring-app web/src/theme.derived.css (ec044d6) exactly.
  const layer = registry.items.find(item => item.name === 'pi-chat').css['@layer components'];
  const light = layer['.pi-chat'], dark = layer['.pi-chat:is(.dark, .dark *)'];
  assert.deepEqual(light, {
    '--chat-success': 'var(--success, var(--primary))',
    '--chat-warning': 'var(--warning, var(--muted-foreground))',
    '--chat-warning-soft': 'var(--warning-soft, color-mix(in oklab, var(--chat-warning) 15%, var(--background)))',
    '--chat-warning-soft-foreground': 'var(--warning-soft-foreground, color-mix(in oklab, var(--chat-warning) 75%, var(--foreground)))',
    '--chat-display': 'var(--font-display, var(--font-sans))',
  });
  assert.deepEqual(dark, {
    '--chat-warning-soft': 'var(--warning-soft, color-mix(in oklab, var(--chat-warning) 26%, var(--background)))',
    '--chat-warning-soft-foreground': 'var(--warning-soft-foreground, color-mix(in oklab, var(--chat-warning) 55%, var(--foreground)))',
  });
  const derived = light;
  for (const path of sources) {
    const source = read(path);
    assert.doesNotMatch(source, /\b(bg|text|border|ring|fill)-(success|warning|info)(-soft)?(-foreground)?\b|\bfont-display\b/, `${path} reads a template extra without a fallback (use --chat-*)`);
    for (const [, name] of source.matchAll(/\(--(?:family-name:)?(?:--)?([\w-]+)\)/g)) if (name.startsWith('chat-')) assert.ok(`--${name}` in derived, `${path}: --${name} is derived in the pi-chat css`);
  }
  const css = `${read('registry/feedback/feedback.css')}\n${read('registry/feedback/picker-overlay.ts')}`;
  for (const [use, name] of css.matchAll(/var\(--(success|warning|info|font-display|border-width|shadow-\w+|radius-\w+|text-\w+|font-weight-\w+|leading-\w+|tracking-\w+|font-mono|ease-standard)\b[^,)]*\)/g)) assert.fail(`${use}: --${name} is read without a fallback`);
});

test('feedback.css reads the scale with shadcn-default fallbacks: no px text, fixed weights, literal shadows or 1px borders', () => {
  const css = read('registry/feedback/feedback.css'), overlay = read('registry/feedback/picker-overlay.ts');
  for (const declaration of css.match(/font-size:[^;]+/g)) assert.match(declaration, /^font-size: var\(--text-(xs|sm|base|lg|xl), [\d.]+rem\)$/, declaration);
  for (const declaration of css.match(/font-weight:[^;]+/g)) assert.match(declaration, /^font-weight: var\(--font-weight-(normal|medium|semibold|bold), \d00\)$/, declaration);
  for (const declaration of css.match(/box-shadow:[^;]+/g)) assert.match(declaration, /^box-shadow: (none|var\(--boring-feedback-shadow\)|0 0 0 0 .*)$/, declaration);
  assert.doesNotMatch(css, /border: 1px|ui-monospace, SFMono-Regular, Menlo, monospace;|\bfont: \d/, 'borders and fonts come from --border-width and --font-mono');
  assert.match(css, /\[data-status="addressed"\] \{ color: var\(--success, var\(--primary\)\); \}/);
  assert.doesNotMatch(`${css}\n${overlay}`, /--(control-height|touch-target-min|ring-width|ring-offset)\b/);
  assert.doesNotMatch(overlay, /box-shadow: (?!var\(--shadow-|0 0 0 )|\bease-out\b|border-radius: \d/, 'the overlay reads --shadow-*, --ease-standard and --radius-sm');
});
