// D-1888: builds the kit's design-system page (packages/ui/design-system/) from the real components, the real tokens and the design check's own
// rule data. Nothing on the page is typed by hand: the colour roles are CORE_ROLES, the tokens a role feeds are parsed from theme.derived.css,
// the variants are parsed from the components' cva blocks, the component list is the exports of shadcn/ui/*.tsx. The page code (lab/design-system)
// is trusted host code built from kit sources, bundled with the same esbuild + Tailwind v4 approach as test/contracts/badge-table-row-geometry.test.mjs.
// Output: index.html, app.js, app.css, data.js (no fetch: it works on file:// and over https) and themes/default.css.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import ts from 'typescript';
import { LIGHT_SCOPE, scopeLight } from '../lab/design-system/layers.mjs';
import { compile } from 'tailwindcss';
import { CORE_ROLES, NON_COLOR_ROLE, cssDeclarations } from '../packages/ui/bin/boring-ui-blocks.mjs';
import { registryCss } from '../lab/studio/tailwind.mjs';

export { LIGHT_SCOPE, scopeLight };
const require = createRequire(import.meta.url);
export const SOURCE_DIR = 'lab/design-system';
export const OUTPUT_DIR = 'packages/ui/design-system';
export const DATA_PREFIX = 'globalThis.BORING_DS = ';
const CHART_ALIAS = { 'chart-series-1': 'chart-1', 'chart-series-2': 'chart-2', 'chart-series-3': 'chart-3', 'chart-series-4': 'chart-4', 'chart-series-5': 'chart-5' };
const DEFAULT_FALLBACK = { 'border-width': '1px', 'font-display': 'var(--font-sans)' };

/** The default style as a theme.core.css: the core roles with the values of the registry `theme` item (light on :root, dark on .dark). */
export function defaultThemeCss(registry) {
  const vars = registry.items.find(entry => entry.name === 'theme').cssVars;
  const pick = (set, name) => set[name] ?? set[CHART_ALIAS[name]];
  const lines = (set, fallback) => CORE_ROLES.map(name => [name, pick(set, name) ?? (fallback ? DEFAULT_FALLBACK[name] : undefined)]).filter(([, value]) => value !== undefined);
  const light = lines(vars.light, true), dark = lines(vars.dark, false).filter(([name, value]) => light.find(([n]) => n === name)?.[1] !== value);
  const block = list => list.map(([name, value]) => `  --${name}: ${value};`).join('\n');
  return `/* The kit's default style: the core roles of the registry theme item. An app's theme.core.css has the same shape. */\n:root {\n${block(light)}\n}\n\n.dark {\n${block(dark)}\n}\n`;
}

/** Which derived tokens each role feeds, from the var(--role) references of theme.derived.css (direct first, then through other derived tokens). */
export function derivedFeeds(derivedCss) {
  const direct = new Map();
  const declarations = cssDeclarations(derivedCss).filter(d => /^(?::root|\.dark)\b/.test(d.selector));
  for (const { name, value } of declarations) {
    for (const [, from] of value.matchAll(/var\(--([\w-]+)/g)) {
      if (!direct.has(from)) direct.set(from, new Set());
      direct.get(from).add(name);
    }
  }
  const feeds = {};
  for (const role of CORE_ROLES) {
    const seen = [], queue = [...(direct.get(role) ?? [])];
    while (queue.length) {
      const next = queue.shift();
      if (seen.includes(next) || next === role) continue;
      seen.push(next);
      queue.push(...(direct.get(next) ?? []));
    }
    feeds[role] = seen;
  }
  return { feeds, derived: [...new Set(declarations.map(d => d.name))] };
}

/** The text-on-surface pairs that exist in the theme: every X-foreground over X for colour roles, plus the page text and the status text. */
export function contrastPairs(names) {
  const isColor = name => !NON_COLOR_ROLE.test(name);
  const known = new Set(names);
  const pairs = [['foreground', 'background'], ['muted-foreground', 'background'], ['destructive', 'background'], ['link', 'background']];
  for (const name of known) {
    if (!name.endsWith('-foreground')) continue;
    const base = name.slice(0, -'-foreground'.length);
    if (known.has(base) && isColor(base) && isColor(name)) pairs.push([name, base]);
  }
  return pairs.filter(([fg, bg]) => known.has(fg) && known.has(bg)).map(([fg, bg]) => ({ fg, bg }));
}

// ---- component data: exports and cva variants, read from the source -----------------------------------------------------------------

const keyName = (member, file) => {
  const key = member.name;
  if (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) || ts.isNumericLiteral(key)) return key.text;
  if (ts.isComputedPropertyName(key)) {
    const inner = key.expression;
    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text;
  }
  throw new Error(`${file}: a cva key is not a plain string (${key.getText()}); the design-system page cannot list it`);
};
const objectOf = node => (node && ts.isObjectLiteralExpression(node) ? node : undefined);
const propertyOf = (object, name, file) => object.properties.find(member => ts.isPropertyAssignment(member) && keyName(member, file) === name);

/** `{ name, groups: { variant: [keys], size: [keys] } }` for each `const name = cva(...)` of a source file, read from the TypeScript syntax tree (every key form). */
export function cvaVariants(source, file = 'source') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'cva') {
      const config = objectOf(node.initializer.arguments[1]);
      const variants = config && propertyOf(config, 'variants', file);
      const groupsObject = variants && objectOf(variants.initializer);
      if (groupsObject) {
        const groups = {};
        for (const group of groupsObject.properties) {
          if (!ts.isPropertyAssignment(group)) continue;
          const keys = objectOf(group.initializer);
          if (keys) groups[keyName(group, file)] = keys.properties.filter(ts.isPropertyAssignment).map(member => keyName(member, file));
        }
        found.push({ name: node.name.text, groups });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** The capitalised (component) names a source file exports. */
export function exportedComponents(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.replace(/\btype\s+/, '').split(/\s+as\s+/).at(-1).trim();
      if (/^[A-Z]\w*$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+([A-Z]\w*)/g)) names.add(match[1]);
  return [...names];
}

export function componentData(root) {
  const dir = join(root, 'shadcn/ui'), files = {};
  for (const name of readdirSync(dir).filter(file => file.endsWith('.tsx')).sort()) {
    const source = readFileSync(join(dir, name), 'utf8');
    const exports = exportedComponents(source);
    if (exports.length) files[name.slice(0, -4)] = { exports, variants: cvaVariants(source, name) };
  }
  return files;
}

// ---- the build ------------------------------------------------------------------------------------------------------------------------

const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

/** `derivedCss` replaces the kit's theme.derived.css text (a test changes one token and expects the page to follow with no page edit). */
export async function buildDesignSystem(root, { outDir = join(root, OUTPUT_DIR), derivedCss: override } = {}) {
  root = resolve(root);
  const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  const version = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).version;
  const derivedPath = join(root, 'packages/ui/styles/theme.derived.css');
  const derivedCss = override ?? readFileSync(derivedPath, 'utf8');
  const { feeds, derived } = derivedFeeds(derivedCss);
  const themeItem = registry.items.find(entry => entry.name === 'theme');
  const defaultCss = defaultThemeCss(registry);

  // The page's JavaScript: the real shadcn components (`@/components/ui/*` is shadcn/ui, as in the geometry tests).
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    // sonner and next-themes are app dependencies, not the kit's: the page draws toasts with a small stand-in renderer (lab/design-system/standins).
    builder.onResolve({ filter: /^sonner$/ }, () => ({ path: join(root, SOURCE_DIR, 'standins/sonner.jsx') }));
    builder.onResolve({ filter: /^next-themes$/ }, () => ({ path: join(root, SOURCE_DIR, 'standins/next-themes.js') }));
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
  } };
  const result = await bundle({ entryPoints: [join(root, SOURCE_DIR, 'main.jsx')], bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent' });
  const js = result.outputFiles[0].text;
  const sources = Object.keys(result.metafile.inputs).filter(path => /\.(tsx?|jsx?)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));

  // The page's CSS: Tailwind v4 over the kit's own app.css and theme.derived.css (its :root rules also apply to the light scope), no tokens of its own.
  const cssSource = `@import "tailwindcss";\n@import "kit-app.css";\n@import "kit-derived.css";\n${registryCss(themeItem)}\n`;
  const read = path => ({ path, base: dirname(path), content: readFileSync(path, 'utf8') });
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async (id, base) => {
    if (id === 'kit-app.css') return read(join(root, 'packages/ui/styles/app.css'));
    if (id === 'kit-derived.css') return { path: derivedPath, base: dirname(derivedPath), content: scopeLight(derivedCss) };
    return read(id.startsWith('.') ? resolve(base, id) : require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id));
  } });
  const appCss = readFileSync(join(root, 'packages/ui/styles/app.css'), 'utf8');
  const textSteps = [...appCss.matchAll(/--text-([a-z0-9]+):/g)].map(match => match[1]);
  const radii = [...new Set([...derivedCss.matchAll(/--radius-([a-z0-9]+):/g)].map(match => match[1]))];
  // Dynamic classes the page builds from the data (text-${step}, rounded-${name}); a scan of the source cannot see them.
  const dynamic = [...textSteps.map(step => `text-${step}`), ...radii.map(name => `rounded-${name}`)];
  const css = compiler.build([...sources.flatMap(source => source.split(/[\s"'`]+/)), ...dynamic]);
  const base = themeItem.css['@layer base'];
  const density = { fine: base[':root']['--control-h'], touch: Object.values(base).find(rule => rule[':root'])[':root']['--control-h'] };

  const roles = CORE_ROLES.map(name => ({ name, kind: NON_COLOR_ROLE.test(name) ? 'token' : 'color', feeds: feeds[name] }));
  const data = {
    version,
    roles,
    pairs: contrastPairs([...CORE_ROLES, ...derived]),
    derived,
    textSteps,
    radii,
    density,
    components: componentData(root),
    themes: [{ name: 'default', label: 'default', css: defaultCss }],
  };
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'themes'), { recursive: true });
  writeFileSync(join(outDir, 'themes/default.css'), defaultCss);
  writeFileSync(join(outDir, 'data.js'), `${DATA_PREFIX}${JSON.stringify(data).replace(/</g, '\\u003c')};\n`);
  writeFileSync(join(outDir, 'app.js'), js);
  writeFileSync(join(outDir, 'app.css'), css);
  writeFileSync(join(outDir, 'index.html'), readFileSync(join(root, SOURCE_DIR, 'index.html'), 'utf8'));
  return { outDir, data };
}

/** The package build runs this when the page source is present (an isolated fixture tree has none). */
export const hasDesignSystemSource = root => existsSync(join(root, SOURCE_DIR, 'main.jsx'));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { outDir } = await buildDesignSystem(root, { outDir: process.argv[2] ? resolve(process.argv[2]) : undefined });
  console.log(`design-system: wrote ${outDir}`);
}
