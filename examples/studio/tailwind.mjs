// Tailwind v4 for the studio and every example, compiled once at startup with the library API (no CLI, no PostCSS, no config file).
// Utilities are generated for every class-like token found in the Tailwind registry items' source and the studio itself.
// Only the theme and utilities layers are loaded: Tailwind's preflight would restyle the viewer panels, so the
// chat item brings its own scoped base rules (see its `css` in registry.json).
// The tokens are the `theme` item of registry.json (the one source: the CLI installs the same values into a consumer's CSS).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

function files(directory, pattern) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? (name === 'out' ? [] : files(path, pattern)) : pattern.test(name) ? [path] : [];
  });
}

/** The shadcn registry item's `css` object as CSS text (nested at-rules and keyframes included). */
export function registryCss(item) {
  const render = (rules, depth = 0) => Object.entries(rules).map(([selector, value]) => typeof value === 'object'
    ? `${selector}{${render(value, depth + 1)}}` : `${selector}:${value};`).join(depth === 0 ? '\n' : '');
  return render(item.css ?? {});
}

/** Every item written in Tailwind: their source is scanned for classes and their `css` is compiled in. */
const TAILWIND_ITEMS = ['button', 'utils', 'pi-chat', 'pi-ambient', 'pi-workspace', 'pi-app', 'viewers'];

/**
 * The registry `theme` item as CSS: light tokens on `:root`, dark tokens when the system prefers dark (the CLI writes them under
 * `.dark` in a consumer app instead), and the Tailwind `@theme inline` bindings.
 */
export function themeCss() {
  const theme = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.find(entry => entry.name === 'theme');
  const block = vars => Object.entries(vars ?? {}).map(([name, value]) => `  --${name}: ${value};`).join('\n');
  return `:root {\n${block(theme.cssVars.light)}\n  color-scheme: light dark;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${block(theme.cssVars.dark).replace(/^/gm, '  ')}\n  }\n}\n@theme inline {\n${block(theme.cssVars.theme)}\n}`;
}

/** Candidates are any run of non-space, non-quote characters: Tailwind ignores those that are not utilities. */
function candidates(paths) {
  const found = new Set();
  for (const path of paths) for (const token of readFileSync(path, 'utf8').split(/[\s"'`]+/)) if (token) found.add(token);
  return [...found];
}

/** `extraDirectories` are more folders (relative to the repository root) to scan for classes, such as other registry items. */
export async function buildTailwind({ extraDirectories = [] } = {}) {
  const items = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.filter(entry => TAILWIND_ITEMS.includes(entry.name));
  const input = `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
${themeCss()}
${items.map(registryCss).join('\n')}`;
  const compiler = await compile(input, {
    base: root,
    onDependency: () => {},
    loadStylesheet: async id => {
      const resolved = id === 'tailwindcss' ? join(dirname(require.resolve('tailwindcss/package.json')), 'index.css') : require.resolve(id);
      return { path: resolved, base: dirname(resolved), content: readFileSync(resolved, 'utf8') };
    },
    loadModule: async () => { throw new Error('Tailwind plugins and configs are not used in the studio'); },
  });
  const sources = [...[...TAILWIND_ITEMS.map(name => `registry/${name}`), ...extraDirectories].flatMap(directory => files(join(root, directory), /\.(tsx?|css)$/)), ...files(join(root, 'examples/studio'), /\.(jsx|mjs|css)$/).filter(path => !path.endsWith('tailwind.mjs'))];
  return compiler.build(candidates(sources));
}
