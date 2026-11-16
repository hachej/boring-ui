// The kit's own shadcn primitives (shadcn/ui/: button, input, card, sidebar, ...) as registry items, so the npm package ships them under
// r/ like the blocks. One item per file, `ui-<name>`, plus the aggregate `ui` that installs them all. The items are derived from the
// sources, never written by hand: `node scripts/ui-primitives.mjs --write` rewrites them in registry.json, and check-registry-blocks.mjs
// fails when registry.json differs from this derivation.
//
// A primitive is installed in the app's `ui` alias (a `registry:hook` in its `hooks` alias): its files carry no `target`, so the shadcn
// CLI places them like its own components. Two imports of the sources do not exist in an app, so build-registry.mjs rewrites them in the
// published content (the sources keep their text: the Factory bundle reads shadcn/ui/ by path and resolves both by alias):
//   "cn"                              -> "@/components/utils/utils"   (the `utils` item, the same `cn` the blocks import)
//   "../../registry/_shared/icons"    -> "@/components/_shared/icons" (the `_shared` item, the kit's icon map)
// `@/components/ui/<name>` and `@/hooks/use-mobile` stay: the CLI rewrites them to the app's aliases, as it does for blocks.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_FOLDER = 'shadcn/ui';
/** The aggregate item: no file, every primitive as a registry dependency. */
export const UI_ALL = 'ui';
export const UI_PREFIX = 'ui-';
export const isUiItem = name => name === UI_ALL || name.startsWith(UI_PREFIX);

/** The imports of a primitive's source that an installed copy cannot keep: what they become in the app, and the kit item that installs it. */
export const REWRITES = Object.freeze({
  cn: { to: '@/components/utils/utils', item: 'utils' },
  '../../registry/_shared/icons': { to: '@/components/_shared/icons', item: '_shared' },
});

/** The npm packages the primitives import, as pinned in the items (the kit's own pins, as `utils` and `_shared` pin theirs). */
export const PACKAGE_PINS = Object.freeze({
  react: 'react@^19.0.0',
  '@base-ui/react': '@base-ui/react@1.9.0',
  'class-variance-authority': 'class-variance-authority@0.7.1',
  sonner: 'sonner@^2.0.8',
  'next-themes': 'next-themes@^0.4.6',
  '@shadcn/react': '@shadcn/react@0.3.1',
});

const importSpecifier = /\bfrom\s*(["'])([^"']+)\1/g;

/** The source of a primitive as an app installs it: the two imports above rewritten, every other byte kept. */
export function installable(source) {
  return source.replace(importSpecifier, (whole, quote, specifier) => Object.hasOwn(REWRITES, specifier) ? `from ${quote}${REWRITES[specifier].to}${quote}` : whole);
}

const itemOf = file => `${UI_PREFIX}${file.replace(/\.[^.]+$/, '')}`;
const titleOf = file => `UI ${file.replace(/\.[^.]+$/, '').replaceAll('-', ' ')}`;

/** What one primitive needs: npm packages and the kit items (other primitives, `utils`, `_shared`) its imports reach. */
export function needs(file, source, files) {
  const dependencies = new Set(), items = new Set();
  for (const [, , specifier] of source.matchAll(importSpecifier)) {
    if (Object.hasOwn(REWRITES, specifier)) { items.add(REWRITES[specifier].item); continue; }
    const ui = /^@\/components\/ui\/([\w-]+)$/.exec(specifier)?.[1] ?? (specifier === '@/hooks/use-mobile' ? 'use-mobile' : undefined);
    if (ui) {
      const other = files.find(name => name.replace(/\.[^.]+$/, '') === ui);
      if (!other) throw new Error(`${UI_FOLDER}/${file} imports ${specifier}, which ${UI_FOLDER}/ does not have`);
      items.add(itemOf(other));
      continue;
    }
    if (specifier.startsWith('@/') || specifier.startsWith('.')) throw new Error(`${UI_FOLDER}/${file} imports ${specifier}, which an installed copy cannot resolve: add it to REWRITES in scripts/ui-primitives.mjs`);
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    if (!Object.hasOwn(PACKAGE_PINS, name)) throw new Error(`${UI_FOLDER}/${file} imports ${name}, which has no pin in PACKAGE_PINS (scripts/ui-primitives.mjs)`);
    dependencies.add(PACKAGE_PINS[name]);
  }
  return { dependencies: [...dependencies].sort(), registryDependencies: [...items].sort().map(item => `@boring-ui/${item}`) };
}

/** The primitive files of shadcn/ui/ (components and the one hook), sorted. */
export const primitiveFiles = root => readdirSync(resolve(root, UI_FOLDER)).filter(name => /\.tsx?$/.test(name)).sort();

/** The registry items of the primitives: one per file, then the aggregate, in the shape registry.json holds them. */
export function uiItems(root) {
  const files = primitiveFiles(root);
  const items = files.map(file => {
    const { dependencies, registryDependencies } = needs(file, readFileSync(resolve(root, UI_FOLDER, file), 'utf8'), files);
    const hook = file.startsWith('use-');
    return {
      name: itemOf(file),
      type: hook ? 'registry:hook' : 'registry:ui',
      title: titleOf(file),
      description: `The kit's own compact ${file.replace(/\.[^.]+$/, '').replaceAll('-', ' ')} ${hook ? 'hook' : 'primitive'} (${UI_FOLDER}/${file}), installed in the app's ${hook ? 'hooks' : 'ui'} alias at this kit release. Blocks keep borrowing the app's own primitives; install this one to use the kit's.`,
      dependencies,
      ...registryDependencies.length ? { registryDependencies } : {},
      files: [{ path: `${UI_FOLDER}/${file}`, type: hook ? 'registry:hook' : 'registry:ui' }],
    };
  });
  const all = { name: UI_ALL, type: 'registry:component', title: 'Kit primitives', description: `All of the kit's own shadcn primitives (${files.filter(file => !file.startsWith('use-')).length} components and the use-mobile hook of ${UI_FOLDER}/) in one install: \`boring-ui-blocks add <registry>/ui.json\`. No file of its own.`, files: [], registryDependencies: items.map(item => `@boring-ui/${item.name}`) };
  return [...items, all];
}

/** registry.json with its `ui` and `ui-*` items replaced by the derivation (appended after the others). */
export function syncedRegistry(root) {
  const registry = JSON.parse(readFileSync(resolve(root, 'registry.json'), 'utf8'));
  registry.items = [...registry.items.filter(item => !isUiItem(item.name)), ...uiItems(root)];
  return `${JSON.stringify(registry, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const next = syncedRegistry(root);
  if (process.argv.includes('--write')) { writeFileSync(resolve(root, 'registry.json'), next); console.log(`registry.json: ${uiItems(root).length} primitive items written`); }
  else if (next !== readFileSync(resolve(root, 'registry.json'), 'utf8')) { console.error('registry.json differs from shadcn/ui/: run node scripts/ui-primitives.mjs --write'); process.exitCode = 1; }
  else console.log(`ok: registry.json holds the ${uiItems(root).length} primitive items of shadcn/ui/`);
}
