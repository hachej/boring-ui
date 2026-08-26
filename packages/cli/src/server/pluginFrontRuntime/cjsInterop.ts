import ts from "typescript"
import { init as initCjsLexer, parse as parseCjsExports } from "cjs-module-lexer"

// Plugin-local dependencies are served straight from disk through the proxy
// pipeline, but Vite's CommonJS→ESM interop only runs inside its dep optimizer,
// which is disabled here (optimizeDeps.noDiscovery). Without it, a CJS dep
// (e.g. es-toolkit/compat, lodash) is shipped to the browser as raw
// `module.exports = ...` / `exports.foo = ...` referencing globals that do not
// exist in an ES module, so the whole importing plugin graph dies with
// "exports is not defined". Host singletons (react, ...) sidestep this because
// runtimeSingletonModuleCode hand-writes their ESM interop; this gives every
// other CJS dep the same treatment.

const CJS_REQUIRE_PLACEHOLDER = "__boringCjsRequire"

let cjsLexerReady: Promise<void> | undefined
function ensureCjsLexer(): Promise<void> {
  if (!cjsLexerReady) cjsLexerReady = initCjsLexer()
  return cjsLexerReady
}

function hasEsmSyntax(sourceText: string): boolean {
  const sourceFile = ts.createSourceFile("cjs-probe.js", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let esm = false
  const visit = (node: ts.Node): void => {
    if (esm) return
    if (
      ts.isImportDeclaration(node)
      || ts.isExportDeclaration(node)
      || ts.isExportAssignment(node)
      || (ts.isFunctionDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      || ((ts.isVariableStatement(node) || ts.isClassDeclaration(node)) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    ) {
      esm = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return esm
}

export function looksLikeCommonJs(sourceText: string): boolean {
  if (hasEsmSyntax(sourceText)) return false
  return /\b(?:module\.exports|exports\.|exports\[)/.test(sourceText)
    || /\brequire\s*\(/.test(sourceText)
}

function collectRequireSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "require"
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...specifiers]
}

// Rewrites a CommonJS dependency module into an ES module that the browser can
// evaluate. Each `require("X")` is hoisted to a static `import * as ns from "X"`
// (so Vite's resolveId/import-analysis rewrites it into a proxy URL just like a
// normal import) and replaced with a synchronous accessor over the already
// imported namespace. The original body runs against a synthetic
// `module`/`exports`, then `module.exports` is re-exported as the default plus
// the named exports detected by cjs-module-lexer.
export async function cjsDependencyToEsm(sourceText: string, modulePath: string): Promise<string> {
  await ensureCjsLexer()
  const sourceFile = ts.createSourceFile(modulePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const requireSpecifiers = collectRequireSpecifiers(sourceFile)
  const importLines: string[] = []
  const requireMapEntries: string[] = []
  requireSpecifiers.forEach((specifier, index) => {
    const binding = `${CJS_REQUIRE_PLACEHOLDER}_${index}`
    importLines.push(`import * as ${binding} from ${JSON.stringify(specifier)};`)
    requireMapEntries.push(`  [${JSON.stringify(specifier)}]: ${binding},`)
  })

  let exportNames: string[] = []
  try {
    const parsed = parseCjsExports(sourceText, modulePath)
    exportNames = [...parsed.exports]
  } catch {
    // Lexer failed (unusual CJS shape); default export still works.
    exportNames = []
  }
  const safeExportNames = exportNames.filter(
    (name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && name !== "default" && name !== "__esModule",
  )
  const namedExportLines = safeExportNames.map(
    (name) => `export const ${name} = ${JSON.stringify(name)} in __boringCjsExports ? __boringCjsExports[${JSON.stringify(name)}] : undefined;`,
  )

  return [
    ...importLines,
    `const ${CJS_REQUIRE_PLACEHOLDER}_modules = {`,
    ...requireMapEntries,
    "};",
    `function ${CJS_REQUIRE_PLACEHOLDER}(id) {`,
    `  const ns = ${CJS_REQUIRE_PLACEHOLDER}_modules[id];`,
    `  if (!ns) throw new Error("runtime plugin CommonJS require could not be resolved: " + id);`,
    "  const def = ns.default;",
    "  if (def !== undefined && (ns.__esModule || typeof def !== 'object' || Object.keys(ns).length === 1)) return def;",
    "  return ns.default !== undefined ? ns.default : ns;",
    "}",
    "const __boringCjsModule = { exports: {} };",
    `(function (module, exports, require) {`,
    sourceText,
    `})(__boringCjsModule, __boringCjsModule.exports, ${CJS_REQUIRE_PLACEHOLDER});`,
    "const __boringCjsExports = __boringCjsModule.exports;",
    "export default __boringCjsExports;",
    ...namedExportLines,
  ].join("\n")
}
