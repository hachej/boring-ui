// Guard: registry items are blocks with one direction of dependency.
//
// 1. Every source file under registry/<item>/ is listed in that item of registry.json (nothing ships by accident or is
//    imported by path from outside the item).
// 2. A file may import another item (`../<item>/<file>`) only when that item is in its own item's registryDependencies
//    (transitively) and lists the file. pi-chat declares none, so the chat never imports pi-ambient or pi-workspace, and
//    pi-workspace never imports pi-ambient (the host swaps AmbientChat in when the chat floats).
// 3. Declared registryDependencies name only items of this registry (`@boring-ui/<item>`), never a shadcn component and never the theme:
//    a block takes shadcn components and tokens from the app. A source file imports `@/components/ui/<name>` (the shadcn CLI rewrites it
//    to the app's `ui` alias from components.json) only for a name in SHADCN_BUILTINS, and `@/hooks/<name>` only for SHADCN_HOOKS. That one
//    kit-wide list is the app's prerequisite, documented as one command in registry/README.md (APP_SETUP), and every name in it is used.
// 4. File types and targets: a `use*.ts` file is `registry:hook`, any other `.ts` is `registry:lib` (or a declared `registry:hook`), a
//    `.tsx` is a component (`registry:ui` for a shared primitive such as the button); every file has the target
//    `components/<item>/<file>`, so the installed folders mirror registry/ and the sibling imports above resolve.
// 5. No file name is shipped by two items: a shared helper is one item (utils, button) that the others depend on.
// 6. No import cycle in registry blocks or package sources (packages/*/src), type-only and lazy imports included: copied-in
//    code with a cycle breaks some bundlers, HMR and tree-shaking. Shared types and helpers live in the module that owns them
//    (a leaf lib never imports a component), and a module that needs them imports them in one direction.
// 7. pi-chat is the core chat; each composer feature and each reply card is its own optional item that plugs in through the chat's
//    props (D-257). The core depends on no `pi-chat-*` item nor on pi-artifacts, declares none of their npm packages, imports none of
//    the feature-only modules in CORE_EXCLUDED and ships none of the card modules in CORE_EXCLUDED_FILES (question, approval,
//    sub-agent, run and artifact cards, and the artifact descriptors), so a question or an approval without its item shows a notice.
//    Viewers load by kind, lazily (D-257 step 4): the core chat depends on no viewer item, and neither the agent page (pi-app, documents) nor any
//    kind module (`*-kind.ts(x)`) makes a static value import of a view module in LAZY_VIEWS; it reaches the view only through the
//    kind's `load: () => import(...)`, so each view lands in its own chunk. Type-only imports are allowed (they are erased).
//    So that features cannot drift back (D-257 step 5), the core declares only the npm packages in CORE_PACKAGES and stays within
//    CORE_BUDGET (listed files and their lines); growing either is a decision made by editing the constant, not a side effect.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIgnored, walkProject } from './project-files.mjs';

const source = /\.(?:tsx?|jsx?|mjs)$/;
/** The source registryDependencies use the `@boring-ui/<item>` shorthand; scripts/build-registry.mjs writes them as absolute release URLs. */
const namespace = '@boring-ui/';
const local = (dependency) => dependency.startsWith(namespace) ? dependency.slice(namespace.length) : dependency;
/**
 * The shadcn components (Base UI `base-nova` style) the blocks import through the app's `ui` alias. The app installs them once, before any
 * block (APP_SETUP); no item lists them. Fixed: a new one is a decision, not a convenience, and it lands with its README command.
 */
export const SHADCN_BUILTINS = Object.freeze(['alert', 'attachment', 'avatar', 'badge', 'bubble', 'button', 'card', 'checkbox', 'collapsible', 'dialog', 'drawer', 'dropdown-menu', 'empty', 'field', 'input', 'input-group', 'item', 'label', 'message', 'message-scroller', 'native-select', 'popover', 'progress', 'scroll-area', 'separator', 'sidebar', 'spinner', 'switch', 'table', 'textarea', 'toggle', 'toggle-group', 'tooltip', 'trace']);
/** The hooks the shadcn components above install under the app's `hooks` alias (sidebar's use-mobile) that blocks may import too. */
export const SHADCN_HOOKS = Object.freeze(['use-mobile']);
/** The app's one-time shadcn setup, quoted verbatim in registry/README.md. */
export const APP_SETUP = `npx shadcn@4.23.0 add ${SHADCN_BUILTINS.join(' ')}`;
/** npm packages (or package subpaths) only the optional composer feature items use: Markdown and voice capture. */
export const CORE_EXCLUDED = Object.freeze(['marked', 'entities', '@hachej/boring-ui-kit/voice-capture']);
/** The optional items the core chat must not depend on besides the `pi-chat-*` ones. */
export const CORE_EXCLUDED_ITEMS = Object.freeze(['pi-artifacts', 'viewer-frame', 'viewer-markdown', 'viewer-html', 'viewer-image', 'viewer-pdf', 'viewer-code', 'maquette-viewer', 'diagram-viewer', 'mockup-viewer', 'record-viewer', 'looks-viewer', 'board-viewer']);
/** The view modules a kind loads lazily (D-257 step 4): the agent page and the kind modules never import them statically. */
export const LAZY_VIEWS = Object.freeze(['viewer-markdown/markdown-pane', 'viewer-html/html-pane', 'viewer-image/image-pane', 'viewer-pdf/pdf-pane', 'viewer-pdf/pdf-pages', 'viewer-pdf/local-file-viewer', 'viewer-code/svg-view', 'viewer-code/csv-table', 'maquette-viewer/maquette-viewer', 'diagram-viewer/diagram-viewer', 'mockup-viewer/mockup-viewer', 'record-viewer/record-viewer', 'looks-viewer/looks-viewer', 'board-viewer/board-viewer']);
/** A static import or re-export that brings values: `import x from`, `import { a } from`, `export { a } from`, `import '...'`; not `import type`. */
const staticValueImport = /^\s*(?:import\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?|export\s+(?!type\b)[^'";]*?\sfrom\s*)['"]([^'"]+)['"]/gm;
/** The npm packages the core chat may declare: the borrowed native chat, the Pi types it renders, React, icons and the shadcn runtime. */
export const CORE_PACKAGES = Object.freeze(['@hachej/boring-ui-kit', '@hachej/boring-files', '@hachej/boring-feedback', 'react', 'react-dom', '@base-ui/react', '@earendil-works/pi-durable', '@earendil-works/chord', '@earendil-works/pi-ai', '@modelcontextprotocol/sdk', 'lucide-react', '@shadcn/react', 'zod']);
/** The core chat's size: its listed files and their lines (26 files and 4110 lines after D-257 step 4, from 38 files and ~5.4k before; 4330 lines with the `messaging` message style). */
export const CORE_BUDGET = Object.freeze({ files: 26, lines: 4330 });
/** The card modules that live in their optional items, never in the core chat (D-257 step 3). */
export const CORE_EXCLUDED_FILES = Object.freeze(['question-card', 'approval-card', 'subagent-card', 'run-card', 'artifact-card', 'artifact']);
const packageName = (dependency) => dependency.replace(/(.)@[^@]*$/, '$1');
const importPattern = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** Cycles among the source files under `folders`, following relative imports (`./x`, `./x.js` for `x.ts`, `./x` for `x.tsx`). */
export function importCycles(root, folders) {
  const files = [];
  const ignored = gitIgnored(root);
  for (const folder of folders) if (existsSync(resolve(root, folder))) walkProject(root, folder, (entry, path) => { if (!entry.isDirectory() && source.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(path); }, ignored);
  const known = new Set(files);
  const target = (from, specifier) => {
    const base = posix.normalize(posix.join(posix.dirname(from), specifier)), stem = base.replace(/\.(?:m?js|jsx)$/, '');
    return [base, `${stem}.ts`, `${stem}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => known.has(candidate));
  };
  const graph = new Map(files.map((file) => [file, [...new Set([...readFileSync(resolve(root, file), 'utf8').matchAll(importPattern)]
    .map(([, specifier]) => specifier).filter((specifier) => specifier.startsWith('.')).map((specifier) => target(file, specifier)).filter(Boolean))].sort()]));
  // Tarjan's strongly connected components; each component with an edge back is reported once, as one concrete path.
  let next = 0;
  const order = new Map(), low = new Map(), stack = [], open = new Set(), cycles = [];
  const visit = (file) => {
    order.set(file, next); low.set(file, next++); stack.push(file); open.add(file);
    for (const other of graph.get(file)) {
      if (!order.has(other)) { visit(other); low.set(file, Math.min(low.get(file), low.get(other))); }
      else if (open.has(other)) low.set(file, Math.min(low.get(file), order.get(other)));
    }
    if (low.get(file) !== order.get(file)) return;
    const component = [];
    for (let member; member !== file;) { member = stack.pop(); open.delete(member); component.push(member); }
    if (component.length > 1 || graph.get(file).includes(file)) cycles.push(shortestLoop(graph, new Set(component)));
  };
  for (const file of files.sort()) if (!order.has(file)) visit(file);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

function shortestLoop(graph, component) {
  const start = [...component].sort()[0];
  const previous = new Map([[start, null]]), queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    for (const other of graph.get(queue[index])) {
      if (!component.has(other)) continue;
      if (other === start) { const path = [start]; for (let at = queue[index]; at !== start; at = previous.get(at)) path.splice(1, 0, at); return [...path, start]; }
      if (!previous.has(other)) { previous.set(other, queue[index]); queue.push(other); }
    }
  }
  return [start, start];
}

/** Folders the cycle rule covers: every registry block and every package's sources. */
export const cycleFolders = (root) => ['registry', ...readdirSync(resolve(root, 'packages'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}/src`)];

const isShim = (root, path, base) => /^(?:\/\/[^\n]*\n)*export \* from '\.\.\/[\w-]+\/[\w-]+';\s*$/.test(readFileSync(resolve(root, path), 'utf8')) && base.endsWith('.tsx');

export function checkRegistryBlocks(root) {
  const errors = [];
  const manifest = JSON.parse(readFileSync(resolve(root, 'registry.json'), 'utf8'));
  const items = new Map(manifest.items.map((item) => [item.name, item]));
  const listed = (item) => new Set(item.files.map((file) => file.path));
  const closure = (name, seen = new Set()) => {
    for (const dependency of (items.get(name)?.registryDependencies ?? []).map(local)) if (!seen.has(dependency)) { seen.add(dependency); closure(dependency, seen); }
    return seen;
  };
  let files = 0;
  const owners = new Map(), used = new Set();
  for (const item of items.values()) {
    for (const dependency of item.registryDependencies ?? []) {
      if (!dependency.startsWith(namespace) || !items.has(local(dependency))) errors.push(`BORING-BLOCKS ${item.name}: registryDependencies name only ${namespace}<item of this registry>; shadcn components come from the app's ui alias (found ${dependency})`);
      else if (local(dependency) === 'theme') errors.push(`BORING-BLOCKS ${item.name}: depends on ${dependency}; blocks use the app's shadcn tokens, and an app without them installs the theme once`);
    }
    for (const file of item.files ?? []) {
      const base = posix.basename(file.path);
      const where = `BORING-BLOCKS ${file.path}`;
      if (file.target !== `components/${item.name}/${base}` || file.path !== `registry/${item.name}/${base}`) errors.push(`${where}: lives in registry/${item.name}/ and installs to components/${item.name}/${base} (target ${file.target ?? 'missing'})`);
      if (/^use[A-Z-].*\.ts$/.test(base) && file.type !== 'registry:hook') errors.push(`${where}: a use*.ts file is registry:hook (found ${file.type})`);
      else if (/\.ts$/.test(base) && file.type !== 'registry:lib' && file.type !== 'registry:hook') errors.push(`${where}: a .ts helper is registry:lib (found ${file.type})`);
      else if (/\.tsx$/.test(base) && file.type !== 'registry:component' && file.type !== 'registry:ui') errors.push(`${where}: a .tsx file is registry:component or registry:ui (found ${file.type})`);
      // A one-line `export * from '../<item>/<base>'` shim keeps an old import path working after a move (pi-workspace/dock -> dock/dock): it claims no name.
      if (isShim(root, file.path, base)) continue;
      if (owners.has(base)) errors.push(`${where}: ${base} is also shipped by item ${owners.get(base)}; share one item instead`);
      else owners.set(base, item.name);
    }
  }
  for (const directory of readdirSync(resolve(root, 'registry'), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const item = items.get(directory.name);
    if (!item) { errors.push(`BORING-BLOCKS registry/${directory.name}: directory is not an item of registry.json`); continue; }
    const own = listed(item);
    const allowed = closure(item.name);
    for (const name of readdirSync(resolve(root, 'registry', directory.name))) {
      const path = `registry/${directory.name}/${name}`;
      if (!source.test(name)) continue;
      files += 1;
      const text = readFileSync(resolve(root, path), 'utf8');
      // build-css.mjs and similar tooling stay in the folder but ship nothing; only files that import or are imported matter for the item's code.
      if (!own.has(path) && !/\.mjs$/.test(name)) errors.push(`BORING-BLOCKS ${path}: not listed in item ${item.name} of registry.json`);
      for (const [, specifier] of text.matchAll(importPattern)) {
        const ui = /^@\/components\/ui\/([\w-]+)$/.exec(specifier);
        if (ui) { used.add(ui[1]); if (!SHADCN_BUILTINS.includes(ui[1])) errors.push(`BORING-BLOCKS ${path}: imports ${specifier}, which is not one of the shadcn components the app installs (SHADCN_BUILTINS: ${SHADCN_BUILTINS.join(', ')})`); continue; }
        const hook = /^@\/hooks\/([\w-]+)$/.exec(specifier);
        if (hook) { if (!SHADCN_HOOKS.includes(hook[1])) errors.push(`BORING-BLOCKS ${path}: imports ${specifier}, which no shadcn component of SHADCN_BUILTINS installs (allowed: ${SHADCN_HOOKS.join(', ')})`); continue; }
        if (!specifier.startsWith('.')) continue;
        const target = posix.normalize(posix.join('registry', directory.name, specifier));
        const match = /^registry\/([^/]+)\/([^/]+)$/.exec(target);
        if (!match) { errors.push(`BORING-BLOCKS ${path}: import ${specifier} leaves the registry folders`); continue; }
        const [, other, base] = match;
        if (other === directory.name) continue;
        const file = [...items.get(other)?.files ?? []].map((entry) => entry.path).find((entry) => entry.replace(/\.[^.]+$/, '') === `registry/${other}/${base}`);
        if (!items.has(other) || !allowed.has(other)) errors.push(`BORING-BLOCKS ${path}: imports ${specifier} from item ${other}, which ${item.name} does not depend on (registryDependencies)`);
        else if (!file) errors.push(`BORING-BLOCKS ${path}: imports ${specifier}, which item ${other} does not list`);
      }
    }
    for (const file of own) if (!existsSync(resolve(root, file))) errors.push(`BORING-BLOCKS ${item.name}: listed file ${file} does not exist`);
  }
  for (const name of SHADCN_BUILTINS) if (!used.has(name)) errors.push(`BORING-BLOCKS SHADCN_BUILTINS: no block imports @/components/ui/${name}; drop it from the list and from the app setup command`);
  if (!readFileSync(resolve(root, 'registry/README.md'), 'utf8').includes(APP_SETUP)) errors.push(`BORING-BLOCKS registry/README.md: quote the app's shadcn setup exactly: ${APP_SETUP}`);
  const core = items.get('pi-chat');
  if (core) {
    for (const dependency of closure('pi-chat')) if (dependency.startsWith('pi-chat-') || CORE_EXCLUDED_ITEMS.includes(dependency)) errors.push(`BORING-BLOCKS pi-chat: the core chat must not depend on the optional feature item ${dependency}; the host plugs it in through the chat's props`);
    for (const dependency of core.dependencies ?? []) if (!CORE_PACKAGES.includes(packageName(dependency))) errors.push(`BORING-BLOCKS pi-chat: the core chat must not declare ${packageName(dependency)}; it belongs to an optional pi-chat-* item (core packages: ${CORE_PACKAGES.join(', ')})`);
    const lines = (core.files ?? []).reduce((total, file) => total + (existsSync(resolve(root, file.path)) ? readFileSync(resolve(root, file.path), 'utf8').split('\n').length : 0), 0);
    if ((core.files ?? []).length > CORE_BUDGET.files || lines > CORE_BUDGET.lines) errors.push(`BORING-BLOCKS pi-chat: the core chat has ${(core.files ?? []).length} files and ${lines} lines, over its budget of ${CORE_BUDGET.files} files and ${CORE_BUDGET.lines} lines; ship the feature as an optional pi-chat-* item plugged in through the chat's props`);
    for (const file of core.files ?? []) {
      const base = posix.basename(file.path).replace(/\.[^.]+$/, '');
      if (CORE_EXCLUDED_FILES.includes(base)) errors.push(`BORING-BLOCKS ${file.path}: the core chat ships ${base}, a card module that belongs to its optional item (pi-chat-question, pi-chat-approval, pi-chat-subagent or pi-artifacts)`);
      if (!existsSync(resolve(root, file.path))) continue;
      for (const [, specifier] of readFileSync(resolve(root, file.path), 'utf8').matchAll(importPattern)) if (CORE_EXCLUDED.includes(specifier)) errors.push(`BORING-BLOCKS ${file.path}: the core chat imports ${specifier}; move that feature to its optional pi-chat-* item`);
    }
  }
  for (const item of items.values()) for (const file of item.files ?? []) {
    const base = posix.basename(file.path);
    if (!['pi-chat', 'pi-app', 'documents'].includes(item.name) && !/-kinds?\.tsx?$/.test(base)) continue;
    if (!existsSync(resolve(root, file.path))) continue;
    for (const [, specifier] of readFileSync(resolve(root, file.path), 'utf8').matchAll(staticValueImport)) {
      if (!specifier.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(file.path), specifier)).replace(/^registry\//, '').replace(/\.tsx?$/, '');
      if (LAZY_VIEWS.includes(target)) errors.push(`BORING-BLOCKS ${file.path}: imports the view ${target} statically; load it through its kind's \`load: () => import(...)\` so it stays in its own chunk`);
    }
  }
  for (const cycle of importCycles(root, cycleFolders(root))) errors.push(`BORING-BLOCKS import cycle: ${cycle.join(' -> ')} (move the shared piece to the module that owns it so imports go one way)`);
  return { errors, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRegistryBlocks(realpathSync(fileURLToPath(new URL('../', import.meta.url))));
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`ok: ${result.files} registry source files are listed in their item with their type and target, and import only items they depend on; no import cycle in registry blocks or package sources`);
}
