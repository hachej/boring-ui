import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { hasDeclaredTests } from './pi-policy.mjs';

/** Bounded wiring check, not proof of assertion quality or code coverage. The
 * verifier executes these tests separately from whole-system qualification.
 */
export function importsPackage(source, name) {
  const ast = ts.createSourceFile('evidence.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) return false;
  const matches = value => value === `@hachej/boring-${name === 'ui' ? 'ui-kit' : name}` || value.startsWith(`@hachej/boring-${name === 'ui' ? 'ui-kit' : name}/`);
  let found = false;
  function walk(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier) && matches(node.moduleSpecifier.text)) found = true;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && matches(node.arguments[0].text)) found = true;
    ts.forEachChild(node, walk);
  }
  walk(ast);
  return found;
}

/** One existing-style entry point per implemented package, no feature registry
 * or new test framework. Type-only packages do not claim implemented behavior.
 */
export function implementationEvidence(root, names) {
  const errors = [], proofs = [];
  for (const name of [...names].sort()) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) { errors.push(`Invalid implementation package: ${name}`); continue; }
    const file = `test/packages/${name}.test.mjs`;
    let unsafe = false;
    for (const part of ['test', 'test/packages', file]) {
      try { if (lstatSync(resolve(root, part)).isSymbolicLink()) unsafe = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (unsafe) { errors.push(`Implementation evidence symlink is not auditable: ${file}`); continue; }
    if (!existsSync(resolve(root, file))) { errors.push(`Missing package implementation tests: ${file}`); continue; }
    const source = readFileSync(resolve(root, file), 'utf8');
    if (!hasDeclaredTests(file, source)) errors.push(`Package implementation tests declare no node:test tests: ${file}`);
    if (!importsPackage(source, name)) errors.push(`Package implementation tests must import @hachej/boring-${name === 'ui' ? 'ui-kit' : name} public output: ${file}`);
    proofs.push({ package: name, command: ['node', '--test', file] });
  }
  return { errors, proofs };
}
