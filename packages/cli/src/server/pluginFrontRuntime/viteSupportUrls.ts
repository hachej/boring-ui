import ts from "typescript"
import { ErrorCode } from "@hachej/boring-agent/shared"
import { PluginFrontRuntimeError } from "./diagnostics.js"
import type { HostVirtualSingletonModule } from "./hostModules.js"
import { isWithin, realpathIfExists } from "./runtimePaths.js"

/**
 * Vite emits its own absolute support URLs (`/@vite/client`, `/@id/...`,
 * `/@fs/...`, optimizer chunks) into transformed module code. The browser
 * only ever talks to the runtime host's URL space, so every one of those has
 * to be rewritten into a `${basePath}/__vite/...` route — or rejected.
 */

/** Vite-internal absolute paths the host is willing to proxy verbatim. */
export const VITE_PROXYABLE_PATH_RE = /^\/(?:@id|node_modules|packages)\//

export interface ViteSupportRewriteOptions {
  hostNodeModulesRoots: readonly string[]
  allowHostNodeModulesFs?: boolean
}

export function buildViteProxyUrl(basePath: string, targetPath: string): string {
  return `${basePath}/__vite/proxy/${encodeURIComponent(targetPath.slice(1))}`
}

export function buildViteSingletonUrl(basePath: string, source: string): string {
  return `${basePath}/__vite/singleton/${encodeURIComponent(source)}`
}

/** `/@vite/env` is pulled in implicitly by Vite output, so it is always serveable. */
export function isImplicitViteSupportPath(path: string, basePath: string): boolean {
  return path === `${basePath}/__vite/env`
}

export function isHostNodeModuleFsSpecifier(specifier: string, hostNodeModulesRoots: readonly string[]): boolean {
  if (!specifier.startsWith("/@fs/")) return false
  const cleanPath = specifier.slice("/@fs".length).split("?")[0] ?? ""
  const realPath = realpathIfExists(cleanPath)
  return hostNodeModulesRoots.some((root) => isWithin(root, realPath))
}

const WORKSPACE_SINGLETON_BY_PATH_SUFFIX: ReadonlyArray<readonly [string, HostVirtualSingletonModule]> = [
  // Monorepo dev layout.
  ["/packages/workspace/dist/workspace.js", "@hachej/boring-workspace"],
  ["/packages/workspace/src/index.ts", "@hachej/boring-workspace"],
  ["/packages/workspace/dist/plugin.js", "@hachej/boring-workspace/plugin"],
  ["/packages/workspace/src/plugin.ts", "@hachej/boring-workspace/plugin"],
  ["/packages/workspace/dist/events.js", "@hachej/boring-workspace/events"],
  ["/packages/workspace/src/front/events/index.ts", "@hachej/boring-workspace/events"],
  // Installed layout (npm global / pnpm store): the scoped-package suffix
  // matches both node_modules/@hachej/... and .pnpm/.../@hachej/... paths.
  // Without these, a plugin importing the workspace root in an installed
  // CLI gets a proxied SECOND copy of the workspace bundle — its context
  // hooks (useApiBaseUrl, ...) read the wrong React context, and the
  // proxied app-level graph drags un-interop'd CJS deps that fail to load.
  ["/@hachej/boring-workspace/dist/workspace.js", "@hachej/boring-workspace"],
  ["/@hachej/boring-workspace/dist/plugin.js", "@hachej/boring-workspace/plugin"],
  ["/@hachej/boring-workspace/dist/events.js", "@hachej/boring-workspace/events"],
]

// Filename-based mapping applies ONLY to Vite optimizer output
// (.vite/deps/react.js etc.). Matching by bare filename anywhere would
// also capture a dependency's own module that happens to be named
// react.js — e.g. dockview/dist/esm/react.js, whose exports (ReactPart)
// do not exist on the react singleton, killing the whole importing
// plugin module graph with a named-export SyntaxError.
const OPTIMIZED_DEP_SINGLETON_BY_FILE_NAME: Record<string, HostVirtualSingletonModule> = {
  "react.js": "react",
  "react-dom.js": "react-dom",
  "react-dom_client.js": "react-dom/client",
  "react_jsx-runtime.js": "react/jsx-runtime",
  "react_jsx-dev-runtime.js": "react/jsx-dev-runtime",
}

/** Maps a resolved on-disk module path back to the host singleton it duplicates, if any. */
export function optimizedDependencySingletonSource(targetPath: string): HostVirtualSingletonModule | undefined {
  const normalizedPath = targetPath.split("?")[0].replaceAll("\\", "/")
  for (const [suffix, source] of WORKSPACE_SINGLETON_BY_PATH_SUFFIX) {
    if (normalizedPath.endsWith(suffix)) return source
  }
  if (!normalizedPath.includes("/.vite/deps/")) return undefined
  return OPTIMIZED_DEP_SINGLETON_BY_FILE_NAME[normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1)]
}

function rewriteViteSupportSpecifier(specifier: string, basePath: string, options: Required<ViteSupportRewriteOptions>): string | undefined {
  if (specifier === "/@vite/client") return `${basePath}/__vite/client`
  if (specifier === "/@vite/env" || specifier === "@vite/env") return `${basePath}/__vite/env`
  if (specifier.startsWith("/@fs/")) {
    if (specifier.includes("/vite/dist/client/env.mjs")) return `${basePath}/__vite/env`
    const singletonSource = optimizedDependencySingletonSource(specifier)
    if (singletonSource) return buildViteSingletonUrl(basePath, singletonSource)
    if (options.allowHostNodeModulesFs && isHostNodeModuleFsSpecifier(specifier, options.hostNodeModulesRoots)) return buildViteProxyUrl(basePath, specifier)
    return undefined
  }
  if (!VITE_PROXYABLE_PATH_RE.test(specifier)) return undefined
  const singletonSource = optimizedDependencySingletonSource(specifier)
  return singletonSource
    ? buildViteSingletonUrl(basePath, singletonSource)
    : buildViteProxyUrl(basePath, specifier)
}

/**
 * Rewrites every import/export/dynamic-import specifier in transformed output
 * into the host URL space, reporting the support paths it minted so the
 * support routes only serve what a validated module actually asked for.
 */
export function rewriteViteSupportUrls(code: string, basePath: string, options: ViteSupportRewriteOptions): { code: string; mintedPaths: string[] } {
  const resolvedOptions: Required<ViteSupportRewriteOptions> = {
    hostNodeModulesRoots: options.hostNodeModulesRoots,
    allowHostNodeModulesFs: options.allowHostNodeModulesFs ?? false,
  }
  const sourceFile = ts.createSourceFile("runtime-plugin-output.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const replacements: Array<{ start: number; end: number; value: string }> = []
  const mintedPaths: string[] = []
  const queueReplacement = (literal: ts.StringLiteralLike) => {
    const rewritten = rewriteViteSupportSpecifier(literal.text, basePath, resolvedOptions)
    if (!rewritten) return
    replacements.push({
      start: literal.getStart(sourceFile) + 1,
      end: literal.getEnd() - 1,
      value: rewritten,
    })
    mintedPaths.push(rewritten)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      queueReplacement(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      queueReplacement(node.moduleSpecifier)
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      queueReplacement(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (replacements.length === 0) return { code, mintedPaths: [] }
  let rewritten = code
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`
  }
  return { code: rewritten, mintedPaths }
}

/** Any `/@fs/` reference left after rewriting would leak a host filesystem path to the browser. */
export function assertNoUnsafeFsSupportReference(code: string, context: Record<string, unknown>): void {
  if (!code.includes("/@fs/")) return
  const unsafeReferences = [...code.matchAll(/["']([^"']*\/@fs\/[^"']*)["']/g)]
    .map((match) => match[1])
    .slice(0, 5)
  throw new PluginFrontRuntimeError(
    ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
    400,
    "transform",
    "plugin runtime transform produced an unsafe Vite /@fs reference",
    { ...context, unsafeReferences },
  )
}
