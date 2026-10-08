import ts from 'typescript';

/** Conservative erased-type classification, NOT a runtime-proof bypass.
 * Inline `import { type T }` may retain a module evaluation under verbatim emit;
 * only whole-statement `import type` / `export type` qualify here.
 */
export function isContractOnly(file, source) {
  if (!/\.ts$/.test(file)) return false;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) return false;
  return ast.statements.every((node) => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEmptyStatement(node)) return true;
    if (ts.isImportDeclaration(node)) return node.importClause?.isTypeOnly === true;
    if (ts.isExportDeclaration(node)) return node.isTypeOnly || (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length === 0);
    return false;
  });
}
