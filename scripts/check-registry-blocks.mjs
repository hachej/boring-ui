// Guard: registry items are blocks with one direction of dependency.
//
// 1. Every source file under registry/<item>/ is listed in that item of registry.json (nothing ships by accident or is
//    imported by path from outside the item).
// 2. A file may import another item (`../<item>/<file>`) only when that item is in its own item's registryDependencies
//    (transitively) and lists the file. pi-chat declares none, so the chat never imports pi-ambient or pi-workspace, and
//    pi-workspace never imports pi-ambient (the host swaps AmbientChat in when the chat floats).
// 3. Declared registryDependencies name items of this registry.
// 4. File types and targets: a `use*.ts` file is `registry:hook`, any other `.ts` is `registry:lib` (or a declared `registry:hook`), a
//    `.tsx` is a component (`registry:ui` for a shared primitive such as the button); every file has the target
//    `components/<item>/<file>`, so the installed folders mirror registry/ and the sibling imports above resolve.
// 5. No file name is shipped by two items: a shared helper is one item (utils, button) that the others depend on.
// 6. No import cycle in registry blocks or package sources (packages/*/src), type-only and lazy imports included: copied-in
//    code with a cycle breaks some bundlers, HMR and tree-shaking. Shared types and helpers live in the module that owns them
//    (a leaf lib never imports a component), and a module that needs them imports them in one direction.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIgnored, walkProject } from './project-files.mjs';

const source = /\.(?:tsx?|jsx?|mjs)$/;
/** registryDependencies use the namespace the consumer maps in components.json (`"registries": { "@boring-ui": "<served public/r>/{name}.json" }`). */
const namespace = '@boring-ui/';
const local = (dependency) => dependency.startsWith(namespace) ? dependency.slice(namespace.length) : dependency;
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
  const owners = new Map();
  for (const item of items.values()) {
    for (const dependency of item.registryDependencies ?? []) if (!dependency.startsWith(namespace) || !items.has(local(dependency))) errors.push(`BORING-BLOCKS ${item.name}: registryDependencies must be ${namespace}<item of this registry> (found ${dependency})`);
    for (const file of item.files ?? []) {
      const base = posix.basename(file.path);
      const where = `BORING-BLOCKS ${file.path}`;
      if (file.target !== `components/${item.name}/${base}` || file.path !== `registry/${item.name}/${base}`) errors.push(`${where}: lives in registry/${item.name}/ and installs to components/${item.name}/${base} (target ${file.target ?? 'missing'})`);
      if (/^use[A-Z-].*\.ts$/.test(base) && file.type !== 'registry:hook') errors.push(`${where}: a use*.ts file is registry:hook (found ${file.type})`);
      else if (/\.ts$/.test(base) && file.type !== 'registry:lib' && file.type !== 'registry:hook') errors.push(`${where}: a .ts helper is registry:lib (found ${file.type})`);
      else if (/\.tsx$/.test(base) && file.type !== 'registry:component' && file.type !== 'registry:ui') errors.push(`${where}: a .tsx file is registry:component or registry:ui (found ${file.type})`);
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
  for (const cycle of importCycles(root, cycleFolders(root))) errors.push(`BORING-BLOCKS import cycle: ${cycle.join(' -> ')} (move the shared piece to the module that owns it so imports go one way)`);
  return { errors, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRegistryBlocks(realpathSync(fileURLToPath(new URL('../', import.meta.url))));
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`ok: ${result.files} registry source files are listed in their item with their type and target, and import only items they depend on; no import cycle in registry blocks or package sources`);
}
