import { builtinModules } from "node:module"
import { extname } from "node:path"
import ts from "typescript"
import { ErrorCode } from "@hachej/boring-agent/shared"
import { PluginFrontRuntimeError } from "./diagnostics.js"
import { isUnknownHostProvidedSubpath } from "./hostModules.js"
import { isBareImport, isUnsafeAbsoluteImport } from "./runtimePaths.js"

export const NODE_BUILTIN_MODULES = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

export function isNodeBuiltinSpecifier(source: string): boolean {
  return source.startsWith("node:") || NODE_BUILTIN_MODULES.has(source)
}

function scriptKindForPath(path: string): ts.ScriptKind {
  const extension = extname(path).toLowerCase()
  if (extension === ".tsx") return ts.ScriptKind.TSX
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return ts.ScriptKind.TS
  if (extension === ".jsx") return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

function stripBlockComments(sourceText: string): string {
  return sourceText.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
}

function isImportMetaGlobCall(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression)) return false
  if (expression.name.text !== "glob" && expression.name.text !== "globEager") return false
  return ts.isMetaProperty(expression.expression)
    && expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && expression.expression.name.text === "meta"
}

const CSS_IMPORT_PATTERN = /^\s*@import\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)"']+))\s*\)|["']([^"']+)["'])/gm
const CSS_URL_PATTERN = /\burl\(\s*(?:["']([^"']+)["']|([^\s)"']+))\s*\)/gm

/**
 * Rejects any import in plugin source (or in generated CJS interop) that would
 * escape the host runtime URL space: node builtins, absolute/protocol
 * specifiers, unknown subpaths of host-provided packages, and the dynamic
 * forms (`import.meta.glob`, computed `import()`) whose targets cannot be
 * validated ahead of time.
 */
export function validateSourceImports(sourceText: string, importer: string, basePath: string): void {
  const reject = (source: string) => {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
      400,
      "resolve",
      "plugin runtime import bypasses the host runtime URL space",
      { importer, source },
    )
  }
  const isUnsafeSpecifier = (specifier: string) => (
    isNodeBuiltinSpecifier(specifier)
    || isUnsafeAbsoluteImport(specifier, basePath)
    || (isBareImport(specifier) && isUnknownHostProvidedSubpath(specifier))
  )

  if (extname(importer).toLowerCase() === ".css") {
    const sanitizedCss = stripBlockComments(sourceText)
    for (const pattern of [CSS_IMPORT_PATTERN, CSS_URL_PATTERN]) {
      pattern.lastIndex = 0
      let cssMatch: RegExpExecArray | null
      while ((cssMatch = pattern.exec(sanitizedCss)) !== null) {
        const specifier = cssMatch[1] ?? cssMatch[2] ?? cssMatch[3] ?? ""
        if (isUnsafeSpecifier(specifier)) reject(specifier)
      }
    }
    return
  }

  const sourceFile = ts.createSourceFile(importer, sourceText, ts.ScriptTarget.Latest, true, scriptKindForPath(importer))

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (isUnsafeSpecifier(node.moduleSpecifier.text)) reject(node.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (isUnsafeSpecifier(node.moduleSpecifier.text)) reject(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && isImportMetaGlobCall(node.expression)) {
      reject("import.meta.glob")
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
    ) {
      const argument = node.arguments[0]
      if (ts.isStringLiteral(argument)) {
        if (isUnsafeSpecifier(argument.text)) reject(argument.text)
      } else {
        reject("computed-import")
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}
