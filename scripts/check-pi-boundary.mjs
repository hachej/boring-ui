import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkManifest, checkSource, hasDeclaredTests } from './pi-policy.mjs';
import { isContractOnly } from './is-contract-only.mjs';
import { implementationEvidence } from './implementation-evidence.mjs';
import { gitIgnored, walkProject } from './project-files.mjs';
import ts from 'typescript';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const TEST_PATH = /^test\/(?:[\w-]+\/)*[\w.-]+\.test\.mjs$/;

/**
 * Feature laws (for example SELF-1..4) are owned beside their package, indexed in docs/LAWS.md and registered in VERIFY.json `features`.
 * Structural evidence is a registered `node --test` command run by `verify`; runtime evidence is a journey (`npm run <script>` with its
 * selector), run with the journeys, never by `verify` and never relabelled as structural.
 */
function checkFeatures(root, registry, index) {
  const errors = [];
  const scripts = readJson(resolve(root, 'package.json')).scripts ?? {};
  for (const [id, feature] of Object.entries(registry.features ?? {})) {
    if (!/^[A-Z]+-\d+$/.test(id) || /^BORING-PI-/.test(id)) { errors.push(`invalid feature law id: ${id}`); continue; }
    if (typeof feature?.owner !== 'string' || !existsSync(resolve(root, feature.owner)) || !readFileSync(resolve(root, feature.owner), 'utf8').includes(`| ${id} |`)) errors.push(`feature law is not defined by its owner: ${id}`);
    if (!index.includes(`| ${id} |`)) errors.push(`law is not indexed: ${id}`);
    const verifiers = Array.isArray(feature?.verifiers) ? feature.verifiers : [];
    if (verifiers.filter((v) => v.scope === 'structural').length < 1 || verifiers.filter((v) => v.scope === 'runtime').length < 1) errors.push(`feature law needs structural and runtime evidence: ${id}`);
    for (const verifier of verifiers) {
      if (verifier.scope === 'structural') {
        if (verifier.kind !== 'command' || !Array.isArray(verifier.command) || verifier.command.length < 3 || verifier.command[0] !== 'node' || verifier.command[1] !== '--test' || verifier.command.slice(2).some((p) => !TEST_PATH.test(p))) { errors.push(`invalid test command: ${id}`); continue; }
        for (const path of verifier.command.slice(2)) {
          if (!existsSync(resolve(root, path))) errors.push(`missing registered test: ${id}: ${path}`);
          else if (!hasDeclaredTests(path, readFileSync(resolve(root, path), 'utf8'))) errors.push(`registered evidence declares no node:test tests: ${id}: ${path}`);
        }
      } else if (verifier.scope === 'runtime') {
        if (verifier.kind !== 'journey' || !Array.isArray(verifier.command) || verifier.command.length !== 3 || verifier.command[0] !== 'npm' || verifier.command[1] !== 'run' || !Object.hasOwn(scripts, verifier.command[2])) errors.push(`invalid journey command: ${id}`);
        if (!verifier.env || typeof verifier.env !== 'object' || !Object.keys(verifier.env).length || Object.values(verifier.env).some((value) => typeof value !== 'string' || !value)) errors.push(`journey evidence must name its selector: ${id}`);
      } else errors.push(`invalid evidence scope: ${id}`);
    }
  }
  return errors;
}

/**
 * SELF-2: agent-written content is never loaded into a host process. In packages/ and examples/ no source evaluates code (`eval`,
 * `Function`, `node:vm`) and every `import()`/`require()` names its module statically: a string, a package-prefixed template, or a URL
 * relative to the importing module's own file (`new URL(name, import.meta.url)`, the host's own folders). Bounded structural evidence: it
 * cannot follow data flow, which is why the runtime proof is a journey.
 */
export function scanHostExecution(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2023, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const add = (node, what) => found.push(`SELF-2 ${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${what}`);
  const literal = (node) => ts.isStringLiteralLike(node);
  const packageTemplate = (node) => ts.isTemplateExpression(node) && /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*\//.test(node.head.text);
  const ownUrl = (node) => ts.isNewExpression(node) && node.expression.getText(sf) === 'URL' && node.arguments?.length === 2 && node.arguments[1].getText(sf) === 'import.meta.url';
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(sf);
      if (callee === 'eval' || callee === 'globalThis.eval' || callee === 'Function' || callee === 'globalThis.Function') add(node, `${callee} evaluates code in the host`);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(sf) === 'require')) {
      const [specifier] = node.arguments;
      if (!specifier || !(literal(specifier) || packageTemplate(specifier) || (node.expression.kind === ts.SyntaxKind.ImportKeyword && ownUrl(specifier)))) add(node, `${node.expression.getText(sf)}() of a computed module could load workspace content`);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && literal(node.moduleSpecifier) && /^(?:node:)?vm$/.test(node.moduleSpecifier.text)) add(node, 'node:vm evaluates code in the host');
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** SELF-4: the self-evolution module changes tools only through the host's native registry (`install`/`uninstall`), never a registry of its own. */
export const SELF_EVOLUTION_SOURCE = 'packages/agent/src/self-evolving.ts';
export function scanNativeReload(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const found = [];
  const add = (node, what) => found.push(`SELF-4 ${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${what}`);
  let installs = 0;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'registry') {
      if (['install', 'uninstall'].includes(node.name.text)) installs++;
      else add(node, `registry.${node.name.text} is not a native registry change`);
    }
    if (ts.isIdentifier(node) && ['createRegistry', 'RegistryReader'].includes(node.text)) add(node, `${node.text}: no second registry`);
    if (ts.isPropertyAccessExpression(node) && ['snapshot', 'subscribe'].includes(node.name.text)) add(node, `${node.getText(sf)}: reload never reads or watches the registry`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!installs) found.push(`SELF-4 ${file}: no native registry.install()`);
  return found;
}

export function checkHostExecution(root) {
  const errors = [];
  let files = 0;
  const ignored = gitIgnored(root);
  for (const top of ['packages', 'examples']) if (existsSync(resolve(root, top))) walkProject(root, top, (entry, file) => {
    if (entry.isSymbolicLink()) return false;
    if (entry.isDirectory() || !/\.(?:[cm]?[jt]sx?)$/.test(entry.name) || entry.name.endsWith('.d.ts')) return;
    files++;
    errors.push(...scanHostExecution(file, readFileSync(resolve(root, file), 'utf8')));
  }, ignored);
  const reload = resolve(root, SELF_EVOLUTION_SOURCE);
  if (existsSync(reload)) errors.push(...scanNativeReload(SELF_EVOLUTION_SOURCE, readFileSync(reload, 'utf8')));
  return { errors, files };
}

export function loadBoundary(root) {
  const policy = readJson(resolve(root, 'ARCHITECTURE.json'));
  const registry = readJson(resolve(root, 'VERIFY.json'));
  if (registry.owner !== 'INVARIANTS.md') throw new Error('root registry must name INVARIANTS.md');
  const laws = [...readFileSync(resolve(root, registry.owner), 'utf8').matchAll(/^## (BORING-PI-\d+) — /gm)].map((m) => m[1]);
  const index = readFileSync(resolve(root, 'docs/LAWS.md'), 'utf8');
  const errors = [];
  errors.push(...checkFeatures(root, registry, index));
  // Feature laws owned by one package (`VERIFY.json.packageLaws`): the same registry, index and runtime-slot rules as the
  // root laws, defined once in `packages/<package>/INVARIANTS.md` under their own prefix. The root rule is unchanged.
  const owners = new Map(); // owner path -> { prefix, package }
  const lawPackage = new Map(); // law id -> owning package
  if (registry.packageLaws !== undefined && !Array.isArray(registry.packageLaws)) errors.push('packageLaws must be a list');
  for (const entry of Array.isArray(registry.packageLaws) ? registry.packageLaws : []) {
    const valid = entry && typeof entry === 'object' && /^[A-Z][A-Z0-9]*$/.test(entry.prefix ?? '') && entry.prefix !== 'BORING'
      && typeof entry.package === 'string' && Object.hasOwn(policy.packages, entry.package) && entry.owner === `packages/${entry.package}/INVARIANTS.md`;
    if (!valid || owners.has(entry.owner) || [...owners.values()].some((o) => o.prefix === entry.prefix)) { errors.push(`invalid package law owner: ${JSON.stringify(entry)}`); continue; }
    if (!existsSync(resolve(root, entry.owner))) { errors.push(`missing package law owner: ${entry.owner}`); continue; }
    owners.set(entry.owner, { prefix: entry.prefix, package: entry.package });
    for (const match of readFileSync(resolve(root, entry.owner), 'utf8').matchAll(new RegExp(`^## (${entry.prefix}-\\d+) — `, 'gm'))) {
      laws.push(match[1]); lawPackage.set(match[1], entry.package);
    }
  }
  const lawHeading = new RegExp(`^## ((?:BORING-PI${[...owners.values()].map((o) => `|${o.prefix}`).join('')})-\\d+) — `, 'gm');
  const packages = new Set();
  let sources = 0;
  let contracts = 0;
  if (JSON.stringify(policy.sourceRoots) !== '["packages"]') errors.push('source roots must cover declared packages');
  if (!laws.length || new Set(laws).size !== laws.length || [...new Set([...laws, ...Object.keys(registry.invariants), ...Object.keys(policy.runtimeProofs ?? {})])].some((id) => !laws.includes(id) || !Object.hasOwn(registry.invariants, id) || !Object.hasOwn(policy.runtimeProofs ?? {}, id))) errors.push('law definitions/registry/required runtime proofs are duplicate or unmatched');
  for (const id of laws) {
    if (!index.includes(`| ${id} |`)) errors.push(`law is not indexed: ${id}`);
    const rule = registry.invariants[id];
    if (!rule?.appliesTo?.length || rule.appliesTo.some((p) => !policy.packages[p])) errors.push(`invalid package applicability: ${id}`);
    else if (lawPackage.has(id) && !rule.appliesTo.includes(lawPackage.get(id))) errors.push(`package law does not apply to its owner: ${id}`);
    if (!rule?.verifiers?.length) { errors.push(`missing evidence: ${id}`); continue; }
    const runtime = rule.verifiers.filter((v) => v.scope === 'runtime');
    if (runtime.length !== 1 || JSON.stringify(runtime[0].command) !== JSON.stringify(['node', '--test', policy.runtimeProofs[id]])) errors.push(`missing/changed required runtime proof slot: ${id}`);
    for (const verifier of rule.verifiers) {
      if (!['structural', 'runtime'].includes(verifier.scope)) errors.push(`invalid evidence scope: ${id}`);
      if (!['command', 'pending'].includes(verifier.kind) || !Array.isArray(verifier.command) || verifier.command.length < 3 || verifier.command[0] !== 'node' || verifier.command[1] !== '--test' || verifier.command.slice(2).some((p) => !/^test\/(?:[\w-]+\/)*[\w.-]+\.test\.mjs$/.test(p))) { errors.push(`invalid test command: ${id}`); continue; }
      if (verifier.kind === 'pending' && !verifier.reason) errors.push(`unexplained deferral: ${id}`);
      if (verifier.kind === 'command') for (const path of verifier.command.slice(2)) {
        if (!existsSync(resolve(root, path))) errors.push(`missing registered test: ${id}: ${path}`);
        else if (!hasDeclaredTests(path, readFileSync(resolve(root, path), 'utf8'))) errors.push(`registered evidence declares no node:test tests: ${id}: ${path}`);
      }
    }
  }
  const visitGraph = (name, stack = []) => {
    if (stack.includes(name)) { errors.push(`dependency cycle: ${[...stack, name].join(' -> ')}`); return; }
    for (const target of [...policy.packages[name].dependsOn, ...policy.packages[name].typeOnlyDependsOn]) {
      if (!policy.packages[target]) errors.push(`undeclared dependency target: ${target}`); else visitGraph(target, [...stack, name]);
    }
  };
  for (const name of Object.keys(policy.packages)) visitGraph(name);
  errors.push(...checkManifest(readJson(resolve(root, 'package.json')), undefined, policy));
  // Only what git ignores is skipped (package-root `dist`, dependencies, tool output); a directory called src/dist is authored source.
  const ignored = gitIgnored(root);
  const inspect = (entry, file) => {
    const path = resolve(root, file);
    if (entry.isSymbolicLink()) { errors.push(`source symlink is not auditable: ${file}`); return; }
    if (entry.isDirectory()) return;
    if (entry.name.endsWith('.md') && !owners.has(file)) for (const match of readFileSync(path, 'utf8').matchAll(lawHeading)) errors.push(`project law defined twice: ${match[1]} in ${file}`);
    if (entry.name === 'package.json') errors.push(...checkManifest(readJson(path), /^packages\/([^/]+)/.exec(file)?.[1], policy));
    if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      sources++;
      const name = /^packages\/([^/]+)\//.exec(file)?.[1];
      const text = readFileSync(path, 'utf8');
      if (isContractOnly(file, text)) contracts++;
      else if (name) packages.add(name);
      errors.push(...checkSource(file, text, policy));
    }
  };
  for (const path of policy.sourceRoots) if (existsSync(resolve(root, path))) walkProject(root, path, inspect, ignored);
  walkProject(root, 'docs', (entry, file) => {
    if (entry.isFile() && entry.name.endsWith('.md')) for (const match of readFileSync(resolve(root, file), 'utf8').matchAll(lawHeading)) errors.push(`project law defined twice: ${match[1]} in ${file}`);
  }, ignored);
  for (const path of ['patches', 'vendor']) if (existsSync(resolve(root, path))) walkProject(root, path, (entry, relativePath) => {
    const file = resolve(root, relativePath);
    if (entry.isSymbolicLink()) { errors.push(`unreviewable vendor/patch symlink: ${file}`); return false; }
    if (entry.isDirectory()) { if (/pi-durable|pi-ai|earendil/.test(entry.name)) errors.push(`BORING-PI-4 vendored upstream directory: ${file}`); return; }
    if (/pi-durable|pi-ai|@earendil-works\/(?:pi|chord)/.test(`${entry.name}\n${readFileSync(file, 'utf8')}`)) errors.push(`BORING-PI-4 vendored/patched upstream file: ${file}`);
  }, ignored);
  const pending = [];
  for (const [id, rule] of Object.entries(registry.invariants)) for (const verifier of rule.verifiers) if (verifier.kind === 'pending') {
    pending.push({ id, ...verifier });
  }
  const implementation = implementationEvidence(root, packages);
  errors.push(...implementation.errors);
  return { policy, registry, errors, sources, contracts, pending, implementationProofs: implementation.proofs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  const result = loadBoundary(root);
  const host = checkHostExecution(root);
  if (result.errors.length || host.errors.length) { console.error([...result.errors, ...host.errors].join('\n')); process.exitCode = 1; }
  else {
    console.log(`ok: Pi complement policy, registry and ${result.sources} library source files (${result.contracts} erased-type files)`);
    console.log(`ok: SELF-2, ${host.files} package and example source files evaluate no code and load no computed module; SELF-4, reload changes only the native registry`);
    console.log(`${result.pending.length} runtime proofs DEFERRED; no runtime guarantee inferred from this structural check.`);
  }
}
