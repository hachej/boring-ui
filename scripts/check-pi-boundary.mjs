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

/**
 * BORING-PI-1 one harness: no host calls a pi-ai model function outside the native Harness. In packages/ and examples/ a file is
 * refused for a pi-ai reference unless it is in ONE_HARNESS_ALLOWED with a reason. Two rules, both lexical (one file, checker-resolved
 * bindings, no cross-file or property-name lookup):
 *  - Reference: `complete`, `stream` or `streamSimple` is imported from pi-ai, or read from a value bound to pi-ai: a namespace, a
 *    `createModels()` result, a binding declared with a pi-ai Models type (a local interface or alias is followed), or an alias,
 *    `??`/`||`/`&&`/`?:` fallback or destructuring of one.
 *  - Boundary: a file does not export a pi-ai value, a generation function, a factory or a namespace re-export of pi-ai. Another file
 *    can then reach the model only through a file the review has allowed.
 * Limits: a value that reaches a binding through an arbitrary function call is not followed; an untyped parameter is not known to be a
 * Models value. The runtime proof is the native Harness turn.
 */
export const ONE_HARNESS_ALLOWED = Object.freeze({
  'packages/agent/src/memory/optchat.ts': 'OptChat memory summarizer: a plain model call with no tools that compresses transcript lines. It is not an agent turn and runs no tool loop.',
  'packages/feedback/src/preview/agent.ts': 'Legacy debt (BORING-PI-1): the in-page preview subagent is a hand-rolled tool loop on Pi Models in the browser. It moves onto the native Harness; remove this entry in that change. See docs/architecture/FEEDBACK.md.',
  'packages/browser/src/models.ts': 'Browser model registry for settings (API keys, device-code sign-in): exports a Models value for the native Harness and calls no model.',
  'examples/feedback/model-preview.mjs': 'Gateway proof: builds the Models object over the host gateway and makes one-shot completions (previewComplete) outside any agent turn.',
  'packages/testing/src/model.ts': 'Fictional scripted model for tests or a keyless example: exports a Models value over a scripted provider for the native Harness. No real model is called.',
  'examples/bot/scripted-model.mjs': 'Fictional scripted model for tests or a keyless example: exports a Models value over a scripted provider for the native Harness. No real model is called.',
  'examples/feedback/builder.mjs': 'Fictional scripted model for tests or a keyless example: exports a Models value over a scripted provider for the native Harness. No real model is called.',
  'examples/feedback/server.mjs': 'Fictional scripted model for tests or a keyless example: exports a Models value over a scripted provider for the native Harness. No real model is called.',
  'examples/validated-output/scripted-model.mjs': 'Fictional scripted model for tests or a keyless example: exports a Models value over a scripted provider for the native Harness. No real model is called.',
});
const PI_AI_MODULE = /^@earendil-works\/pi-ai(?:\/|$)/;
const GENERATION = new Set(['complete', 'stream', 'streamSimple']);
const PI_VALUES = new Set([...GENERATION, 'createModels']);
const PI_MODEL_TYPES = new Set(['Models', 'MutableModels']);
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
};
const literalKey = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;

/** Findings for one file, from its own bindings only. */
function scanFile(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const host = {
    getSourceFile: (name) => name === file || name === `/${file}` ? sf : undefined,
    getDefaultLibFileName: () => 'lib.d.ts', writeFile: () => {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: (name) => name === file || name === `/${file}`,
    readFile: () => undefined, getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const checker = ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker();
  const symbol = (node) => checker.getSymbolAtLocation(node);
  const lines = [];
  const report = (node, message) => lines.push(`ONE_HARNESS ${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${message}`);
  const values = new Set(); // symbols bound to a pi-ai value: namespace, generation function, factory or a Models value
  const factories = new Set(); // symbols bound to pi-ai's createModels, directly or by a lexical alias
  const namespaces = new Set(); // symbols of pi-ai namespace imports
  const piTypes = new Set(); // symbols of pi-ai Models types

  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !PI_AI_MODULE.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) { namespaces.add(symbol(bindings.name)); values.add(symbol(bindings.name)); }
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (GENERATION.has(name)) report(element, `imports pi-ai ${name}`);
      if (PI_VALUES.has(name)) values.add(symbol(element.name));
      if (name === 'createModels') factories.add(symbol(element.name));
      if (PI_MODEL_TYPES.has(name)) piTypes.add(symbol(element.name));
    }
  }
  // A Models type, directly or through a local alias. Interfaces are not followed: they are not Models values.
  const isModelsType = (typeNode, seen = new Set()) => {
    if (!typeNode) return false;
    if (ts.isParenthesizedTypeNode(typeNode)) return isModelsType(typeNode.type, seen);
    if (ts.isUnionTypeNode(typeNode)) return typeNode.types.some((t) => isModelsType(t, seen));
    if (!ts.isTypeReferenceNode(typeNode)) return false;
    const name = typeNode.typeName;
    if (ts.isQualifiedName(name)) return PI_MODEL_TYPES.has(name.right.text) && namespaces.has(symbol(name.left));
    if (piTypes.has(symbol(name))) return true;
    for (const d of symbol(name)?.declarations ?? []) {
      if (ts.isTypeAliasDeclaration(d) && !seen.has(d)) { seen.add(d); if (isModelsType(d.type, seen)) return true; }
    }
    return false;
  };
  // The declared type of member `key`: a type literal, a local interface or alias, or a union of those. Other types are opaque.
  const memberIn = (members, key) => members.find((m) => ts.isPropertySignature(m) && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === key)?.type;
  const memberType = (typeNode, key, seen = new Set()) => {
    if (!typeNode) return undefined;
    if (ts.isParenthesizedTypeNode(typeNode)) return memberType(typeNode.type, key, seen);
    if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) return typeNode.types.map((t) => memberType(t, key, seen)).find(Boolean);
    if (ts.isTypeLiteralNode(typeNode)) return memberIn(typeNode.members, key);
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) for (const d of symbol(typeNode.typeName)?.declarations ?? []) {
      if (seen.has(d)) continue;
      seen.add(d);
      const found = ts.isInterfaceDeclaration(d) ? memberIn(d.members, key) : ts.isTypeAliasDeclaration(d) ? memberType(d.type, key, seen) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  // The declared type of an expression, followed through declared or initialized parameters and variables and member accesses.
  const typeOf = (node, depth = 0) => {
    node = unwrap(node);
    if (!node || depth > 8) return undefined;
    if (ts.isIdentifier(node)) {
      for (const d of symbol(node)?.declarations ?? []) {
        if (!ts.isParameter(d) && !ts.isVariableDeclaration(d)) continue;
        if (d.type) return d.type;
        if (d.initializer) return typeOf(d.initializer, depth + 1);
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(node)) return memberType(typeOf(node.expression, depth + 1), node.name.text);
    return undefined;
  };
  const memberDeclaresModels = (base, key) => isModelsType(memberType(typeOf(base), key));
  // `import()` or `require()` of pi-ai is the namespace itself, so it is a value like a namespace import.
  const isPiLoad = (call) => (call.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(call.expression) && call.expression.text === 'require'))
    && call.arguments[0] && ts.isStringLiteralLike(call.arguments[0]) && PI_AI_MODULE.test(call.arguments[0].text);
  // createModels itself, a lexical alias of it, or `ai.createModels` of a pi-ai value.
  const isFactoryRef = (node) => {
    node = unwrap(node);
    return ts.isIdentifier(node) ? factories.has(symbol(node)) : ts.isPropertyAccessExpression(node) && node.name.text === 'createModels' && valueOf(node.expression);
  };
  // Is this expression a pi-ai value? Member access yields a value through its base or a Models-typed member; a call only as a factory or load.
  const rootIsValue = (node) => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return values.has(symbol(node));
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = literalKey(node);
      return (key !== undefined && memberDeclaresModels(node.expression, key)) || rootIsValue(node.expression);
    }
    return ts.isCallExpression(node) && valueOf(node); // only a pi-ai factory or load yields a value; other calls do not
  };
  const valueOf = (node) => {
    node = unwrap(node);
    if (!node) return false;
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) return valueOf(node.left) || valueOf(node.right);
    if (ts.isConditionalExpression(node)) return valueOf(node.whenTrue) || valueOf(node.whenFalse);
    if (ts.isCallExpression(node)) return isPiLoad(node) || isFactoryRef(node.expression);
    // An object that carries a value (`return { models, ... }`) is an export of that value.
    if (ts.isObjectLiteralExpression(node)) return node.properties.some((p) => ts.isShorthandPropertyAssignment(p) ? values.has(checker.getShorthandAssignmentValueSymbol(p)) : ts.isPropertyAssignment(p) && valueOf(p.initializer));
    return rootIsValue(node);
  };
  // Bindings: a declaration typed as a Models value, or initialized from a pi-ai value, is one; so is a destructured member of one.
  const learn = (n) => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) {
      const init = n.initializer && unwrap(n.initializer);
      const whole = init && valueOf(init);
      if (ts.isIdentifier(n.name)) {
        if (whole || isModelsType(n.type)) values.add(symbol(n.name));
        if (init && isFactoryRef(init)) factories.add(symbol(n.name));
      } else if (ts.isObjectBindingPattern(n.name)) {
        const parent = n.type ?? typeOf(init);
        for (const element of n.name.elements) if (ts.isIdentifier(element.name)) {
          const key = (element.propertyName ?? element.name).text;
          if (whole || isModelsType(memberType(parent, key))) values.add(symbol(element.name));
          if (whole && key === 'createModels') factories.add(symbol(element.name)); // only from a pi-ai binding
        }
      }
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(unwrap(n.left))) {
      if (valueOf(n.right)) values.add(symbol(unwrap(n.left)));
      if (isFactoryRef(n.right)) factories.add(symbol(unwrap(n.left)));
    }
  };
  for (let size = -1; size !== values.size + factories.size;) { size = values.size + factories.size; walk(sf, learn); }

  // Returns a pi-ai value: an arrow or function whose result is one.
  // Stops at nested functions: their returns belong to them, not to this function.
  const returnsValue = (fn) => {
    if (!fn.body) return false;
    if (!ts.isBlock(fn.body)) return valueOf(fn.body);
    let found = false;
    const visit = (n) => {
      if (found) return;
      if (ts.isReturnStatement(n) && n.expression && valueOf(n.expression)) found = true;
      else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn.body, visit);
    return found;
  };
  const isFunction = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
  // A local function, or a variable initialized with one, whose result is a pi-ai value.
  const localFunctionReturns = (sym) => (sym?.declarations ?? []).some((d) => ts.isFunctionDeclaration(d) ? returnsValue(d)
    : ts.isVariableDeclaration(d) && d.initializer && isFunction(unwrap(d.initializer)) && returnsValue(unwrap(d.initializer)));
  const exportsValue = (expr) => {
    const node = unwrap(expr);
    return valueOf(node) || (isFunction(node) ? returnsValue(node) : ts.isIdentifier(node) && localFunctionReturns(symbol(node)));
  };
  walk(sf, (n) => {
    // Reference: a generation function is read from a pi-ai value.
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && GENERATION.has(literalKey(n)) && rootIsValue(n.expression)) {
      report(n, `${n.getText(sf)} is a pi-ai generation call outside the native Harness`);
    }
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && valueOf(n.initializer)) for (const element of n.name.elements) {
      const key = (element.propertyName ?? element.name).text;
      if (GENERATION.has(key)) report(element, `destructures pi-ai ${key} from a pi-ai value`);
    }
  });
  // Boundary: no export of a pi-ai value, a generation function, a factory or a pi-ai namespace, directly or through a function.
  for (const statement of sf.statements) {
    if (ts.isExportDeclaration(statement)) {
      const from = statement.moduleSpecifier;
      if (from && ts.isStringLiteral(from) && PI_AI_MODULE.test(from.text)) {
        const clause = statement.exportClause;
        if (!clause || ts.isNamespaceExport(clause)) report(statement, `re-exports pi-ai ${clause ? 'namespace' : 'in full'}`);
        else for (const element of clause.elements) if (PI_VALUES.has((element.propertyName ?? element.name).text)) report(element, `re-exports pi-ai ${(element.propertyName ?? element.name).text}`);
      } else if (!from && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const sym = checker.getExportSpecifierLocalTargetSymbol(element);
          if (values.has(sym) || localFunctionReturns(sym)) report(element, `exports a pi-ai value: ${element.name.text}`);
        }
      }
    } else if (ts.isExportAssignment(statement) && exportsValue(statement.expression)) report(statement, 'exports a pi-ai value as default');
    else if (ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer && exportsValue(declaration.initializer)) report(declaration, `exports a pi-ai value: ${declaration.name.getText(sf)}`);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && returnsValue(statement)) {
      report(statement, `exports a function that returns a pi-ai value: ${statement.name?.text ?? 'default'}`);
    }
  }
  return lines;
}

function walk(node, visit) { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); }

/** Findings per repository file, each from that file's own bindings. */
export function analyzeOneHarness(texts) {
  return { findings: new Map([...texts].map(([file, text]) => [file, scanFile(file, text)])) };
}

/** One source text, analyzed alone (the fixture form used by tests). */
export function scanOneHarness(file, source) {
  return scanFile(file, source);
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
