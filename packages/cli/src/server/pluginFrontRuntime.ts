import type { FastifyInstance } from "fastify"
import { builtinModules, createRequire } from "node:module"
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import { dirname, extname, isAbsolute, posix, relative, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { ErrorCode } from "@hachej/boring-agent/shared"
import type { BoringServerPluginManifest } from "@hachej/boring-workspace/server"
import ts from "typescript"
import { createServer } from "vite"

export const PLUGIN_FRONT_RUNTIME_BASE_PATH = "/api/v1/agent-plugins/runtime"
const HOST_VIRTUAL_SINGLETON_MODULES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@hachej/boring-workspace",
  "@hachej/boring-workspace/plugin",
  "@hachej/boring-workspace/events",
] as const

export const HOST_SINGLETON_MODULES = HOST_VIRTUAL_SINGLETON_MODULES

const HOST_PROVIDED_MODULES = [
  ...HOST_SINGLETON_MODULES,
  // Host-provided design-system package. It is resolved via the host Vite
  // alias/dedupe path instead of plugin-local node_modules, but it is not a
  // virtual global singleton because it has many component exports and no
  // React identity/state boundary like React/workspace do.
  "@hachej/boring-ui-kit",
] as const

type HostVirtualSingletonModule = typeof HOST_SINGLETON_MODULES[number]
type HostProvidedModule = typeof HOST_PROVIDED_MODULES[number]

function isHostVirtualSingletonModule(source: string): source is HostVirtualSingletonModule {
  return HOST_VIRTUAL_SINGLETON_MODULES.includes(source as HostVirtualSingletonModule)
}

function isHostProvidedModule(source: string): source is HostProvidedModule {
  return HOST_PROVIDED_MODULES.includes(source as HostProvidedModule)
}

const DEFAULT_MAX_TRANSFORM_CONCURRENCY = 8
const RUNTIME_PREFIX = "[plugin-front-runtime]"
const NODE_BUILTIN_MODULES = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const PRIVATE_FILE_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".npmrc",
  ".pnpmrc",
  ".yarnrc",
  ".yarnrc.yml",
])
const IMPORT_RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".svg"]
const RUNTIME_ASSET_EXTENSIONS = new Set([".avif", ".gif", ".ico", ".jpg", ".jpeg", ".png", ".svg", ".webp", ".woff", ".woff2"])
const DIRECTORY_INDEX_CANDIDATES = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.cjs",
  "index.css",
]
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/
const RUNTIME_SINGLETON_ID_PREFIX = "\0boring-runtime-singleton:"
const PLUGIN_DEPENDENCY_ID_PREFIX = "\0boring-plugin-dependency:"
const RUNTIME_SINGLETON_GLOBAL = "__BORING_RUNTIME_SINGLETONS__"
const WORKSPACE_ROOT_SINGLETON_EXPORTS = [
  "bootstrap",
  "PluginError",
  "CatalogRegistry",
  "useCommands",
  "useActivePanels",
  "useCatalogs",
  "PluginErrorBoundary",
  "PluginErrorProvider",
  "usePluginErrors",
  "filesystemPlugin",
  "emitFilesystemAgentFileChange",
  "useAutoOpenAgentFiles",
  "onFilesystemChanged",
  "useFilePane",
  "WorkspaceFilesProvider",
  "useApiBaseUrl",
  "useHasWorkspaceFilesProvider",
  "useWorkspaceRequestId",
  "readFileRecords",
  "filesystemEvents",
  "cn",
  "PanelRegistry",
  "CommandRegistry",
  "SurfaceResolverRegistry",
  "RegistryProvider",
  "useRegistry",
  "useCommandRegistry",
  "useCatalogRegistry",
  "useSurfaceResolverRegistry",
  "WORKSPACE_OPEN_PATH_SURFACE_KIND",
  "getFileIcon",
  "DockviewShell",
  "PanelChrome",
  "useDockviewApi",
  "IdeLayout",
  "buildIdeLayout",
  "ChatLayout",
  "buildChatLayout",
  "TopBar",
  "ResponsiveDockviewShell",
  "useEditorLifecycle",
  "buildFullPagePanelHref",
  "useFullPagePanelHref",
  "usePanelRenderMode",
  "useIsFullPagePanel",
  "useViewportBreakpoint",
  "useResponsiveSidebarCollapse",
  "useArtifactPanels",
  "useArtifactRouting",
  "useKeyboardShortcuts",
  "formatShortcut",
  "CommandPalette",
  "WorkspaceLoadingState",
  "ArtifactSurfacePane",
  "EmptyPane",
  "CodeEditorPane",
  "FileTreePane",
  "FileTreeView",
  "MarkdownEditorPane",
  "definePanel",
  "createShadcnTheme",
  "events",
  "useEvent",
  "userMeta",
  "agentMeta",
  "emitAgentData",
  "toast",
  "Toaster",
  "dismissToast",
  "createBridge",
  "createBridgeClient",
  "postUiCommand",
  "UI_COMMAND_EVENT",
  "WorkspaceLink",
  "workspaceLinkCommand",
  "workspaceLinkHref",
  "openFileSchema",
  "openPanelSchema",
  "closePanelSchema",
  "notificationSchema",
  "navigateToLineSchema",
  "expandToFileSchema",
  "MAX_PANELS",
  "PanelErrorBoundary",
  "CodeEditor",
  "FileTree",
  "MarkdownEditor",
  "SessionList",
  "SessionBrowser",
  "SurfaceShell",
  "WorkbenchLeftPane",
  "WorkspaceProvider",
  "ThemeProvider",
  "useTheme",
  "useWorkspaceBridge",
  "useWorkspaceContext",
  "useWorkspaceContextOptional",
  "useWorkspaceChatPanel",
  "useWorkspaceAttention",
  "createWorkspaceStore",
  "bindStore",
  "useActiveFile",
  "useActivePanel",
  "useSidebarState",
  "useSetSidebar",
  "useOpenPanels",
  "useDirtyFiles",
  "useThemePreference",
  "useHydrationComplete",
  "useResetLayout",
] as const
const WORKSPACE_PLUGIN_SINGLETON_EXPORTS = [
  "captureFrontPlugin",
  "createCapturingBoringFrontAPI",
  "definePlugin",
  "validateBoringPluginManifest",
  "isSafePluginRelativePath",
  "isValidBoringPluginId",
  "WORKSPACE_OPEN_PATH_SURFACE_KIND",
] as const
const WORKSPACE_EVENTS_SINGLETON_EXPORTS = [
  "events",
  "userMeta",
  "agentMeta",
  "remoteMeta",
  "workspaceEvents",
  "WORKSPACE_PLUGIN_ID",
  "WORKSPACE_UI_COMMAND_EVENT",
  "WORKSPACE_EDITOR_SAVE_START_EVENT",
  "WORKSPACE_EDITOR_SAVE_END_EVENT",
  "WORKSPACE_PANEL_UPDATE_EVENT",
  "WORKSPACE_PANEL_CLOSE_EVENT",
  "WORKSPACE_AGENT_DATA_EVENT",
  "useEvent",
  "emitAgentData",
] as const
const RUNTIME_SINGLETON_EXPORTS: Partial<Record<HostVirtualSingletonModule, readonly string[]>> = {
  react: [
    "Activity",
    "Children",
    "Component",
    "Fragment",
    "Profiler",
    "PureComponent",
    "StrictMode",
    "Suspense",
    "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
    "__COMPILER_RUNTIME",
    "act",
    "cache",
    "cacheSignal",
    "captureOwnerStack",
    "cloneElement",
    "createContext",
    "createElement",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "unstable_useCacheRefresh",
    "use",
    "useActionState",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useEffectEvent",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useOptimistic",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "version",
  ],
  "react-dom": [
    "__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
    "createPortal",
    "flushSync",
    "preconnect",
    "prefetchDNS",
    "preinit",
    "preinitModule",
    "preload",
    "preloadModule",
    "requestFormReset",
    "unstable_batchedUpdates",
    "useFormState",
    "useFormStatus",
    "version",
  ],
  "react-dom/client": ["createRoot", "hydrateRoot", "version"],
  "react/jsx-runtime": ["Fragment", "jsx", "jsxs"],
  "react/jsx-dev-runtime": ["Fragment", "jsxDEV"],
  "@hachej/boring-workspace": WORKSPACE_ROOT_SINGLETON_EXPORTS,
  "@hachej/boring-workspace/plugin": WORKSPACE_PLUGIN_SINGLETON_EXPORTS,
  "@hachej/boring-workspace/events": WORKSPACE_EVENTS_SINGLETON_EXPORTS,
}

export interface PluginFrontRuntimeDiagnostic {
  level: "info" | "warn" | "error"
  prefix: typeof RUNTIME_PREFIX
  msg: string
  workspaceId?: string
  pluginId?: string
  revision?: number
  requestedPath?: string
  resolvedPath?: string
  stage:
    | "track"
    | "validate"
    | "resolve"
    | "cache"
    | "transform"
    | "serve"
    | "cleanup"
  outcome:
    | "tracked"
    | "cache-hit"
    | "cache-miss"
    | "served"
    | "rejected"
    | "disposed"
    | "closed"
  durationMs?: number
  code?: ErrorCode
  details?: Record<string, unknown>
}

type PluginFrontTargetResolver = (
  plugin: BoringServerPluginManifest,
  context: { revision: number; frontEntrySubpath: string },
) => {
  kind: "native"
  entryUrl: string
  revision: number
  trust: "local-trusted-native"
} | undefined

export interface CreatePluginFrontRuntimeHostOptions {
  basePath?: string
  maxTransformConcurrency?: number
  onDiagnostic?: (diagnostic: PluginFrontRuntimeDiagnostic) => void
}

export interface PluginFrontRuntimeResponse {
  body: string | Uint8Array
  contentType: string
  cacheKey: string
}

export interface PluginFrontRuntimeServeRequest {
  workspaceId: string
  pluginId: string
  revision: string | number
  subpath: string
  search?: string
}

interface TrackedPluginRecord {
  workspaceId: string
  pluginId: string
  revision: number
  rootDir: string
  frontEntrySubpath: string
  frontRootDir: string
  sharedRootDir: string
  sourceSnapshot: Map<string, Uint8Array>
}

interface ValidatedRuntimeRequest {
  workspaceId: string
  pluginId: string
  revision: number
  requestedPath: string
  resolvedPath: string
  runtimeId: string
  cacheKey: string
  tracked: TrackedPluginRecord
}

interface TransformCacheEntry {
  runtimeId: string
  promise: Promise<PluginFrontRuntimeResponse>
}

class PluginFrontRuntimeError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    readonly stage: PluginFrontRuntimeDiagnostic["stage"],
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function diagnostic(
  entry: Omit<PluginFrontRuntimeDiagnostic, "prefix">,
): PluginFrontRuntimeDiagnostic {
  return { prefix: RUNTIME_PREFIX, ...entry }
}

function ensureSafeId(kind: "workspace" | "plugin", value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_NOT_FOUND,
      404,
      "validate",
      `${kind} id is required`,
      { [kind === "workspace" ? "workspaceId" : "pluginId"]: value },
    )
  }
  if (trimmed.includes("\0")) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_NULL_BYTE,
      400,
      "validate",
      `${kind} id contains a null byte`,
      { [kind === "workspace" ? "workspaceId" : "pluginId"]: value },
    )
  }
  if (!SAFE_SEGMENT_RE.test(trimmed)) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_ESCAPE,
      403,
      "validate",
      `invalid ${kind} id`,
      { [kind === "workspace" ? "workspaceId" : "pluginId"]: value },
    )
  }
  return trimmed
}

function normalizeRequestSubpath(raw: string): string {
  const value = raw.trim().replaceAll("\\", "/")
  if (!value) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime path is required")
  }
  if (value.includes("\0")) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NULL_BYTE, 400, "validate", "plugin runtime path contains a null byte", { path: raw })
  }
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value) || isAbsolute(value)) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_ABSOLUTE, 400, "validate", "plugin runtime path must be relative", { path: raw })
  }
  const segments = value.split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_ESCAPE, 403, "validate", "plugin runtime path contains dot segments", { path: raw })
  }
  for (const segment of segments) {
    const lower = segment.toLowerCase()
    if (segment.startsWith(".") || lower === "node_modules" || lower === ".ds_store" || PRIVATE_FILE_NAMES.has(lower) || lower.startsWith(".env")) {
      throw new PluginFrontRuntimeError(
        ErrorCode.enum.PLUGIN_RUNTIME_PRIVATE_FILE,
        403,
        "validate",
        "plugin runtime path targets a disallowed private file",
        { path: raw },
      )
    }
  }
  return value
}

function assertRuntimeFrontEntrySubpath(frontEntrySubpath: string): void {
  // Accept any subpath that targets a `front/` segment inside the
  // package. Source-style plugins expose `front/index.tsx`; published
  // build-output plugins expose `dist/front/index.js`. Both layouts are
  // valid — reject only paths that don't include a `front/` directory
  // anywhere, which catches manifest typos and accidental relative-path
  // escapes.
  if (/(^|\/)front\//.test(frontEntrySubpath)) return
  throw new PluginFrontRuntimeError(
    ErrorCode.enum.PLUGIN_RUNTIME_PRIVATE_FILE,
    403,
    "validate",
    "native runtime plugin fronts must live under a front/ directory",
    { frontEntrySubpath },
  )
}

function normalizeSearch(search: string | undefined): string {
  if (!search) return ""
  const raw = search.startsWith("?") ? search.slice(1) : search
  if (!raw) return ""
  const params = new URLSearchParams(raw)
  params.delete("v")
  params.delete("t")
  const stable = [...params.entries()].sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) return aValue.localeCompare(bValue)
    return aKey.localeCompare(bKey)
  })
  if (stable.length === 0) return ""
  const normalized = new URLSearchParams()
  for (const [key, value] of stable) normalized.append(key, value)
  const text = normalized.toString()
  return text ? `?${text}` : ""
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim()
  if (!trimmed.startsWith("/")) throw new Error(`plugin front runtime basePath must start with '/': ${basePath}`)
  return trimmed.replace(/\/+$/, "") || "/"
}

function encodeRuntimeSubpath(subpath: string): string {
  return subpath.split("/").map((segment) => encodeURIComponent(segment)).join("/")
}

function buildRuntimeUrl(basePath: string, workspaceId: string, pluginId: string, revision: number, subpath: string): string {
  return `${basePath}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(pluginId)}/${revision}/${encodeRuntimeSubpath(subpath)}`
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function buildViteProxyUrl(basePath: string, targetPath: string): string {
  return `${basePath}/__vite/proxy/${encodeURIComponent(targetPath.slice(1))}`
}

function buildViteSingletonUrl(basePath: string, source: string): string {
  return `${basePath}/__vite/singleton/${encodeURIComponent(source)}`
}

function optimizedDependencySingletonSource(targetPath: string): HostVirtualSingletonModule | undefined {
  const cleanPath = targetPath.split("?")[0]
  const normalizedPath = cleanPath.replaceAll("\\", "/")
  const workspaceSingletonByPath: Array<[string, HostVirtualSingletonModule]> = [
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
  for (const [suffix, source] of workspaceSingletonByPath) {
    if (normalizedPath.endsWith(suffix)) return source
  }
  // Filename-based mapping applies ONLY to Vite optimizer output
  // (.vite/deps/react.js etc.). Matching by bare filename anywhere would
  // also capture a dependency's own module that happens to be named
  // react.js — e.g. dockview/dist/esm/react.js, whose exports (ReactPart)
  // do not exist on the react singleton, killing the whole importing
  // plugin module graph with a named-export SyntaxError.
  if (!normalizedPath.includes("/.vite/deps/")) return undefined
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1)
  const sourceByFileName: Record<string, HostVirtualSingletonModule> = {
    "react.js": "react",
    "react-dom.js": "react-dom",
    "react-dom_client.js": "react-dom/client",
    "react_jsx-runtime.js": "react/jsx-runtime",
    "react_jsx-dev-runtime.js": "react/jsx-dev-runtime",
  }
  return sourceByFileName[fileName]
}

function rewriteViteSupportSpecifier(specifier: string, basePath: string): string | undefined {
  if (specifier === "/@vite/client") return `${basePath}/__vite/client`
  if (specifier === "/@vite/env" || specifier === "@vite/env") return `${basePath}/__vite/env`
  if (specifier.startsWith("/@fs/") && specifier.includes("/vite/dist/client/env.mjs")) return `${basePath}/__vite/env`
  if (!/^\/(?:@id|node_modules|packages)\//.test(specifier)) return undefined
  const singletonSource = optimizedDependencySingletonSource(specifier)
  return singletonSource
    ? buildViteSingletonUrl(basePath, singletonSource)
    : buildViteProxyUrl(basePath, specifier)
}

function assertNoUnsafeFsSupportReference(code: string, context: Record<string, unknown>): void {
  if (!code.includes("/@fs/")) return
  throw new PluginFrontRuntimeError(
    ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
    400,
    "transform",
    "plugin runtime transform produced an unsafe Vite /@fs reference",
    context,
  )
}

function rewriteViteSupportUrls(code: string, basePath: string): { code: string; mintedPaths: string[] } {
  const sourceFile = ts.createSourceFile("runtime-plugin-output.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const replacements: Array<{ start: number; end: number; value: string }> = []
  const mintedPaths: string[] = []
  const queueReplacement = (literal: ts.StringLiteralLike) => {
    const rewritten = rewriteViteSupportSpecifier(literal.text, basePath)
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

function isImplicitViteSupportPath(path: string, basePath: string): boolean {
  return path === `${basePath}/__vite/env`
}

async function resolveRealLike(path: string): Promise<string> {
  const suffix: string[] = []
  let current = path
  while (true) {
    try {
      const real = await realpath(current)
      return resolvePath(real, ...suffix.reverse())
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code && code !== "ENOENT") throw error
      const parent = dirname(current)
      if (parent === current) return path
      suffix.push(current.slice(parent.length + 1))
      current = parent
    }
  }
}

async function canonicalAllowedRoots(record: TrackedPluginRecord): Promise<string[]> {
  const pluginRootReal = await resolveRealLike(record.rootDir)
  const roots = [record.frontRootDir, record.sharedRootDir]
  const resolved: string[] = []
  for (const root of roots) {
    const realRoot = await resolveRealLike(root)
    if (!isWithin(pluginRootReal, realRoot)) {
      throw new PluginFrontRuntimeError(
        ErrorCode.enum.PATH_SYMLINK_ESCAPE,
        403,
        "validate",
        "plugin runtime allowed root resolves outside the plugin root",
        { root, resolvedPath: realRoot, pluginRoot: record.rootDir },
      )
    }
    if (!resolved.includes(realRoot)) resolved.push(realRoot)
  }
  return resolved
}

async function resolveFileWithinPlugin(record: TrackedPluginRecord, subpath: string): Promise<string> {
  const resolvedPath = resolvePath(record.rootDir, subpath)
  if (!isWithin(record.rootDir, resolvedPath)) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_ESCAPE, 403, "validate", "plugin runtime path escapes plugin root", {
      path: subpath,
      rootDir: record.rootDir,
    })
  }
  if (!isWithin(record.frontRootDir, resolvedPath) && !isWithin(record.sharedRootDir, resolvedPath)) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PLUGIN_RUNTIME_PRIVATE_FILE,
      403,
      "validate",
      "plugin runtime path is outside the allowed front/shared subtree",
      {
        path: subpath,
        frontRootDir: record.frontRootDir,
        sharedRootDir: record.sharedRootDir,
      },
    )
  }

  const realLike = await resolveRealLike(resolvedPath)
  const allowedRealRoots = await canonicalAllowedRoots(record)
  if (!allowedRealRoots.some((root) => isWithin(root, realLike))) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      403,
      "validate",
      "plugin runtime path resolves outside the allowed subtree",
      { path: subpath, resolvedPath: realLike },
    )
  }

  try {
    const stats = await stat(resolvedPath)
    if (!stats.isFile()) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime path is not a file", {
        path: subpath,
        resolvedPath,
      })
    }
  } catch (error) {
    if (error instanceof PluginFrontRuntimeError) throw error
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime file not found", {
      path: subpath,
      resolvedPath,
    })
  }

  return resolvedPath
}

function snapshotRuntimeSourceFiles(pluginRoot: string, frontRootDir: string, frontRootRelative: string): Map<string, Uint8Array> {
  const snapshot = new Map<string, Uint8Array>()
  const visit = (dir: string, subpathPrefix: string) => {
    if (!existsSync(dir)) return
    try {
      if (lstatSync(dir).isSymbolicLink()) return
    } catch {
      return
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const subpath = `${subpathPrefix}/${entry.name}`
      let normalized: string
      try {
        normalized = normalizeRequestSubpath(subpath)
      } catch {
        continue
      }
      const path = resolvePath(pluginRoot, normalized)
      try {
        if (lstatSync(path).isSymbolicLink()) continue
      } catch {
        continue
      }
      if (entry.isDirectory()) {
        visit(path, normalized)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stats = statSync(path)
        if (!stats.isFile()) continue
        snapshot.set(normalized, readFileSync(path))
      } catch {
        // Best-effort snapshot. Runtime validation still runs before serving.
      }
    }
  }
  // Walk both the actual front root (e.g. `front/` for source-style
  // plugins, `dist/front/` for build-output plugins) and the shared
  // root. The front root prefix is preserved in snapshot keys so the
  // runtime validator can resolve the same subpath the request used.
  visit(frontRootDir, frontRootRelative.split("\\").join("/"))
  visit(resolvePath(pluginRoot, "shared"), "shared")
  return snapshot
}

async function resolveImportSubpath(record: TrackedPluginRecord, importerPath: string, source: string): Promise<string> {
  const relativeBase = posix.dirname(importerPath)
  const rawTarget = normalizeRequestSubpath(posix.normalize(posix.join(relativeBase, source)).replaceAll("\\", "/"))
  const hasExtension = extname(rawTarget) !== ""
  const candidates = new Set<string>()
  candidates.add(rawTarget)
  if (!hasExtension) {
    for (const suffix of IMPORT_RESOLVE_EXTENSIONS) {
      if (suffix) candidates.add(`${rawTarget}${suffix}`)
    }
    for (const indexFile of DIRECTORY_INDEX_CANDIDATES) {
      candidates.add(`${rawTarget}/${indexFile}`)
    }
  }

  for (const candidate of candidates) {
    if (record.sourceSnapshot.has(candidate)) return candidate
  }

  throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "resolve", "plugin runtime import not found in tracked revision", {
    importerPath,
    source,
  })
}

function packageNameFromBareSpecifier(source: string): string {
  const parts = source.split("/")
  return source.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]
}

interface PluginDependencyContext {
  workspaceId: string
  pluginId: string
  revision: number
  resolvedPath: string
}

function pluginDependencyVirtualId(record: TrackedPluginRecord, resolvedPath: string): string {
  return `${PLUGIN_DEPENDENCY_ID_PREFIX}${encodeURIComponent(record.workspaceId)}:${encodeURIComponent(record.pluginId)}:${record.revision}:${encodeURIComponent(resolvedPath)}`
}

function parsePluginDependencyVirtualId(id: string): PluginDependencyContext | null {
  const raw = id.startsWith(PLUGIN_DEPENDENCY_ID_PREFIX)
    ? id.slice(PLUGIN_DEPENDENCY_ID_PREFIX.length)
    : null
  if (!raw) return null
  const parts = raw.split(":")
  if (parts.length < 4) return null
  const [workspaceIdRaw, pluginIdRaw, revisionRaw, ...pathParts] = parts
  const revision = Number(revisionRaw)
  if (!Number.isInteger(revision) || revision < 1) return null
  return {
    workspaceId: decodeURIComponent(workspaceIdRaw),
    pluginId: decodeURIComponent(pluginIdRaw),
    revision,
    resolvedPath: decodeURIComponent(pathParts.join(":")),
  }
}

// Cache of nodeModulesDir → real paths of all top-level package entries.
// Built once per plugin instance; pnpm symlinks make the real path of each dep
// land in the global content-addressable store (outside node_modules), so we
// resolve every entry up-front and check containment against those real roots.
//
// This cache is intentionally unbounded and never invalidated. If a user runs
// `npm install` inside a plugin dir mid-session, they must restart the CLI for
// the new dep to be importable — the server's module graph has the same
// constraint — so a stale cache cannot be reached in normal use.
const pluginPackageRootsCache = new Map<string, Promise<ReadonlySet<string>>>()

async function getPluginPackageRoots(nodeModulesDir: string): Promise<ReadonlySet<string>> {
  let cached = pluginPackageRootsCache.get(nodeModulesDir)
  if (!cached) {
    cached = buildPluginPackageRoots(nodeModulesDir)
    pluginPackageRootsCache.set(nodeModulesDir, cached)
  }
  return cached
}

async function buildPluginPackageRoots(nodeModulesDir: string): Promise<ReadonlySet<string>> {
  const roots = new Set<string>()
  let entries: string[]
  try {
    entries = readdirSync(nodeModulesDir)
  } catch {
    return roots
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue // skip .pnpm, .modules.yaml, etc.
    const entryPath = resolvePath(nodeModulesDir, entry)
    if (entry.startsWith("@")) {
      // Scoped namespace directory — resolve each package inside it
      let scopedEntries: string[]
      try {
        scopedEntries = readdirSync(entryPath)
      } catch {
        continue
      }
      for (const scopedEntry of scopedEntries) {
        roots.add(await resolveRealLike(resolvePath(entryPath, scopedEntry)))
      }
    } else {
      roots.add(await resolveRealLike(entryPath))
    }
  }
  return roots
}

async function ensurePluginDependencyPath(record: TrackedPluginRecord, source: string, importer: string | undefined, resolvedPath: string): Promise<string> {
  const nodeModulesDir = resolvePath(record.rootDir, "node_modules")
  if (!existsSync(nodeModulesDir)) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_NOT_FOUND,
      404,
      "resolve",
      "runtime plugin dependency is not installed; run npm install in the plugin directory",
      { source, importer, pluginRoot: record.rootDir },
    )
  }

  const nodeModulesReal = await resolveRealLike(nodeModulesDir)
  const resolvedReal = await resolveRealLike(resolvedPath)
  if (!isWithin(nodeModulesReal, resolvedReal)) {
    // pnpm stores packages in a global content-addressable store and symlinks
    // them from node_modules. The real path of any pnpm-managed dep (including
    // files reachable via relative imports within that dep) lives outside
    // node_modules, so isWithin() always fails. Fall back to a cached set of
    // real package roots derived from the node_modules symlink targets: if
    // resolvedReal is inside any of those roots, it's legitimately installed.
    const packageRoots = await getPluginPackageRoots(nodeModulesDir)
    const isInstalledPackage = Array.from(packageRoots).some(
      (root) => root === resolvedReal || isWithin(root, resolvedReal),
    )
    if (!isInstalledPackage) {
      throw new PluginFrontRuntimeError(
        ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
        400,
        "resolve",
        "runtime plugin dependency resolved outside the plugin-local node_modules directory",
        { source, importer, resolvedPath, pluginNodeModules: nodeModulesDir },
      )
    }
  }
  return resolvedReal
}

async function resolvePluginLocalBareImport(record: TrackedPluginRecord, source: string, importer: string | undefined, importerFile = resolvePath(record.rootDir, "package.json")): Promise<string> {
  let resolvedPath: string
  try {
    resolvedPath = createRequire(importerFile).resolve(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_NOT_FOUND,
      404,
      "resolve",
      "runtime plugin dependency could not be resolved from the plugin directory",
      { source, importer, pluginRoot: record.rootDir, message, installHint: `cd ${record.rootDir} && npm install ${packageNameFromBareSpecifier(source)}` },
    )
  }

  return pluginDependencyVirtualId(record, await ensurePluginDependencyPath(record, source, importer, resolvedPath))
}

async function resolvePluginLocalRelativeDependencyImport(record: TrackedPluginRecord, source: string, context: PluginDependencyContext): Promise<string> {
  const rawTarget = resolvePath(dirname(context.resolvedPath), source)
  const candidates = new Set<string>()
  candidates.add(rawTarget)
  if (extname(rawTarget) === "") {
    for (const suffix of IMPORT_RESOLVE_EXTENSIONS) {
      if (suffix) candidates.add(`${rawTarget}${suffix}`)
    }
    for (const indexFile of DIRECTORY_INDEX_CANDIDATES) {
      candidates.add(resolvePath(rawTarget, indexFile))
    }
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    return pluginDependencyVirtualId(record, await ensurePluginDependencyPath(record, source, context.resolvedPath, candidate))
  }

  throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "resolve", "plugin dependency import not found in plugin-local node_modules", {
    importer: context.resolvedPath,
    source,
  })
}

function parseRevision(raw: string | number): number {
  const revision = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PLUGIN_RUNTIME_REVISION_MISMATCH,
      409,
      "validate",
      "plugin runtime revision must be a positive integer",
      { revision: raw },
    )
  }
  return revision
}

function isRuntimePathImport(source: string, basePath: string): boolean {
  return source === basePath || source.startsWith(`${basePath}/`)
}

function isUnsafeAbsoluteImport(source: string, basePath: string): boolean {
  return source.startsWith("/@fs/")
    || source.startsWith("//")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)
    || (source.startsWith("/") && !isRuntimePathImport(source, basePath))
    || isAbsolute(source)
}

function isBareImport(source: string): boolean {
  return !source.startsWith(".") && !source.startsWith("/") && !source.startsWith("file://")
}

function isUnsupportedHostProvidedSubpath(source: string): boolean {
  if (!isBareImport(source) || isHostProvidedModule(source)) return false
  const packageName = packageNameFromBareSpecifier(source)
  return HOST_PROVIDED_MODULES.some((moduleName) => packageNameFromBareSpecifier(moduleName) === packageName)
}

function stripBlockComments(sourceText: string): string {
  return sourceText.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
}

function scriptKindForPath(path: string): ts.ScriptKind {
  const extension = extname(path).toLowerCase()
  if (extension === ".tsx") return ts.ScriptKind.TSX
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return ts.ScriptKind.TS
  if (extension === ".jsx") return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

function runtimeAssetContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".avif": return "image/avif"
    case ".gif": return "image/gif"
    case ".ico": return "image/x-icon"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".png": return "image/png"
    case ".svg": return "image/svg+xml"
    case ".webp": return "image/webp"
    case ".woff": return "font/woff"
    case ".woff2": return "font/woff2"
    default: return "application/octet-stream"
  }
}

function runtimeAssetModuleCode(path: string, bytes: Uint8Array): string {
  const dataUrl = `data:${runtimeAssetContentType(path)};base64,${Buffer.from(bytes).toString("base64")}`
  return `export default ${JSON.stringify(dataUrl)};`
}

function validateSourceImports(sourceText: string, importer: string, basePath: string): void {
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
    specifier.startsWith("node:")
    || NODE_BUILTIN_MODULES.has(specifier)
    || isUnsafeAbsoluteImport(specifier, basePath)
    || isUnsupportedHostProvidedSubpath(specifier)
  )

  const isImportMetaGlobCall = (expression: ts.Expression): boolean => {
    if (!ts.isPropertyAccessExpression(expression)) return false
    if (expression.name.text !== "glob" && expression.name.text !== "globEager") return false
    return ts.isMetaProperty(expression.expression)
      && expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
      && expression.expression.name.text === "meta"
  }

  const extension = extname(importer).toLowerCase()
  if (extension === ".css") {
    const sanitizedCss = stripBlockComments(sourceText)
    const cssImportPattern = /^\s*@import\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)"']+))\s*\)|["']([^"']+)["'])/gm
    let cssMatch: RegExpExecArray | null
    while ((cssMatch = cssImportPattern.exec(sanitizedCss)) !== null) {
      const specifier = cssMatch[1] ?? cssMatch[2] ?? cssMatch[3] ?? ""
      if (isUnsafeSpecifier(specifier)) reject(specifier)
    }
    const cssUrlPattern = /\burl\(\s*(?:["']([^"']+)["']|([^\s)"']+))\s*\)/gm
    while ((cssMatch = cssUrlPattern.exec(sanitizedCss)) !== null) {
      const specifier = cssMatch[1] ?? cssMatch[2] ?? ""
      if (isUnsafeSpecifier(specifier)) reject(specifier)
    }
    return
  }

  const sourceFile = ts.createSourceFile(importer, sourceText, ts.ScriptTarget.Latest, true, scriptKindForPath(importer))

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      if (isUnsafeSpecifier(specifier)) reject(specifier)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      if (isUnsafeSpecifier(specifier)) reject(specifier)
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
        const specifier = argument.text
        if (isUnsafeSpecifier(specifier)) reject(specifier)
      } else {
        reject("computed-import")
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function packageRootFromRuntimeFile(): string {
  return resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..")
}

function findWorkspaceRoot(from: string): string {
  let current = from
  while (true) {
    if (existsSync(resolvePath(current, "pnpm-workspace.yaml"))) return current
    const parent = dirname(current)
    if (parent === current) return from
    current = parent
  }
}

function virtualSingletonId(source: string): string {
  return `${RUNTIME_SINGLETON_ID_PREFIX}${source}`
}

function sourceFromVirtualSingletonId(id: string): HostVirtualSingletonModule | undefined {
  if (!id.startsWith(RUNTIME_SINGLETON_ID_PREFIX)) return undefined
  const source = id.slice(RUNTIME_SINGLETON_ID_PREFIX.length)
  return isHostVirtualSingletonModule(source) ? source : undefined
}

function runtimeSingletonExportExpression(source: HostVirtualSingletonModule, name: string): string {
  const key = JSON.stringify(name)
  if (source === "react/jsx-dev-runtime") {
    if (name === "Fragment") return `(singleton[${key}] ?? singleton.default?.[${key}] ?? singletons?.react?.Fragment)`
    if (name === "jsxDEV") {
      return `(singleton[${key}] ?? singleton.default?.[${key}] ?? ((type, props, key) => singletons.react.createElement(type, key === undefined ? props : { ...props, key })))`
    }
  }
  if (source === "react/jsx-runtime") {
    if (name === "Fragment") return `(singleton[${key}] ?? singleton.default?.[${key}] ?? singletons?.react?.Fragment)`
    if (name === "jsx" || name === "jsxs") {
      return `(singleton[${key}] ?? singleton.default?.[${key}] ?? ((type, props, key) => singletons.react.createElement(type, key === undefined ? props : { ...props, key })))`
    }
  }
  return `singleton[${key}]`
}

function runtimeSingletonModuleCode(source: HostVirtualSingletonModule): string | undefined {
  const exports = RUNTIME_SINGLETON_EXPORTS[source]
  if (!exports) return undefined
  const exportLines = exports.map((name) => `export const ${name} = normalized[${JSON.stringify(name)}];`)
  const normalizedAssignments = exports.map((name) => `  ${JSON.stringify(name)}: ${runtimeSingletonExportExpression(source, name)},`)
  return [
    `const singletons = globalThis[${JSON.stringify(RUNTIME_SINGLETON_GLOBAL)}];`,
    `const singleton = singletons && singletons[${JSON.stringify(source)}];`,
    `if (!singleton) throw new Error(${JSON.stringify(`missing runtime singleton: ${source}`)});`,
    "const normalized = {",
    "  ...singleton,",
    ...normalizedAssignments,
    "};",
    "export default normalized;",
    ...exportLines,
  ].join("\n")
}

export function __testingRuntimeSingletonModuleCode(source: HostProvidedModule): string | undefined {
  return isHostVirtualSingletonModule(source) ? runtimeSingletonModuleCode(source) : undefined
}

function createRuntimeSingletonResolve(repoRoot: string): { alias: Array<{ find: RegExp; replacement: string }>; dedupe: string[] } {
  const alias: Array<{ find: RegExp; replacement: string }> = []
  const localWorkspaceAliases = [
    ["@hachej/boring-workspace/plugin", resolvePath(repoRoot, "packages", "workspace", "dist", "plugin.js"), resolvePath(repoRoot, "packages", "workspace", "src", "plugin.ts")],
    ["@hachej/boring-workspace/events", resolvePath(repoRoot, "packages", "workspace", "dist", "events.js"), resolvePath(repoRoot, "packages", "workspace", "src", "front", "events", "index.ts")],
    ["@hachej/boring-workspace", resolvePath(repoRoot, "packages", "workspace", "dist", "workspace.js"), resolvePath(repoRoot, "packages", "workspace", "src", "index.ts")],
    ["@hachej/boring-ui-kit", resolvePath(repoRoot, "packages", "ui", "dist", "index.js"), resolvePath(repoRoot, "packages", "ui", "src", "index.ts")],
  ] as const
  for (const [specifier, builtReplacement, sourceReplacement] of localWorkspaceAliases) {
    const replacement = existsSync(builtReplacement) ? builtReplacement : sourceReplacement
    if (existsSync(replacement)) alias.push({ find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), replacement })
  }
  return {
    alias,
    dedupe: ["react", "react-dom", "@hachej/boring-ui-kit"],
  }
}

class TransformLimiter {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) next()
  }
}

export interface PluginFrontRuntimeHost {
  readonly basePath: string
  readonly singletonModules: readonly string[]
  createFrontTargetResolver(workspaceId: string): PluginFrontTargetResolver
  trackPlugin(args: { workspaceId: string; plugin: BoringServerPluginManifest; revision: number; frontEntrySubpath: string }): string
  untrackPlugin(workspaceId: string, pluginId: string): void
  invalidatePlugin(workspaceId: string, pluginId: string, keepRevision?: number): Promise<void>
  disposeWorkspace(workspaceId: string): Promise<void>
  serve(request: PluginFrontRuntimeServeRequest): Promise<PluginFrontRuntimeResponse>
  warmupWorkspace(workspaceId: string): Promise<void>
  registerRoutes(app: FastifyInstance): Promise<void>
  close(): Promise<void>
}

export async function createPluginFrontRuntimeHost(
  options: CreatePluginFrontRuntimeHostOptions = {},
): Promise<PluginFrontRuntimeHost> {
  const basePath = normalizeBasePath(options.basePath ?? PLUGIN_FRONT_RUNTIME_BASE_PATH)
  const emit = (entry: Omit<PluginFrontRuntimeDiagnostic, "prefix">) => {
    options.onDiagnostic?.(diagnostic(entry))
  }
  const packageRoot = packageRootFromRuntimeFile()
  const repoRoot = findWorkspaceRoot(packageRoot)
  const singletonResolve = createRuntimeSingletonResolve(repoRoot)
  const trackedWorkspaces = new Map<string, Map<string, TrackedPluginRecord>>()
  const trackedPluginRevisions = new Map<string, Map<string, Map<number, TrackedPluginRecord>>>()
  const transformCache = new Map<string, TransformCacheEntry>()
  const mintedSupportPathsByCacheKey = new Map<string, string[]>()
  const mintedSupportPathRefCounts = new Map<string, number>()
  const limiter = new TransformLimiter(Math.max(1, options.maxTransformConcurrency ?? DEFAULT_MAX_TRANSFORM_CONCURRENCY))
  let closed = false

  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    // Disable the dep optimizer entirely. With discovery on, Vite re-optimizes
    // mid-session as plugin imports surface new deps; each pass rewrites
    // node_modules/.vite/deps and bumps the browserHash, invalidating chunk
    // URLs the browser already holds (ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR)
    // and stalling in-flight plugin front transforms indefinitely. The runtime
    // host serves deps through its own proxy/singleton routes, so pre-bundling
    // buys nothing here.
    root: repoRoot,
    // Skip the dep-optimisation entry scan. Without this, Vite crawls the
    // entire monorepo looking for import statements and hits files like
    // App.tsx that import `virtual:boring-front-plugins` — a module that
    // is not registered in this Vite server. That transform error corrupts
    // the dep-opt lock, causing any concurrently-starting Vite instance to
    // hang until the test timeout fires.
    // noDiscovery disables runtime dep discovery too, so transforming a plugin
    // module with bare imports (e.g. lucide-react) never triggers Vite's
    // esbuild pre-bundler, which would hang the request for tens of seconds.
    optimizeDeps: { entries: [], noDiscovery: true },
    plugins: [
      react(),
      {
        name: "boring-cli-plugin-front-runtime",
        async resolveId(source, importer) {
          if (isRuntimePathImport(source, basePath)) {
            return stripCacheBustSearch(source)
          }

          const dependencyContext = importer ? parsePluginDependencyVirtualId(importer) : null
          const importerContext = importer ? parseRuntimeContext(importer, basePath) : null
          const context = dependencyContext ?? importerContext
          if (!context) return null

          if (source.startsWith("node:") || NODE_BUILTIN_MODULES.has(source)) {
            throw new PluginFrontRuntimeError(
              ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
              400,
              "resolve",
              "Node built-in modules are not available in runtime plugin fronts",
              { source, importer },
            )
          }
          if (isUnsafeAbsoluteImport(source, basePath)) {
            throw new PluginFrontRuntimeError(
              ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
              400,
              "resolve",
              "plugin runtime import bypasses the host runtime URL space",
              { source, importer },
            )
          }
          if (isBareImport(source)) {
            if (isHostVirtualSingletonModule(source)) {
              return virtualSingletonId(source)
            }
            if (isHostProvidedModule(source)) {
              return source
            }
            const packageName = packageNameFromBareSpecifier(source)
            if (HOST_PROVIDED_MODULES.some((moduleName) => packageNameFromBareSpecifier(moduleName) === packageName)) {
              throw new PluginFrontRuntimeError(
                ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
                400,
                "resolve",
                "runtime plugin import targets an unsupported host-provided package subpath",
                { source, importer, packageName },
              )
            }
            const tracked = getTrackedPluginRevision(context.workspaceId, context.pluginId, context.revision)
            const importerFile = dependencyContext?.resolvedPath ?? resolvePath(tracked.rootDir, "package.json")
            return await resolvePluginLocalBareImport(tracked, source, importer, importerFile)
          }
          if (!source.startsWith(".") && !source.startsWith("..")) return null

          const tracked = getTrackedPluginRevision(context.workspaceId, context.pluginId, context.revision)
          if (dependencyContext) {
            return await resolvePluginLocalRelativeDependencyImport(tracked, source, dependencyContext)
          }
          const importedSubpath = await resolveImportSubpath(tracked, importerContext!.subpath, source)
          const url = buildRuntimeUrl(basePath, tracked.workspaceId, tracked.pluginId, importerContext!.revision, importedSubpath)
          return RUNTIME_ASSET_EXTENSIONS.has(extname(importedSubpath).toLowerCase()) ? `${url}?module` : url
        },
        async load(id) {
          const singletonSource = sourceFromVirtualSingletonId(id)
          if (singletonSource) return runtimeSingletonModuleCode(singletonSource) ?? null

          const dependencyContext = parsePluginDependencyVirtualId(id)
          if (dependencyContext) {
            const tracked = getTrackedPluginRevision(dependencyContext.workspaceId, dependencyContext.pluginId, dependencyContext.revision)
            const resolvedPath = await ensurePluginDependencyPath(tracked, dependencyContext.resolvedPath, id, dependencyContext.resolvedPath)
            if (RUNTIME_ASSET_EXTENSIONS.has(extname(resolvedPath).toLowerCase())) {
              return runtimeAssetModuleCode(resolvedPath, await readFile(resolvedPath))
            }
            const sourceText = await readFile(resolvedPath, "utf8")
            validateSourceImports(sourceText, resolvedPath, basePath)
            return sourceText
          }

          const context = parseRuntimeContext(id, basePath)
          if (!context) return null
          const tracked = getTrackedPluginRevision(context.workspaceId, context.pluginId, context.revision)
          const snapshotBytes = tracked.sourceSnapshot.get(context.subpath)
          if (snapshotBytes === undefined) {
            throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime file was not captured in this revision", {
              workspaceId: context.workspaceId,
              pluginId: context.pluginId,
              requestedRevision: context.revision,
              path: context.subpath,
            })
          }
          const resolvedPath = resolvePath(tracked.rootDir, context.subpath)
          if (RUNTIME_ASSET_EXTENSIONS.has(extname(context.subpath).toLowerCase())) {
            return runtimeAssetModuleCode(context.subpath, snapshotBytes ?? await readFile(resolvedPath))
          }
          const sourceText = snapshotBytes ? Buffer.from(snapshotBytes).toString("utf8") : await readFile(resolvedPath, "utf8")
          validateSourceImports(sourceText, context.subpath, basePath)
          return sourceText
        },
      },
    ],
    resolve: {
      alias: singletonResolve.alias,
      dedupe: [...singletonResolve.dedupe],
    },
    server: {
      middlewareMode: true,
      hmr: false,
      // Runtime plugin modules are served from immutable revision snapshots
      // plus explicit plugin-local dependency virtual ids. Watching the whole
      // monorepo is useless here and can exhaust CI file-watch limits.
      watch: null,
    },
  })

  function getTrackedPlugin(workspaceId: string, pluginId: string): TrackedPluginRecord {
    const plugins = trackedWorkspaces.get(workspaceId)
    const tracked = plugins?.get(pluginId)
    if (!tracked) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime record not found", {
        workspaceId,
        pluginId,
      })
    }
    return tracked
  }

  function getTrackedPluginRevision(workspaceId: string, pluginId: string, revision: number): TrackedPluginRecord {
    const tracked = trackedPluginRevisions.get(workspaceId)?.get(pluginId)?.get(revision)
    if (!tracked) {
      const current = trackedWorkspaces.get(workspaceId)?.get(pluginId)
      if (!current) {
        throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime record not found", {
          workspaceId,
          pluginId,
          requestedRevision: revision,
        })
      }
      throw new PluginFrontRuntimeError(ErrorCode.enum.PLUGIN_RUNTIME_REVISION_MISMATCH, 409, "validate", "plugin runtime revision is no longer tracked", {
        workspaceId,
        pluginId,
        requestedRevision: revision,
        currentRevision: current.revision,
      })
    }
    return tracked
  }

  function storeTrackedPlugin(record: TrackedPluginRecord, entryUrl: string): void {
    const workspacePlugins = trackedWorkspaces.get(record.workspaceId) ?? new Map<string, TrackedPluginRecord>()
    trackedWorkspaces.set(record.workspaceId, workspacePlugins)
    workspacePlugins.set(record.pluginId, record)
    const workspaceRevisions = trackedPluginRevisions.get(record.workspaceId) ?? new Map<string, Map<number, TrackedPluginRecord>>()
    trackedPluginRevisions.set(record.workspaceId, workspaceRevisions)
    const pluginRevisions = workspaceRevisions.get(record.pluginId) ?? new Map<number, TrackedPluginRecord>()
    workspaceRevisions.set(record.pluginId, pluginRevisions)
    pluginRevisions.set(record.revision, record)
    emit({
      level: "info",
      stage: "track",
      outcome: "tracked",
      msg: "tracked runtime plugin revision",
      workspaceId: record.workspaceId,
      pluginId: record.pluginId,
      revision: record.revision,
      requestedPath: record.frontEntrySubpath,
      details: {
        rootDir: record.rootDir,
        frontRootDir: record.frontRootDir,
        sharedRootDir: record.sharedRootDir,
        entryUrl,
      },
    })
  }

  function dropMintedSupportPaths(cacheKey: string): void {
    const minted = mintedSupportPathsByCacheKey.get(cacheKey)
    if (!minted) return
    mintedSupportPathsByCacheKey.delete(cacheKey)
    for (const path of minted) {
      const next = (mintedSupportPathRefCounts.get(path) ?? 0) - 1
      if (next <= 0) mintedSupportPathRefCounts.delete(path)
      else mintedSupportPathRefCounts.set(path, next)
    }
  }

  function recordMintedSupportPaths(cacheKey: string, paths: string[]): void {
    dropMintedSupportPaths(cacheKey)
    const unique = [...new Set(paths)]
    mintedSupportPathsByCacheKey.set(cacheKey, unique)
    for (const path of unique) {
      mintedSupportPathRefCounts.set(path, (mintedSupportPathRefCounts.get(path) ?? 0) + 1)
    }
  }

  function isMintedSupportPath(path: string): boolean {
    return isImplicitViteSupportPath(path, basePath) || (mintedSupportPathRefCounts.get(path) ?? 0) > 0
  }

  async function invalidateMatching(predicate: (record: ValidatedRuntimeRequest) => boolean): Promise<void> {
    for (const [cacheKey, entry] of [...transformCache.entries()]) {
      const context = parseRuntimeContext(entry.runtimeId, basePath)
      if (!context) continue
      const tracked = trackedWorkspaces.get(context.workspaceId)?.get(context.pluginId)
      const validated: ValidatedRuntimeRequest = {
        workspaceId: context.workspaceId,
        pluginId: context.pluginId,
        revision: context.revision,
        requestedPath: context.subpath,
        resolvedPath: "",
        runtimeId: entry.runtimeId,
        cacheKey,
        tracked: tracked ?? {
          workspaceId: context.workspaceId,
          pluginId: context.pluginId,
          revision: context.revision,
          rootDir: "",
          frontEntrySubpath: context.subpath,
          frontRootDir: "",
          sharedRootDir: "",
          sourceSnapshot: new Map(),
        },
      }
      if (!predicate(validated)) continue
      transformCache.delete(cacheKey)
      dropMintedSupportPaths(cacheKey)
      const moduleNode = vite.moduleGraph.getModuleById(entry.runtimeId)
      if (moduleNode) vite.moduleGraph.invalidateModule(moduleNode)
      emit({
        level: "info",
        stage: "cleanup",
        outcome: "disposed",
        msg: "disposed runtime transform cache entry",
        workspaceId: context.workspaceId,
        pluginId: context.pluginId,
        revision: context.revision,
        requestedPath: context.subpath,
      })
    }
  }

  async function validateRequest(request: PluginFrontRuntimeServeRequest): Promise<ValidatedRuntimeRequest> {
    if (closed) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.INTERNAL_ERROR, 503, "serve", "plugin front runtime host is closed")
    }
    const workspaceId = ensureSafeId("workspace", request.workspaceId)
    const pluginId = ensureSafeId("plugin", request.pluginId)
    const revision = parseRevision(request.revision)
    const requestedPath = normalizeRequestSubpath(request.subpath)
    const tracked = getTrackedPluginRevision(workspaceId, pluginId, revision)
    if (!tracked.sourceSnapshot.has(requestedPath)) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime file was not captured in this revision", {
        workspaceId,
        pluginId,
        requestedRevision: revision,
        path: requestedPath,
      })
    }
    const resolvedPath = resolvePath(tracked.rootDir, requestedPath)
    const runtimeId = `${buildRuntimeUrl(basePath, workspaceId, pluginId, revision, requestedPath)}${normalizeSearch(request.search)}`
    const cacheKey = `${workspaceId}:${pluginId}:${revision}:${requestedPath}${normalizeSearch(request.search)}`
    return { workspaceId, pluginId, revision, requestedPath, resolvedPath, runtimeId, cacheKey, tracked }
  }

  function toApiError(error: unknown, request?: Partial<ValidatedRuntimeRequest>): { statusCode: number; body: { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } } {
    if (error instanceof PluginFrontRuntimeError) {
      return {
        statusCode: error.statusCode,
        body: {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      statusCode: 500,
      body: {
        error: {
          code: ErrorCode.enum.PLUGIN_RUNTIME_TRANSFORM_FAILED,
          message,
          ...(request
            ? { details: { workspaceId: request.workspaceId, pluginId: request.pluginId, revision: request.revision, path: request.requestedPath } }
            : {}),
        },
      },
    }
  }

  async function serve(request: PluginFrontRuntimeServeRequest): Promise<PluginFrontRuntimeResponse> {
    const startedAt = Date.now()
    let validated: ValidatedRuntimeRequest | undefined
    try {
      const resolved = await validateRequest(request)
      validated = resolved
      const cached = transformCache.get(resolved.cacheKey)
      if (cached) {
        emit({
          level: "info",
          stage: "cache",
          outcome: "cache-hit",
          msg: "served runtime module from transform cache",
          workspaceId: resolved.workspaceId,
          pluginId: resolved.pluginId,
          revision: resolved.revision,
          requestedPath: resolved.requestedPath,
          resolvedPath: resolved.resolvedPath,
        })
        return await cached.promise
      }

      emit({
        level: "info",
        stage: "cache",
        outcome: "cache-miss",
        msg: "runtime transform cache miss",
        workspaceId: resolved.workspaceId,
        pluginId: resolved.pluginId,
        revision: resolved.revision,
        requestedPath: resolved.requestedPath,
        resolvedPath: resolved.resolvedPath,
      })

      const runtimeRequest = resolved
      const promise = limiter.run(async () => {
        const transformStartedAt = Date.now()
        try {
          if (RUNTIME_ASSET_EXTENSIONS.has(extname(runtimeRequest.requestedPath).toLowerCase())) {
            const snapshotBytes = runtimeRequest.tracked.sourceSnapshot.get(runtimeRequest.requestedPath)
            if (snapshotBytes === undefined) {
              throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime file was not captured in this revision")
            }
            const bytes = snapshotBytes
            const assetAsModule = new URLSearchParams((request.search ?? "").replace(/^\?/, "")).has("module")
            return {
              body: assetAsModule ? runtimeAssetModuleCode(runtimeRequest.requestedPath, bytes) : bytes,
              contentType: assetAsModule ? "application/javascript; charset=utf-8" : runtimeAssetContentType(runtimeRequest.requestedPath),
              cacheKey: runtimeRequest.cacheKey,
            }
          }
          const transformed = await vite.transformRequest(runtimeRequest.runtimeId)
          if (!transformed?.code) {
            throw new PluginFrontRuntimeError(
              ErrorCode.enum.PLUGIN_RUNTIME_TRANSFORM_FAILED,
              500,
              "transform",
              "plugin runtime transform returned no module code",
              { runtimeId: runtimeRequest.runtimeId },
            )
          }
          emit({
            level: "info",
            stage: "transform",
            outcome: "served",
            msg: "transformed runtime plugin module",
            workspaceId: runtimeRequest.workspaceId,
            pluginId: runtimeRequest.pluginId,
            revision: runtimeRequest.revision,
            requestedPath: runtimeRequest.requestedPath,
            resolvedPath: runtimeRequest.resolvedPath,
            durationMs: Date.now() - transformStartedAt,
          })
          const rewritten = rewriteViteSupportUrls(transformed.code, basePath)
          assertNoUnsafeFsSupportReference(rewritten.code, {
            runtimeId: runtimeRequest.runtimeId,
            workspaceId: runtimeRequest.workspaceId,
            pluginId: runtimeRequest.pluginId,
            revision: runtimeRequest.revision,
            path: runtimeRequest.requestedPath,
          })
          recordMintedSupportPaths(runtimeRequest.cacheKey, rewritten.mintedPaths)
          return {
            body: rewritten.code,
            contentType: "application/javascript; charset=utf-8",
            cacheKey: runtimeRequest.cacheKey,
          }
        } catch (error) {
          if (error instanceof PluginFrontRuntimeError) throw error
          throw new PluginFrontRuntimeError(
            ErrorCode.enum.PLUGIN_RUNTIME_TRANSFORM_FAILED,
            500,
            "transform",
            error instanceof Error ? error.message : String(error),
            { runtimeId: runtimeRequest.runtimeId },
          )
        }
      })

      transformCache.set(runtimeRequest.cacheKey, { runtimeId: runtimeRequest.runtimeId, promise })
      const response = await promise
      emit({
        level: "info",
        stage: "serve",
        outcome: "served",
        msg: "served runtime plugin module",
        workspaceId: runtimeRequest.workspaceId,
        pluginId: runtimeRequest.pluginId,
        revision: runtimeRequest.revision,
        requestedPath: runtimeRequest.requestedPath,
        resolvedPath: runtimeRequest.resolvedPath,
        durationMs: Date.now() - startedAt,
      })
      return response
    } catch (error) {
      if (validated) {
        transformCache.delete(validated.cacheKey)
        dropMintedSupportPaths(validated.cacheKey)
      }
      const apiError = toApiError(error, validated)
      emit({
        level: apiError.statusCode >= 500 ? "error" : "warn",
        stage: error instanceof PluginFrontRuntimeError ? error.stage : "transform",
        outcome: "rejected",
        msg: apiError.body.error.message,
        workspaceId: validated?.workspaceId ?? request.workspaceId,
        pluginId: validated?.pluginId ?? request.pluginId,
        revision: validated?.revision ?? (typeof request.revision === "number" ? request.revision : Number(request.revision) || undefined),
        requestedPath: validated?.requestedPath ?? request.subpath,
        resolvedPath: validated?.resolvedPath,
        durationMs: Date.now() - startedAt,
        code: apiError.body.error.code,
        details: apiError.body.error.details,
      })
      throw error
    }
  }

  async function forwardToVite(request: { raw: NodeJS.ReadableStream & { url?: string } }, reply: { raw: NodeJS.WritableStream & { statusCode?: number; setHeader?: (name: string, value: string) => void; end: (chunk?: unknown) => void; writableEnded?: boolean }; hijack: () => void }): Promise<void> {
    reply.hijack()
    await new Promise<void>((resolve, reject) => {
      vite.middlewares(request.raw as never, reply.raw as never, (error: unknown) => {
        if (error) reject(error)
        else resolve()
      })
    })
    if (!reply.raw.writableEnded) {
      reply.raw.statusCode = 404
      reply.raw.end()
    }
  }

  async function registerRoutes(app: FastifyInstance): Promise<void> {
    app.get(`${basePath}/:workspaceId/:pluginId/:revision/*`, async (request, reply) => {
      const params = request.params as { workspaceId: string; pluginId: string; revision: string; "*": string }
      try {
        const response = await serve({
          workspaceId: params.workspaceId,
          pluginId: params.pluginId,
          revision: params.revision,
          subpath: params["*"],
          search: request.raw.url?.includes("?") ? request.raw.url.slice(request.raw.url.indexOf("?")) : "",
        })
        return reply.type(response.contentType).send(response.body)
      } catch (error) {
        const apiError = toApiError(error)
        return reply.code(apiError.statusCode).send(apiError.body)
      }
    })
    app.get(`${basePath}/__vite/client`, async (request, reply) => {
      const mintedPath = request.raw.url?.split("?")[0] ?? `${basePath}/__vite/client`
      if (!isMintedSupportPath(mintedPath)) {
        const apiError = toApiError(new PluginFrontRuntimeError(
          ErrorCode.enum.PATH_NOT_FOUND,
          404,
          "validate",
          "vite support path was not minted by a validated runtime module",
          { targetPath: mintedPath },
        ))
        return reply.code(apiError.statusCode).send(apiError.body)
      }
      const transformed = await vite.transformRequest("/@vite/client")
      if (transformed?.code) {
        const rewritten = rewriteViteSupportUrls(transformed.code, basePath)
        recordMintedSupportPaths("__vite:client", rewritten.mintedPaths)
        return reply
          .type("application/javascript; charset=utf-8")
          .send(rewritten.code)
      }
      request.raw.url = "/@vite/client"
      await forwardToVite(request, reply)
    })
    app.get(`${basePath}/__vite/env`, async (request, reply) => {
      request.raw.url = "/@vite/env"
      await forwardToVite(request, reply)
    })
    app.get(`${basePath}/__vite/singleton/*`, async (request, reply) => {
      const { "*": encodedSource } = request.params as { "*": string }
      const mintedPath = request.raw.url?.split("?")[0] ?? `${basePath}/__vite/singleton/${encodedSource}`
      if (!isMintedSupportPath(mintedPath)) {
        const apiError = toApiError(new PluginFrontRuntimeError(
          ErrorCode.enum.PATH_NOT_FOUND,
          404,
          "validate",
          "vite singleton path was not minted by a validated runtime module",
          { targetPath: mintedPath },
        ))
        return reply.code(apiError.statusCode).send(apiError.body)
      }
      const source = decodeURIComponent(encodedSource)
      const code = isHostVirtualSingletonModule(source) ? runtimeSingletonModuleCode(source) : undefined
      if (!code) {
        const apiError = toApiError(new PluginFrontRuntimeError(
          ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
          400,
          "validate",
          "unsupported runtime singleton path",
          { source },
        ))
        return reply.code(apiError.statusCode).send(apiError.body)
      }
      return reply.type("application/javascript; charset=utf-8").send(code)
    })
    app.get(`${basePath}/__vite/proxy/*`, async (request, reply) => {
      const { "*": encodedTarget } = request.params as { "*": string }
      const mintedPath = request.raw.url?.split("?")[0] ?? `${basePath}/__vite/proxy/${encodedTarget}`
      if (!isMintedSupportPath(mintedPath)) {
        const apiError = toApiError(new PluginFrontRuntimeError(
          ErrorCode.enum.PATH_NOT_FOUND,
          404,
          "validate",
          "vite support path was not minted by a validated runtime module",
          { targetPath: mintedPath },
        ))
        return reply.code(apiError.statusCode).send(apiError.body)
      }
      const targetPath = `/${decodeURIComponent(encodedTarget)}`
      if (!/^\/(?:@id|node_modules|packages)\//.test(targetPath)) {
        const apiError = toApiError(new PluginFrontRuntimeError(
          ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
          400,
          "validate",
          "unsupported Vite support path",
          { targetPath },
        ))
        return reply.code(apiError.statusCode).send(apiError.body)
      }

      const search = request.raw.url?.includes("?") ? request.raw.url.slice(request.raw.url.indexOf("?")) : ""
      const viteTargetPath = targetPath.startsWith("/@id/__x00__") ? `\0${targetPath.slice("/@id/__x00__".length)}` : targetPath
      const transformed = await vite.transformRequest(`${viteTargetPath}${normalizeSearch(search)}`)
      if (transformed?.code) {
        const rewritten = rewriteViteSupportUrls(transformed.code, basePath)
        assertNoUnsafeFsSupportReference(rewritten.code, { targetPath })
        recordMintedSupportPaths(`support:${mintedPath}`, rewritten.mintedPaths)
        return reply
          .type("application/javascript; charset=utf-8")
          .send(rewritten.code)
      }

      request.raw.url = targetPath
      await forwardToVite(request, reply)
    })

    app.addHook("onClose", async () => {
      await close()
    })
  }

  async function invalidatePlugin(workspaceId: string, pluginId: string, keepRevision?: number): Promise<void> {
    await invalidateMatching((entry) => (
      entry.workspaceId === workspaceId
      && entry.pluginId === pluginId
      && (keepRevision === undefined || entry.revision !== keepRevision)
    ))
  }

  async function disposeWorkspace(workspaceId: string): Promise<void> {
    trackedWorkspaces.delete(workspaceId)
    trackedPluginRevisions.delete(workspaceId)
    await invalidateMatching((entry) => entry.workspaceId === workspaceId)
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    trackedWorkspaces.clear()
    trackedPluginRevisions.clear()
    transformCache.clear()
    mintedSupportPathsByCacheKey.clear()
    mintedSupportPathRefCounts.clear()
    emit({
      level: "info",
      stage: "cleanup",
      outcome: "closed",
      msg: "closed plugin front runtime host",
    })
    await vite.close()
  }

  function trackPlugin(args: { workspaceId: string; plugin: BoringServerPluginManifest; revision: number; frontEntrySubpath: string }): string {
    const workspaceId = ensureSafeId("workspace", args.workspaceId)
    const pluginId = ensureSafeId("plugin", args.plugin.id)
    const revision = parseRevision(args.revision)
    const frontEntrySubpath = normalizeRequestSubpath(args.frontEntrySubpath)
    assertRuntimeFrontEntrySubpath(frontEntrySubpath)
    const entryUrl = buildRuntimeUrl(basePath, workspaceId, pluginId, revision, frontEntrySubpath)
    const rootDir = resolvePath(args.plugin.rootDir)
    // Compute the front root ONCE: source-style plugins expose
    // `front/index.tsx` (front root is `front/`); build-output plugins
    // expose `dist/front/index.js` (front root is `dist/front/`). The
    // root governs both the served allowed subtree and the source
    // snapshot, so they must agree.
    const frontRootRelative = (frontEntrySubpath === "front" || frontEntrySubpath.startsWith("front/"))
      ? "front"
      : dirname(frontEntrySubpath)
    const frontRootDir = resolvePath(rootDir, frontRootRelative)
    storeTrackedPlugin({
      workspaceId,
      pluginId,
      revision,
      rootDir,
      frontEntrySubpath,
      frontRootDir,
      sharedRootDir: resolvePath(rootDir, "shared"),
      sourceSnapshot: snapshotRuntimeSourceFiles(rootDir, frontRootDir, frontRootRelative),
    }, entryUrl)
    return entryUrl
  }

  function createFrontTargetResolver(workspaceId: string): PluginFrontTargetResolver {
    return (plugin: BoringServerPluginManifest, context: { revision: number; frontEntrySubpath: string }) => {
      if (!plugin.frontPath) return undefined
      const frontEntrySubpath = normalizeRequestSubpath(context.frontEntrySubpath)
      // The runtime host serves any relative path inside the plugin
      // root. Source-style plugins expose `front/index.tsx`; published
      // build-output plugins expose `dist/front/index.js`. Both layouts
      // are valid — accept any subpath that targets a `front/` segment
      // somewhere inside the package, and reject everything else
      // (catches manifest typos and accidental relative-path escapes).
      if (!/(^|\/)front\//.test(frontEntrySubpath)) return undefined
      return {
        kind: "native",
        entryUrl: trackPlugin({
          workspaceId,
          plugin,
          revision: context.revision,
          frontEntrySubpath,
        }),
        revision: context.revision,
        trust: "local-trusted-native",
      }
    }
  }

  // Pre-transform the front entry (and, transitively, the react /
  // @hachej/boring-workspace singleton modules it imports) for every tracked
  // plugin in a workspace so the first browser request hits a warm transform
  // cache instead of paying ~4s of cold Vite resolve/transform that starves
  // the event loop. Fire-and-forget: failures are swallowed (the real browser
  // request will surface them) and serve()'s own promise-dedupe means a
  // concurrent browser hit reuses this in-flight transform rather than racing.
  async function warmupWorkspace(workspaceId: string): Promise<void> {
    if (closed) return
    const records = trackedWorkspaces.get(workspaceId)
    if (!records || records.size === 0) return
    await Promise.all(
      [...records.values()].map(async (record) => {
        try {
          await serve({
            workspaceId,
            pluginId: record.pluginId,
            revision: record.revision,
            subpath: record.frontEntrySubpath,
          })
        } catch (error) {
          emit({
            level: "warn",
            stage: "transform",
            outcome: "rejected",
            msg: "plugin front warmup transform failed (ignored)",
            workspaceId,
            pluginId: record.pluginId,
            revision: record.revision,
            requestedPath: record.frontEntrySubpath,
            details: { error: error instanceof Error ? error.message : String(error) },
          })
        }
      }),
    )
  }

  function untrackPlugin(workspaceId: string, pluginId: string): void {
    const tracked = trackedWorkspaces.get(workspaceId)?.get(pluginId)
    trackedWorkspaces.get(workspaceId)?.delete(pluginId)
    trackedPluginRevisions.get(workspaceId)?.delete(pluginId)
    emit({
      level: "info",
      stage: "cleanup",
      outcome: "disposed",
      msg: "untracked runtime plugin revision",
      workspaceId,
      pluginId,
      revision: tracked?.revision,
      requestedPath: tracked?.frontEntrySubpath,
      details: tracked
        ? {
            rootDir: tracked.rootDir,
            frontRootDir: tracked.frontRootDir,
            sharedRootDir: tracked.sharedRootDir,
          }
        : undefined,
    })
    void invalidatePlugin(workspaceId, pluginId)
  }

  return {
    basePath,
    singletonModules: HOST_SINGLETON_MODULES,
    createFrontTargetResolver,
    trackPlugin,
    untrackPlugin,
    invalidatePlugin,
    disposeWorkspace,
    serve,
    warmupWorkspace,
    registerRoutes,
    close,
  }
}

function stripCacheBustSearch(id: string): string {
  const parsed = new URL(id, "http://runtime.local")
  const search = normalizeSearch(parsed.search)
  return `${parsed.pathname}${search}`
}

function parseRuntimeContext(id: string, basePath: string): { workspaceId: string; pluginId: string; revision: number; subpath: string } | null {
  let parsed: URL
  try {
    parsed = new URL(id, "http://runtime.local")
  } catch {
    return null
  }
  if (!parsed.pathname.startsWith(`${basePath}/`)) return null
  const raw = parsed.pathname.slice(basePath.length + 1)
  const parts = raw.split("/")
  if (parts.length < 4) return null
  const [workspaceId, pluginId, revisionRaw, ...subpathParts] = parts
  try {
    return {
      workspaceId: ensureSafeId("workspace", decodeURIComponent(workspaceId)),
      pluginId: ensureSafeId("plugin", decodeURIComponent(pluginId)),
      revision: parseRevision(decodeURIComponent(revisionRaw)),
      subpath: normalizeRequestSubpath(subpathParts.map((part) => decodeURIComponent(part)).join("/")),
    }
  } catch {
    return null
  }
}
