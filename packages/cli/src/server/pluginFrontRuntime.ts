import type { FastifyInstance } from "fastify"
import { builtinModules, createRequire } from "node:module"
import { existsSync } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import { dirname, extname, isAbsolute, posix, relative, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { ErrorCode } from "@hachej/boring-agent/shared"
import type { BoringServerPluginManifest } from "@hachej/boring-workspace/server"
import ts from "typescript"
import { createServer } from "vite"

export const PLUGIN_FRONT_RUNTIME_BASE_PATH = "/api/v1/agent-plugins/runtime"
export const HOST_SINGLETON_MODULES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@hachej/boring-workspace",
  "@hachej/boring-workspace/plugin",
  "@hachej/boring-workspace/events",
] as const

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
const DIRECTORY_INDEX_CANDIDATES = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.cjs",
  "index.css",
]
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

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
  body: string
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
    if (segment.startsWith(".") || lower === ".ds_store" || PRIVATE_FILE_NAMES.has(segment) || lower.startsWith(".env")) {
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

function rewriteViteSupportUrls(code: string, basePath: string): string {
  return code
    .replaceAll("/@vite/client", `${basePath}/__vite/client`)
    .replace(/(["'])\/(?:@id|node_modules|packages)\/([^"']+)\1/g, (match, quote: string) => {
      const originalPath = match.slice(1, -1)
      return `${quote}${buildViteProxyUrl(basePath, originalPath)}${quote}`
    })
}

function extractMintedSupportPaths(code: string, basePath: string): string[] {
  const paths = new Set<string>()
  const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const supportPattern = new RegExp(`${escapedBasePath}\\/__vite\\/(?:client|proxy\\/[^"'\\s)]+)`, "g")
  let match: RegExpExecArray | null
  while ((match = supportPattern.exec(code)) !== null) {
    const value = match[0]
    if (value) paths.add(value)
  }
  return [...paths]
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

  let lastNotFound: PluginFrontRuntimeError | null = null
  for (const candidate of candidates) {
    try {
      await resolveFileWithinPlugin(record, candidate)
      return candidate
    } catch (error) {
      if (error instanceof PluginFrontRuntimeError && error.code === ErrorCode.enum.PATH_NOT_FOUND) {
        lastNotFound = error
        continue
      }
      throw error
    }
  }

  throw lastNotFound ?? new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "resolve", "plugin runtime import not found", {
    importerPath,
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
    specifier.startsWith("node:") || NODE_BUILTIN_MODULES.has(specifier) || isUnsafeAbsoluteImport(specifier, basePath)
  )

  const extension = extname(importer).toLowerCase()
  if (extension === ".css") {
    const sanitizedCss = stripBlockComments(sourceText)
    const cssImportPattern = /^\s*@import\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)"']+))\s*\)|["']([^"']+)["'])/gm
    let cssMatch: RegExpExecArray | null
    while ((cssMatch = cssImportPattern.exec(sanitizedCss)) !== null) {
      const specifier = cssMatch[1] ?? cssMatch[2] ?? cssMatch[3] ?? ""
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

function createRuntimeSingletonResolve(repoRoot: string): { alias: Array<{ find: RegExp; replacement: string }>; dedupe: string[] } {
  const require = createRequire(import.meta.url)
  const reactRequire = (id: string) => require.resolve(id)
  const alias = [
    { find: /^react$/, replacement: reactRequire("react") },
    { find: /^react-dom$/, replacement: reactRequire("react-dom") },
    { find: /^react-dom\/client$/, replacement: reactRequire("react-dom/client") },
    { find: /^react\/jsx-runtime$/, replacement: reactRequire("react/jsx-runtime") },
    { find: /^react\/jsx-dev-runtime$/, replacement: reactRequire("react/jsx-dev-runtime") },
  ]
  const localWorkspaceAliases = [
    ["@hachej/boring-workspace/plugin", resolvePath(repoRoot, "packages", "workspace", "dist", "plugin.js"), resolvePath(repoRoot, "packages", "workspace", "src", "plugin.ts")],
    ["@hachej/boring-workspace/events", resolvePath(repoRoot, "packages", "workspace", "dist", "events.js"), resolvePath(repoRoot, "packages", "workspace", "src", "front", "events", "index.ts")],
    ["@hachej/boring-workspace", resolvePath(repoRoot, "packages", "workspace", "dist", "workspace.js"), resolvePath(repoRoot, "packages", "workspace", "src", "index.ts")],
  ] as const
  for (const [specifier, builtReplacement, sourceReplacement] of localWorkspaceAliases) {
    const replacement = existsSync(builtReplacement) ? builtReplacement : sourceReplacement
    if (existsSync(replacement)) alias.push({ find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), replacement })
  }
  return {
    alias,
    dedupe: ["react", "react-dom"],
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
  const transformCache = new Map<string, TransformCacheEntry>()
  const mintedSupportPathsByCacheKey = new Map<string, string[]>()
  const mintedSupportPathRefCounts = new Map<string, number>()
  const limiter = new TransformLimiter(Math.max(1, options.maxTransformConcurrency ?? DEFAULT_MAX_TRANSFORM_CONCURRENCY))
  let closed = false

  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: repoRoot,
    plugins: [
      react(),
      {
        name: "boring-cli-plugin-front-runtime",
        async resolveId(source, importer) {
          if (isRuntimePathImport(source, basePath)) {
            return stripCacheBustSearch(source)
          }

          const importerContext = importer ? parseRuntimeContext(importer, basePath) : null
          if (!importerContext) return null

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
            if (HOST_SINGLETON_MODULES.includes(source as typeof HOST_SINGLETON_MODULES[number])) return source
            return null
          }
          if (!source.startsWith(".") && !source.startsWith("..")) return null

          const tracked = getTrackedPlugin(importerContext.workspaceId, importerContext.pluginId)
          const importedSubpath = await resolveImportSubpath(tracked, importerContext.subpath, source)
          return buildRuntimeUrl(basePath, tracked.workspaceId, tracked.pluginId, tracked.revision, importedSubpath)
        },
        async load(id) {
          const context = parseRuntimeContext(id, basePath)
          if (!context) return null
          const tracked = getTrackedPlugin(context.workspaceId, context.pluginId)
          if (tracked.revision !== context.revision) {
            throw new PluginFrontRuntimeError(
              ErrorCode.enum.PLUGIN_RUNTIME_REVISION_MISMATCH,
              409,
              "validate",
              "plugin runtime request used a stale revision",
              {
                workspaceId: context.workspaceId,
                pluginId: context.pluginId,
                requestedRevision: context.revision,
                currentRevision: tracked.revision,
              },
            )
          }
          const resolvedPath = await resolveFileWithinPlugin(tracked, context.subpath)
          const sourceText = await readFile(resolvedPath, "utf8")
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

  function storeTrackedPlugin(record: TrackedPluginRecord): void {
    const workspacePlugins = trackedWorkspaces.get(record.workspaceId) ?? new Map<string, TrackedPluginRecord>()
    trackedWorkspaces.set(record.workspaceId, workspacePlugins)
    workspacePlugins.set(record.pluginId, record)
    emit({
      level: "info",
      stage: "track",
      outcome: "tracked",
      msg: "tracked runtime plugin revision",
      workspaceId: record.workspaceId,
      pluginId: record.pluginId,
      revision: record.revision,
      requestedPath: record.frontEntrySubpath,
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
    return (mintedSupportPathRefCounts.get(path) ?? 0) > 0
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
    const tracked = getTrackedPlugin(workspaceId, pluginId)
    if (tracked.revision !== revision) {
      throw new PluginFrontRuntimeError(
        ErrorCode.enum.PLUGIN_RUNTIME_REVISION_MISMATCH,
        409,
        "validate",
        "plugin runtime request used a stale revision",
        {
          workspaceId,
          pluginId,
          requestedRevision: revision,
          currentRevision: tracked.revision,
        },
      )
    }
    const resolvedPath = await resolveFileWithinPlugin(tracked, requestedPath)
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
          const body = rewriteViteSupportUrls(transformed.code, basePath)
          recordMintedSupportPaths(runtimeRequest.cacheKey, extractMintedSupportPaths(body, basePath))
          return {
            body,
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
      request.raw.url = "/@vite/client"
      await forwardToVite(request, reply)
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
    await invalidateMatching((entry) => entry.workspaceId === workspaceId)
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    trackedWorkspaces.clear()
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
    storeTrackedPlugin({
      workspaceId,
      pluginId,
      revision,
      rootDir: resolvePath(args.plugin.rootDir),
      frontEntrySubpath,
      frontRootDir: resolvePath(
        args.plugin.rootDir,
        frontEntrySubpath === "front" || frontEntrySubpath.startsWith("front/")
          ? "front"
          : dirname(frontEntrySubpath),
      ),
      sharedRootDir: resolvePath(args.plugin.rootDir, "shared"),
    })
    void invalidatePlugin(workspaceId, pluginId, revision)
    return buildRuntimeUrl(basePath, workspaceId, pluginId, revision, frontEntrySubpath)
  }

  function createFrontTargetResolver(workspaceId: string): PluginFrontTargetResolver {
    return (plugin: BoringServerPluginManifest, context: { revision: number; frontEntrySubpath: string }) => {
      if (!plugin.frontPath) return undefined
      return {
        kind: "native",
        entryUrl: trackPlugin({
          workspaceId,
          plugin,
          revision: context.revision,
          frontEntrySubpath: context.frontEntrySubpath,
        }),
        revision: context.revision,
        trust: "local-trusted-native",
      }
    }
  }

  function untrackPlugin(workspaceId: string, pluginId: string): void {
    trackedWorkspaces.get(workspaceId)?.delete(pluginId)
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
