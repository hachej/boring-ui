import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
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

/**
 * BORING-PI-1 one harness: no host calls a pi-ai model function outside the native Harness. In packages/ and examples/, a reference to
 * pi-ai generation is refused unless its file is in ONE_HARNESS_ALLOWED with a reason. References are:
 *  - importing `complete`, `stream` or `streamSimple` from pi-ai;
 *  - `complete`, `stream` or `streamSimple` read from a Models value (a pi-ai `createModels()` result, a binding typed `Models`, a property
 *    typed `Models`, or any alias, `.bind` or destructuring of one), or from a pi-ai namespace;
 *  - exporting a Models value or a generation function, so that another file can call it.
 * Bindings are resolved per file with the TypeScript checker (no dependency resolution beyond repository paths); a consumer of a
 * model-bearing export is tracked through its import. Unrelated `.complete()` receivers are not flagged. Bounded structural evidence:
 * it cannot follow values through arbitrary functions or dynamic property names; the runtime proof is the native Harness turn.
 */
export const ONE_HARNESS_ALLOWED = Object.freeze({
  'packages/agent/src/memory/optchat.ts': 'OptChat memory summarizer: a plain model call with no tools that compresses transcript lines. It is not an agent turn and runs no tool loop.',
  'packages/feedback/src/preview/agent.ts': 'Legacy debt (BORING-PI-1): the in-page preview subagent is a hand-rolled tool loop on Pi Models in the browser. It moves onto the native Harness; remove this entry in that change. See docs/architecture/FEEDBACK.md.',
  'packages/browser/src/models.ts': 'Browser model registry for settings (API keys, device-code sign-in): exports a Models value for the native Harness and calls no model.',
  'examples/feedback/model-preview.mjs': 'Gateway proof: builds the Models object over the host gateway and makes one-shot completions (previewComplete) outside any agent turn.',
});
const PI_AI_MODULE = /^@earendil-works\/pi-ai(?:\/|$)/;
const GENERATION = new Set(['complete', 'stream', 'streamSimple']);
const PI_MODELS = new Set([...GENERATION, 'createModels']);
const PI_MODEL_TYPES = new Set(['Models', 'MutableModels']);
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '/index.ts', '/index.js', '/index.mjs'];

const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
};
const keyOf = (node) => ts.isPropertyAccessExpression(node) ? node.name.text
  : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
const nameOf = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isPrivateIdentifier(node)) ? node.text : undefined;

/** 'pi' for pi-ai, a repository file for a package or relative module we can read, null for anything else. */
function resolveModule(from, spec, files) {
  if (PI_AI_MODULE.test(spec)) return 'pi';
  let base;
  if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else {
    const match = /^@hachej\/boring-([\w-]+)(?:\/(.+))?$/.exec(spec);
    if (!match) return null;
    base = `packages/${match[1]}/src/${match[2] ?? 'index'}`;
  }
  const stem = base.replace(/\.(?:[cm]?jsx?|tsx?)$/, '');
  return MODULE_EXTENSIONS.map((suffix) => stem + suffix).find((candidate) => files.has(candidate)) ?? null;
}

function walk(node, visit) { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); }

/** One file: its checker-resolved symbols and its static imports. */
function readUnit(file, text, files) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const host = {
    getSourceFile: (name) => name === file || name === `/${file}` ? sf : undefined,
    getDefaultLibFileName: () => 'lib.d.ts', writeFile: () => {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: (name) => name === file || name === `/${file}`,
    readFile: () => undefined, getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const checker = ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker();
  const symbol = (node) => checker.getSymbolAtLocation(node);
  const unit = { file, sf, checker, symbol, named: new Map(), spaces: new Map(), piTypes: new Set() };
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const source = resolveModule(file, statement.moduleSpecifier.text, files);
    const clause = statement.importClause;
    if (clause.name) unit.named.set(symbol(clause.name), { source, name: 'default' });
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) unit.spaces.set(symbol(bindings.name), source);
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      const entry = { source, name: (element.propertyName ?? element.name).text, node: element };
      unit.named.set(symbol(element.name), entry);
      if (source === 'pi' && PI_MODEL_TYPES.has(entry.name)) unit.piTypes.add(symbol(element.name));
    }
  }
  return unit;
}

/**
 * The analysis of one file given the model-bearing export names of every file. Tracked values: pi-ai generation and factory
 * imports, model-bearing imports, declarations typed with a pi-ai Models type, and any alias, bind or destructuring of them.
 */
function analyzeUnit(unit, bearing, modelProps, files) {
  const { symbol } = unit;
  const tracked = new Set(); // symbols holding a Models value or a generation function
  const spaces = new Map(unit.spaces); // namespace symbols -> 'pi' | repository file | null (external)
  for (const [sym, { source, name }] of unit.named) {
    if ((source === 'pi' && PI_MODELS.has(name)) || (source && source !== 'pi' && bearing.get(source).has(name))) tracked.add(sym);
  }
  const namespaceOf = (node) => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return spaces.get(symbol(node));
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const spec = node.arguments[0];
      return spec && ts.isStringLiteralLike(spec) ? resolveModule(unit.file, spec.text, files) : undefined;
    }
    return undefined;
  };
  // The declared type IS a pi-ai Models type (or a union or parenthesis of one). An object that merely contains one is not a Models value.
  const isPiTypeRef = (node) => {
    if (!node) return false;
    if (ts.isParenthesizedTypeNode(node)) return isPiTypeRef(node.type);
    if (ts.isUnionTypeNode(node)) return node.types.some(isPiTypeRef);
    if (!ts.isTypeReferenceNode(node)) return false;
    const name = node.typeName;
    if (ts.isIdentifier(name)) return unit.piTypes.has(symbol(name));
    return ts.isQualifiedName(name) && PI_MODEL_TYPES.has(name.right.text) && spaces.get(symbol(name.left)) === 'pi';
  };
  const trackedMember = (base, key) => {
    const source = namespaceOf(base);
    if (source !== undefined) return source === 'pi' ? PI_MODELS.has(key) : Boolean(source && bearing.get(source).has(key));
    return (!GENERATION.has(key) && modelProps.has(key)) || tracked_(base);
  };
  const tracked_ = (node) => {
    node = unwrap(node);
    if (!node) return false;
    if (ts.isIdentifier(node)) return tracked.has(symbol(node));
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = keyOf(node);
      return key !== undefined && trackedMember(node.expression, key);
    }
    if (ts.isCallExpression(node)) {
      if (namespaceOf(node) !== undefined) return false;
      return tracked_(node.expression);
    }
    // Value flow: a fallback or choice between values is a value of either side (`summarizer.models ?? runtimeModels`).
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) return tracked_(node.left) || tracked_(node.right);
    if (ts.isConditionalExpression(node)) return tracked_(node.whenTrue) || tracked_(node.whenFalse);
    return false;
  };
  const learn = (n) => {
    if (ts.isVariableDeclaration(n)) {
      const init = n.initializer && unwrap(n.initializer);
      if (ts.isIdentifier(n.name)) {
        if (init && namespaceOf(init) !== undefined) spaces.set(symbol(n.name), namespaceOf(init));
        if ((init && tracked_(init)) || isPiTypeRef(n.type)) tracked.add(symbol(n.name));
      } else if (ts.isObjectBindingPattern(n.name) && init) for (const element of n.name.elements) {
        const key = nameOf(element.propertyName ?? element.name);
        if (key !== undefined && ts.isIdentifier(element.name) && (modelProps.has(key) || trackedMember(init, key))) tracked.add(symbol(element.name));
      }
    }
    if (ts.isParameter(n)) {
      if (ts.isIdentifier(n.name) && isPiTypeRef(n.type)) tracked.add(symbol(n.name));
      if (ts.isObjectBindingPattern(n.name)) for (const element of n.name.elements) {
        const key = nameOf(element.propertyName ?? element.name);
        if (key !== undefined && ts.isIdentifier(element.name) && modelProps.has(key)) tracked.add(symbol(element.name));
      }
    }
    if ((ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) && isPiTypeRef(n.type)) { const key = nameOf(n.name); if (key !== undefined && !GENERATION.has(key)) modelProps.add(key); }
    // An object literal property that is directly a Models value (`{ models: createModels() }`). Only direct values: a member access
    // is never a property source, so the set cannot feed itself.
    if (ts.isPropertyAssignment(n)) {
      const init = unwrap(n.initializer);
      const direct = ts.isIdentifier(init) ? tracked.has(symbol(init)) : ts.isCallExpression(init) && ts.isIdentifier(unwrap(init.expression)) && tracked.has(symbol(unwrap(init.expression)));
      const key = nameOf(n.name);
      if (direct && key !== undefined && !GENERATION.has(key)) modelProps.add(key);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(unwrap(n.left)) && tracked_(n.right)) tracked.add(symbol(unwrap(n.left)));
  };
  // Pure growth to a fixpoint: every set only gains members.
  let size = -1;
  while (size !== tracked.size + modelProps.size + spaces.size) { size = tracked.size + modelProps.size + spaces.size; walk(unit.sf, learn); }
  const exported = new Set();
  for (const statement of unit.sf.statements) {
    if (ts.isExportDeclaration(statement)) {
      const source = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? resolveModule(unit.file, statement.moduleSpecifier.text, files) : undefined;
      if (!statement.exportClause) {
        if (source === 'pi') for (const name of PI_MODELS) exported.add(name);
        else if (source) for (const name of bearing.get(source)) exported.add(name);
      } else if (ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        if (statement.moduleSpecifier) {
          const local = (element.propertyName ?? element.name).text;
          if (source === 'pi' ? PI_MODELS.has(local) : source && bearing.get(source).has(local)) exported.add(exportedName);
        } else if (tracked.has(unit.checker.getExportSpecifierLocalTargetSymbol(element))) exported.add(exportedName);
      }
    } else if (ts.isExportAssignment(statement)) {
      if (tracked_(statement.expression)) exported.add('default');
    } else if (ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer && tracked_(declaration.initializer)) exported.add(declaration.name.text);
    } else if (ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      let returns = false;
      walk(statement, (n) => { if (ts.isReturnStatement(n) && n.expression && tracked_(n.expression)) returns = true; });
      if (returns) exported.add(statement.name.text);
    }
  }
  return { exported, tracked_, trackedMember };
}

/** Every file's findings. `texts` maps repository paths to source; an empty allowlist reports every site. */
export function analyzeOneHarness(texts) {
  const files = new Set(texts.keys());
  const units = new Map([...texts].map(([file, text]) => [file, readUnit(file, text, files)]));
  const bearing = new Map([...files].map((file) => [file, new Set()]));
  // Model-bearing exports and property names holding Models grow to a fixpoint: re-exports, cross-file consumers and a
  // Models-typed property declared in another file are all seen.
  const modelProps = new Set();
  let size = -1;
  while (size !== [...bearing.values()].reduce((sum, set) => sum + set.size, 0) + modelProps.size) {
    size = [...bearing.values()].reduce((sum, set) => sum + set.size, 0) + modelProps.size;
    for (const unit of units.values()) for (const name of analyzeUnit(unit, bearing, modelProps, files).exported) bearing.get(unit.file).add(name);
  }
  const findings = new Map();
  for (const unit of units.values()) {
    const { exported, trackedMember } = analyzeUnit(unit, bearing, modelProps, files);
    const lines = [];
    const at = (node) => unit.sf.getLineAndCharacterOfPosition(node.getStart(unit.sf)).line + 1;
    const report = (node, message) => lines.push(`ONE_HARNESS ${unit.file}:${at(node)}: ${message}`);
    for (const { source, name, node } of unit.named.values()) if (source === 'pi' && GENERATION.has(name)) report(node, `imports pi-ai ${name}`);
    walk(unit.sf, (n) => {
      if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && GENERATION.has(keyOf(n)) && trackedMember(n.expression, keyOf(n))) {
        report(n, `${n.getText(unit.sf)} reads a pi-ai model call outside the native Harness`);
      }
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) for (const element of n.name.elements) {
        const key = nameOf(element.propertyName ?? element.name);
        if (GENERATION.has(key) && trackedMember(n.initializer, key)) report(element, `destructures pi-ai ${key} from a Models value`);
      }
    });
    for (const name of exported) report(unit.sf, `exports a Models value or pi-ai generation: ${name}`);
    findings.set(unit.file, lines);
  }
  return { findings, files: files.size };
}

/** One source text, analyzed alone (the fixture form used by tests). */
export function scanOneHarness(file, source) {
  return analyzeOneHarness(new Map([[file, source]])).findings.get(file);
}

/** Every package and example source file. The allowlist is exact in both directions: an entry must still have a finding. */
export function checkOneHarness(root, allowed = ONE_HARNESS_ALLOWED) {
  const errors = [];
  const texts = new Map();
  const ignored = gitIgnored(root);
  for (const top of ['packages', 'examples']) if (existsSync(resolve(root, top))) walkProject(root, top, (entry, file) => {
    if (entry.isSymbolicLink()) return false;
    if (entry.isDirectory() || !/\.(?:[cm]?[jt]sx?)$/.test(entry.name) || entry.name.endsWith('.d.ts')) return;
    texts.set(file, readFileSync(resolve(root, file), 'utf8'));
  }, ignored);
  const { findings } = analyzeOneHarness(texts);
  const flagged = new Set();
  for (const [file, lines] of findings) {
    if (!lines.length) continue;
    flagged.add(file);
    if (!Object.hasOwn(allowed, file)) errors.push(...lines);
  }
  for (const file of Object.keys(allowed)) if (!flagged.has(file)) errors.push(`ONE_HARNESS allowlist entry no longer matches a pi-ai reference: ${file}`);
  return { errors, files: texts.size, allowed: [...flagged].filter((file) => Object.hasOwn(allowed, file)) };
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
  const harness = checkOneHarness(root);
  if (result.errors.length || host.errors.length || harness.errors.length) { console.error([...result.errors, ...host.errors, ...harness.errors].join('\n')); process.exitCode = 1; }
  else {
    console.log(`ok: Pi complement policy, registry and ${result.sources} library source files (${result.contracts} erased-type files)`);
    console.log(`ok: SELF-2, ${host.files} package and example source files evaluate no code and load no computed module; SELF-4, reload changes only the native registry`);
    console.log(`ok: BORING-PI-1 one harness, ${harness.files} package and example files: no pi-ai model reference outside ${harness.allowed.length} reviewed allowlisted site(s)`);
    console.log(`${result.pending.length} runtime proofs DEFERRED; no runtime guarantee inferred from this structural check.`);
  }
}
