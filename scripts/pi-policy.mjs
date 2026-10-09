import { dirname, posix } from 'node:path';
import ts from 'typescript';

const upstream = (name, policy) => Object.keys(policy.upstreamExports).find((root) => name === root || name.startsWith(`${root}/`) || name.startsWith(`${root}@`));
const matches = (value, patterns) => patterns.some((pattern) => pattern.endsWith('*') ? value.startsWith(pattern.slice(0, -1)) : value === pattern);
const privatePath = (name) => /(?:^|\/)(?:src|dist|internal|\.\.)(?:\/|$)|[\\%]/.test(name);
const packageName = owner => `@hachej/boring-${owner === 'ui' ? 'ui-kit' : owner}`;
const packageOwner = (name, policy) => Object.keys(policy.packages).find(owner => name === packageName(owner) || name.startsWith(packageName(owner) + '/'));
const text = (node) => ts.isStringLiteralLike(node) ? node.text : undefined;

export function checkSource(file, source, policy) {
  const owner = /^packages\/([^/]+)\/src\//.exec(file)?.[1];
  if (!owner || !policy.packages[owner]) return [`BORING-PI-5 ${file}: undeclared package/source location`];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // Bind this one file's lexical symbols; no dependency resolution, I/O or type-validity claim.
  const host = {
    getSourceFile: (name) => name === file || name === `/${file}` ? sf : undefined,
    getDefaultLibFileName: () => 'lib.d.ts', writeFile: () => {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: (name) => name === file || name === `/${file}`,
    readFile: () => undefined, getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const checker = ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker();
  const symbol = (node) => checker.getSymbolAtLocation(node);
  const rules = policy.packages[owner];
  const errors = sf.parseDiagnostics.map((d) => `BORING-PI-4 ${file}: cannot parse source: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  const aliases = new Map();
  const fail = (law, message) => errors.push(`${law} ${file}: ${message}`);
  // Folder rules inside one package (`pathRules`): a subpath such as a browser entry cannot import what its
  // package may import elsewhere, by module name or by a relative path into a sibling folder.
  const local = file.slice(`packages/${owner}/`.length);
  const pathRules = (rules.pathRules ?? []).filter((rule) => local.startsWith(rule.prefix));
  function moduleRule(name, typeOnly) {
    for (const rule of pathRules) {
      if (!name.startsWith('.') && matches(name, rule.forbidden ?? [])) fail('BORING-PI-5', `forbidden import in ${rule.prefix}: ${name}`);
      if (name.startsWith('.')) {
        const target = posix.normalize(posix.join(dirname(file), name)).slice(`packages/${owner}/`.length);
        if ((rule.forbiddenRelative ?? []).some((prefix) => target.startsWith(prefix))) fail('BORING-PI-5', `forbidden relative import in ${rule.prefix}: ${name}`);
      }
    }
    const pi = upstream(name, policy);
    if (pi && (privatePath(name) || !matches(name === pi ? '.' : `.${name.slice(pi.length)}`, policy.upstreamExports[pi]))) {
      fail('BORING-PI-4', `not a public upstream export: ${name}`);
    }
    const target = packageOwner(name, policy);
    if (target || name.startsWith('@hachej/boring-')) {
      if (privatePath(name)) fail('BORING-PI-5', `private package import: ${name}`);
      if (!policy.packages[target] || (target !== owner && !rules.dependsOn.includes(target) && !(typeOnly && rules.typeOnlyDependsOn.includes(target)))) {
        fail('BORING-PI-5', `forbidden ${typeOnly ? 'type' : 'runtime'} edge: ${owner} -> ${target}`);
      }
      const allowed = rules.runtimePackageImports?.[target];
      if (!typeOnly && allowed && !allowed.includes(name)) fail('BORING-PI-5', `forbidden runtime package entry: ${name}`);
      return;
    }
    if (name.startsWith('.')) {
      const path = posix.normalize(posix.join(dirname(file), name));
      if (!path.startsWith(`packages/${owner}/src/`)) fail('BORING-PI-5', `relative import leaves package source: ${name}`);
      return;
    }
    if (!matches(name, rules.external) && !(typeOnly && matches(name, rules.typeOnlyExternal))) {
      fail('BORING-PI-5', `undeclared ${typeOnly ? 'type' : 'runtime'} dependency: ${name}`);
    }
  }
  function imported(node) {
    if (ts.isImportDeclaration(node)) {
      const name = text(node.moduleSpecifier);
      if (name === undefined) { fail('BORING-PI-4', 'nonliteral import'); return; }
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const only = clause?.isTypeOnly || (named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly) && !clause.name);
      moduleRule(name, Boolean(only));
      if (upstream(name, policy) && clause) {
        if (clause.name) aliases.set(symbol(clause.name), [name]);
        if (named && ts.isNamespaceImport(named)) aliases.set(symbol(named.name), [name]);
        if (named && ts.isNamedImports(named)) for (const e of named.elements) aliases.set(symbol(e.name), [name, (e.propertyName ?? e.name).text]);
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const name = node.moduleReference.expression && text(node.moduleReference.expression);
      if (name === undefined) fail('BORING-PI-4', 'nonliteral import-equals');
      else { moduleRule(name, node.isTypeOnly); if (upstream(name, policy)) aliases.set(symbol(node.name), [name]); }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const name = text(node.moduleSpecifier);
      const only = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly));
      if (name === undefined) fail('BORING-PI-4', 'nonliteral re-export'); else moduleRule(name, Boolean(only));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const name = text(node.argument.literal);
      if (name !== undefined) moduleRule(name, true);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const name = node.arguments[0] && text(node.arguments[0]);
      if (name === undefined) fail('BORING-PI-4', 'computed loading is not an approved public seam');
      else {
        moduleRule(name, false);
        if (upstream(name, policy) && ts.isVariableDeclaration(node.parent)) {
          const binding = node.parent.name;
          if (ts.isIdentifier(binding)) aliases.set(symbol(binding), [name]);
          if (ts.isObjectBindingPattern(binding)) for (const e of binding.elements) if (ts.isIdentifier(e.name)) aliases.set(symbol(e.name), [name, (e.propertyName ?? e.name).getText(sf)]);
        }
      }
    }
    ts.forEachChild(node, imported);
  }
  imported(sf);
  function native(node) {
    if (!node) return undefined;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return native(node.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(sf) === 'require')) {
      const name = node.arguments[0] && text(node.arguments[0]);
      return name && upstream(name, policy) ? [name] : undefined;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'bind') return native(node.expression.expression);
    if (ts.isIdentifier(node)) return aliases.get(symbol(node));
    if (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) {
      const base = native(ts.isQualifiedName(node) ? node.left : node.expression);
      return base && [...base, (ts.isQualifiedName(node) ? node.right : node.name).text];
    }
    if (ts.isElementAccessExpression(node)) { const base = native(node.expression); const key = node.argumentExpression && text(node.argumentExpression); return base && key !== undefined ? [...base, key] : undefined; }
    return undefined;
  }
  const initializers = new Map();
  function collectAliases(node) {
    if (ts.isVariableDeclaration(node)) {
      const binding = native(node.initializer);
      if (ts.isIdentifier(node.name)) {
        if (ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) initializers.set(symbol(node.name), node.initializer);
        if (binding) aliases.set(symbol(node.name), binding);
      }
      if (binding && ts.isObjectBindingPattern(node.name)) for (const e of node.name.elements) {
        const key = e.propertyName ?? e.name;
        if (!e.dotDotDotToken && ts.isIdentifier(e.name) && (ts.isIdentifier(key) || ts.isStringLiteralLike(key))) aliases.set(symbol(e.name), [...binding, key.text]);
        else fail('BORING-PI-4', 'computed/rest upstream binding is not statically auditable');
      }
    }
    if (ts.isImportEqualsDeclaration(node) && !ts.isExternalModuleReference(node.moduleReference)) {
      const binding = native(node.moduleReference); if (binding) aliases.set(symbol(node.name), binding);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const binding = native(node.right); if (binding) aliases.set(symbol(node.left), binding);
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(sf);
  function constant(node, seen = new Set()) {
    if (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) return constant(node.expression, seen);
    if (node && ts.isIdentifier(node)) {
      const key = symbol(node);
      if (initializers.has(key) && !seen.has(key)) { seen.add(key); return constant(initializers.get(key), seen); }
    }
    return node;
  }
  function inspect(node) {
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name && policy.blockedKernelClasses.includes(node.name.text)) {
      fail('BORING-PI-1', `alternative kernel class: ${node.name.text}`);
    }
    for (const clause of (ts.isClassDeclaration(node) || ts.isClassExpression(node)) ? node.heritageClauses ?? [] : []) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.some((t) => native(t.expression))) fail('BORING-PI-4', 'subclassing an upstream runtime is forbidden');
    }
    const call = ts.isCallExpression(node) || ts.isNewExpression(node);
    let binding = call ? native(node.expression) : undefined;
    let args = call ? node.arguments ?? [] : [];
    if (binding?.at(-1) === 'call') { binding = binding.slice(0, -1); args = args.slice(1); }
    else if (binding?.at(-1) === 'apply') {
      binding = binding.slice(0, -1); const array = constant(args[1]);
      args = array && ts.isArrayLiteralExpression(array) ? array.elements : [];
    }
    if (binding && binding[0] === '@earendil-works/pi-durable' && ((ts.isNewExpression(node) && binding.at(-1) === 'Harness') || (binding.at(-1) === 'open' && binding.at(-2) === 'Harness'))) {
      if (file !== policy.harnessFactory) fail('BORING-PI-2', 'Harness construction belongs only in the owned convenience factory');
    }
    if (binding && ['defineTask', 'defineDoc'].includes(binding.at(-1))) {
      const object = constant(args[0]);
      if (object && ts.isObjectLiteralExpression(object)) for (const p of object.properties) {
        if (ts.isPropertyAssignment(p) && ['name', 'kind'].includes(p.name.getText(sf).replaceAll(/['"]/g, '')) && text(constant(p.initializer))?.startsWith(policy.reservedKinds)) {
          fail('BORING-PI-3', 'extension declaration occupies the reserved pi.* namespace');
        }
      }
    }
    if (ts.isBinaryExpression(node) && ts.isAssignmentOperator(node.operatorToken.kind) && !ts.isIdentifier(node.left) && native(node.left)) fail('BORING-PI-4', 'assignment mutates an upstream import/prototype');
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) && native(node.operand)) fail('BORING-PI-4', 'increment/decrement mutates an upstream import/prototype');
    if (ts.isDeleteExpression(node) && native(node.expression)) fail('BORING-PI-4', 'deletion mutates an upstream import/prototype');
    if (ts.isElementAccessExpression(node) && native(node.expression) && !text(node.argumentExpression)) fail('BORING-PI-4', 'computed upstream access is not statically auditable');
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(sf);
      if (['Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Object.setPrototypeOf', 'Reflect.set', 'Reflect.defineProperty'].includes(expression) && native(node.arguments[0])) fail('BORING-PI-4', 'reflective mutation of an upstream import/prototype');
      if (expression === 'eval' || expression === 'Function') fail('BORING-PI-4', 'generated native execution is not a public adapter');
    }
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'Function') fail('BORING-PI-4', 'generated native execution is not a public adapter');
    ts.forEachChild(node, inspect);
  }
  inspect(sf);
  return errors;
}

// Reject accidental empty evidence files; test adequacy still requires review.
export function hasDeclaredTests(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const functions = new Set(); const namespaces = new Set();
  for (const node of sf.statements) if (ts.isImportDeclaration(node) && text(node.moduleSpecifier) === 'node:test') {
    const clause = node.importClause;
    if (clause?.name) functions.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) if (['test', 'it'].includes((e.propertyName ?? e.name).text)) functions.add(e.name.text);
  }
  let found = false;
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      if (ts.isIdentifier(e) && functions.has(e.text)) found = true;
      if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && (functions.has(e.expression.text) || (namespaces.has(e.expression.text) && ['test', 'it'].includes(e.name.text)))) found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf); return found && sf.parseDiagnostics.length === 0;
}

export function checkManifest(manifest, owner, policy) {
  const problems = [];
  const add = (message) => problems.push(`BORING-PI-4 ${owner ?? 'root'} manifest: ${message}`);
  if (!owner) {
    for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) if (policy.rootDevDependencies[name] !== version) add(`undeclared tooling dependency/version: ${name}`);
    if (Object.keys(manifest.dependencies ?? {}).length) add('runtime dependencies belong in their declared packages');
  } else {
    const rules = policy.packages[owner];
    if (!rules) return [`BORING-PI-5 undeclared package: ${owner}`];
    if (manifest.name !== packageName(owner)) add(`package name must be @hachej/boring-${owner === 'ui' ? 'ui-kit' : owner}`);
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) for (const name of Object.keys(manifest[field] ?? {})) {
      const target = packageOwner(name, policy);
      if (target ? !rules.dependsOn.includes(target) && !rules.typeOnlyDependsOn.includes(target) : !matches(name, [...rules.external, ...rules.typeOnlyExternal])) add(`undeclared dependency: ${name}`);
    }
  }
  const reference = (name) => upstream(name, policy) ?? Object.keys(policy.upstreamExports).find((root) => name.endsWith(`/${root}`) || name.includes(`/${root}@`));
  function visit(value, key = '') {
    if (!value || typeof value !== 'object') return;
    for (const [name, entry] of Object.entries(value)) {
      const pi = reference(name) ?? (name === '.' ? reference(key) : undefined);
      if (pi && (key.toLowerCase().includes('patch') || (typeof entry === 'string' && /^(?:file:|link:|patch:|git|https?:|github:|npm:)/.test(entry)))) add(`local/forked/patched upstream: ${pi}`);
      if (pi && typeof entry === 'string' && !key.toLowerCase().includes('patch') && entry !== policy.upstreamExportsVersion) add(`upstream version must match reviewed public exports ${policy.upstreamExportsVersion}: ${pi}`);
      visit(entry, name);
    }
  }
  visit(manifest);
  return problems;
}
