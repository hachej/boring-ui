import { existsSync, realpathSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path"
import { ErrorCode } from "@hachej/boring-agent/shared"
import { PluginFrontRuntimeError } from "./diagnostics.js"

export const PLUGIN_FRONT_RUNTIME_BASE_PATH = "/api/v1/agent-plugins/runtime"

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/
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

export interface RuntimeContext {
  workspaceId: string
  pluginId: string
  revision: number
  subpath: string
}

// ---------------------------------------------------------------------------
// Request identity validation
// ---------------------------------------------------------------------------

export function ensureSafeId(kind: "workspace" | "plugin", value: string): string {
  const trimmed = value.trim()
  const details = { [kind === "workspace" ? "workspaceId" : "pluginId"]: value }
  if (!trimmed) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", `${kind} id is required`, details)
  }
  if (trimmed.includes("\0")) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NULL_BYTE, 400, "validate", `${kind} id contains a null byte`, details)
  }
  if (!SAFE_SEGMENT_RE.test(trimmed)) {
    throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_ESCAPE, 403, "validate", `invalid ${kind} id`, details)
  }
  return trimmed
}

export function parseRevision(raw: string | number): number {
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

export function normalizeRequestSubpath(raw: string): string {
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

/**
 * Accept any subpath that targets a `front/` segment inside the package.
 * Source-style plugins expose `front/index.tsx`; published build-output
 * plugins expose `dist/front/index.js`. Both layouts are valid — paths
 * without a `front/` directory anywhere are manifest typos or accidental
 * relative-path escapes.
 */
export function hasFrontDirectorySegment(frontEntrySubpath: string): boolean {
  return /(^|\/)front\//.test(frontEntrySubpath)
}

export function assertRuntimeFrontEntrySubpath(frontEntrySubpath: string): void {
  if (hasFrontDirectorySegment(frontEntrySubpath)) return
  throw new PluginFrontRuntimeError(
    ErrorCode.enum.PLUGIN_RUNTIME_PRIVATE_FILE,
    403,
    "validate",
    "native runtime plugin fronts must live under a front/ directory",
    { frontEntrySubpath },
  )
}

// ---------------------------------------------------------------------------
// Runtime URL space
// ---------------------------------------------------------------------------

export function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim()
  if (!trimmed.startsWith("/")) throw new Error(`plugin front runtime basePath must start with '/': ${basePath}`)
  return trimmed.replace(/\/+$/, "") || "/"
}

/** Drops cache-busting params and orders the rest so ids/cache keys are stable. */
export function normalizeSearch(search: string | undefined): string {
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

export function buildRuntimeUrl(basePath: string, workspaceId: string, pluginId: string, revision: number, subpath: string): string {
  const encodedSubpath = subpath.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  return `${basePath}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(pluginId)}/${revision}/${encodedSubpath}`
}

export function stripCacheBustSearch(id: string): string {
  const parsed = new URL(id, "http://runtime.local")
  return `${parsed.pathname}${normalizeSearch(parsed.search)}`
}

/** Parses a runtime URL/module id back into the plugin revision it addresses. */
export function parseRuntimeContext(id: string, basePath: string): RuntimeContext | null {
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

// ---------------------------------------------------------------------------
// Import specifier shapes
// ---------------------------------------------------------------------------

export function isRuntimePathImport(source: string, basePath: string): boolean {
  return source === basePath || source.startsWith(`${basePath}/`)
}

export function isUnsafeAbsoluteImport(source: string, basePath: string): boolean {
  return source.startsWith("/@fs/")
    || source.startsWith("//")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)
    || (source.startsWith("/") && !isRuntimePathImport(source, basePath))
    || isAbsolute(source)
}

export function isBareImport(source: string): boolean {
  return !source.startsWith(".") && !source.startsWith("/") && !source.startsWith("file://")
}

// ---------------------------------------------------------------------------
// Filesystem containment
// ---------------------------------------------------------------------------

export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

export function realpathIfExists(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : path
  } catch {
    return path
  }
}

/** realpath() that tolerates a not-yet-existing tail by resolving the nearest existing ancestor. */
export async function resolveRealLike(path: string): Promise<string> {
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
