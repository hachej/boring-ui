// Import-only migration: retain every imported/local symbol, comment and JSX node.
// Run after extending registry/_shared/icons.ts; --check refuses remaining direct Lucide imports.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const adapter = 'registry/_shared/icons.ts';
const parse = (path, source) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
const symbols = new Set();
for (const node of parse(adapter, readFileSync(resolve(root, adapter), 'utf8')).statements) {
  if (ts.isExportDeclaration(node)) for (const symbol of node.exportClause?.elements ?? []) symbols.add(symbol.name.text);
  if (ts.isVariableStatement(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) for (const declaration of node.declarationList.declarations) symbols.add(declaration.name.text);
}
let count = 0;
function visit(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) { visit(path); continue; }
    if (!/\.tsx?$/.test(path) || path === adapter) continue;
    const source = readFileSync(resolve(root, path), 'utf8');
    const changes = [];
    for (const node of parse(path, source).statements) {
      if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== 'lucide-react') continue;
      if (!ts.isNamedImports(node.importClause?.namedBindings)) throw new Error(`Expected named icon imports: ${path}`);
      for (const symbol of node.importClause.namedBindings.elements) if (!symbols.has((symbol.propertyName ?? symbol.name).text)) throw new Error(`Extend ${adapter} for ${symbol.getText()}`);
      let specifier = relative(dirname(path), adapter).replace(/\\/g, '/').replace(/\.ts$/, '');
      if (!specifier.startsWith('.')) specifier = './' + specifier;
      changes.push({ start: node.moduleSpecifier.getStart() + 1, end: node.moduleSpecifier.end - 1, specifier });
    }
    if (!changes.length) continue;
    count += changes.length;
    if (process.argv.includes('--check')) throw new Error(`Unmigrated icon imports: ${path}`);
    let next = source;
    for (const change of changes.reverse()) next = next.slice(0, change.start) + change.specifier + next.slice(change.end);
    writeFileSync(resolve(root, path), next);
  }
}
visit('registry');
visit('shadcn/ui');
console.log(`${count} icon imports migrated; shared symbols and JSX preserved`);
