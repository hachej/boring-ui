import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compile } from 'tailwindcss';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const source = manifest.items.find(item => item.name === 'theme');
const published = JSON.parse(readFileSync(join(root, 'public/r/theme.json'), 'utf8'));
const surfaces = {
  light: { background: 'oklch(0.97 0 0)', card: 'oklch(1 0 0)', foreground: 'oklch(0.2 0 0)' },
  dark: { background: 'oklch(0.18 0 0)', card: 'oklch(0.23 0 0)', foreground: 'oklch(0.96 0 0)' },
};
const charts = {
  light: ['oklch(0.55 0.17 264)', 'oklch(0.58 0.15 160)', 'oklch(0.63 0.15 75)', 'oklch(0.6 0.18 15)', 'oklch(0.57 0.12 300)'],
  dark: ['oklch(0.72 0.15 264)', 'oklch(0.75 0.15 160)', 'oklch(0.78 0.15 75)', 'oklch(0.73 0.16 15)', 'oklch(0.74 0.12 300)'],
};

test('default theme source and published output expose the original surface, type, font and status roles', () => {
  assert.deepEqual(published.cssVars, source.cssVars, 'published theme is rebuilt from its owner');
  for (const item of [source, published]) {
    const { theme, light, dark } = item.cssVars;
    assert.equal(item.css, undefined, 'theme does not override host primitive styles');
    assert.equal(light.radius, '0.5rem');
    assert.equal(light['text-body'], '0.75rem');
    assert.equal(light['text-title'], '0.875rem');
    assert.equal(theme['text-xs'], 'var(--text-body)');
    assert.equal(theme['text-sm'], 'var(--text-title)');
    assert.equal(light['font-sans'], "'Geist', ui-sans-serif, system-ui, sans-serif");
    assert.equal(light['font-mono'], "'Geist Mono', ui-monospace, Menlo, monospace");
    for (const name of ['sans', 'mono']) assert.equal(theme[`font-${name}`], `var(--font-${name})`);
    for (const [mode, expected] of Object.entries(surfaces)) {
      const vars = item.cssVars[mode];
      for (const [role, value] of Object.entries(expected)) assert.equal(vars[role], value, `${mode} ${role}`);
      for (const [role, value] of Object.entries({ popover: 'var(--card)', sidebar: 'var(--background)', shell: 'var(--background)', input: `color-mix(in oklab, var(--border) ${mode === 'dark' ? 75 : 65}%, var(--foreground))` })) assert.equal(vars[role], value, `${mode} ${role}`);
      for (const status of ['success', 'warning', 'info', 'destructive']) {
        const percentage = mode === 'dark' ? 22 : ({ success: 14, warning: 16, info: 12, destructive: 12 })[status];
        assert.equal(vars[`${status}-soft`], `color-mix(in oklab, var(--${status}) ${percentage}%, var(--card))`);
        const share = status === 'destructive' ? 85 : mode === 'dark' ? 55 : 75;
        assert.equal(vars[`${status}-soft-foreground`], `color-mix(in oklab, var(--${status}) ${share}%, var(--foreground))`);
        for (const role of [status, `${status}-soft`, `${status}-soft-foreground`]) assert.equal(theme[`color-${role}`], `var(--${role})`);
      }
      assert.deepEqual(charts[mode].map((_, index) => vars[`chart-${index + 1}`]), charts[mode]);
      assert.notEqual(vars.border, 'transparent', 'hairlines remain');
      assert.match(vars['shadow-lg'], /0 10px/, 'floating elevation remains');
    }
    assert.equal(light['muted-foreground'], 'color-mix(in oklab, var(--foreground) 57%, var(--background))', 'light secondary ink also contrasts on muted surfaces');
    assert.equal(dark['muted-foreground'], 'color-mix(in oklab, var(--foreground) 62%, var(--background))', 'dark secondary ink is unchanged');
    assert.equal(dark.radius, undefined, 'shape is mode-independent');
    assert.equal(dark['font-sans'], undefined, 'fonts are mode-independent');
  }
  assert.ok(manifest.items.every(item => !(item.registryDependencies ?? []).includes('@boring-ui/theme')), 'blocks do not overwrite branded hosts');
});

async function installTheme(existing = '') {
  // The theme may declare exactly one package, its mono font (it loads nothing; see registry/README.md). This offline fixture installs a copy without it, so the CLI never reaches the network.
  assert.deepEqual(published.dependencies, ['@fontsource-variable/geist-mono@5.3.0'], 'the theme declares its font package and nothing else');
  assert.equal(published.registryDependencies, undefined, 'theme fixture must not fetch dependent items');
  const evidence = join(root, '.cache/evidence/default-spec');
  mkdirSync(evidence, { recursive: true });
  const directory = mkdtempSync(join(evidence, 'installed-'));
  mkdirSync(join(directory, 'src'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'fictional-theme-consumer', private: true, type: 'module', dependencies: {} }));
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
  writeFileSync(join(directory, 'components.json'), JSON.stringify({ $schema: 'https://ui.shadcn.com/schema.json', style: 'base-nova', rsc: false, tsx: true, tailwind: { config: '', css: 'src/index.css', baseColor: 'neutral', cssVariables: true }, aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components/ui' } }));
  writeFileSync(join(directory, 'theme.offline.json'), JSON.stringify({ ...published, dependencies: undefined }));
  writeFileSync(join(directory, 'src/index.css'), `@import "tailwindcss";\n${existing}`);
  const installed = spawnSync(process.execPath, [require.resolve('shadcn'), 'add', join(directory, 'theme.offline.json'), '--cwd', directory, '--yes'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, XDG_CACHE_HOME: join(directory, 'cache') } });
  writeFileSync(join(directory, 'cli.log'), installed.stdout + installed.stderr);
  assert.equal(installed.status, 0, installed.error?.message ?? installed.stdout + installed.stderr);
  const css = readFileSync(join(directory, 'src/index.css'), 'utf8');
  const compiler = await compile(css, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: root, content: readFileSync(path, 'utf8') };
  } });
  const output = compiler.build(['bg-background', 'bg-card', 'bg-sidebar', 'text-xs', 'text-sm', 'font-sans', 'font-mono', 'bg-warning-soft', 'border-input', 'shadow-lg']);
  writeFileSync(join(directory, 'compiled.css'), output);
  return { css, output };
}

test('pinned shadcn installs published defaults; Tailwind bindings compile and installed roles resolve in light/dark', async () => {
  const { css, output } = await installTheme();
  for (const [selector, property, value] of [['.text-xs', 'font-size', 'var(--text-body)'], ['.text-sm', 'font-size', 'var(--text-title)'], ['.font-sans', 'font-family', 'var(--font-sans)'], ['.bg-warning-soft', 'background-color', 'var(--warning-soft)']]) {
    assert.ok(output.includes(`${selector} {\n    ${property}: ${value};`), `${selector} compiles to ${value}`);
  }
  const window = new Window();
  try {
    const style = window.document.createElement('style');
    style.textContent = css + '\n.probe { --resolved-canvas: var(--background); --resolved-card: var(--card); --resolved-sidebar: var(--sidebar); }';
    window.document.head.append(style);
    window.document.body.innerHTML = '<div class="probe"></div><div class="dark"><div class="probe"></div></div>';
    for (const [index, mode] of ['light', 'dark'].entries()) {
      const computed = window.getComputedStyle(window.document.querySelectorAll('.probe')[index]);
      for (const [role, expected] of Object.entries({ canvas: surfaces[mode].background, card: surfaces[mode].card, sidebar: surfaces[mode].background })) assert.equal(computed.getPropertyValue(`--resolved-${role}`).trim(), expected, `installed ${mode} ${role}`);
    }
  } finally { await window.happyDOM.close(); }
});

test('explicit theme installation overwrites matching host roles (pinned CLI characterization, not brand preservation)', async () => {
  const { css } = await installTheme(':root { --background: oklch(0.91 0.04 80); --card: oklch(0.99 0.02 80); --radius: 0.25rem; --fictional-brand: retained; }\n.dark { --background: oklch(0.12 0.04 80); --card: oklch(0.22 0.04 80); }');
  for (const mode of ['light', 'dark']) for (const role of ['background', 'card']) assert.ok(css.includes(`--${role}: ${published.cssVars[mode][role]};`));
  assert.ok(css.includes(`--radius: ${published.cssVars.light.radius};`));
  assert.doesNotMatch(css, /oklch\(0\.(?:91|99|12|22) 0\.0[24] 80\)|--radius:\s*0\.25rem/);
  assert.ok(css.includes('--fictional-brand: retained;'));
});
