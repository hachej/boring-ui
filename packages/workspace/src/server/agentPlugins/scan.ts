import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import type { BoringPackageField, BoringPluginManifest } from "./types"

export interface BoringPluginPreflightIssue {
  pluginDir: string
  code: "MISSING_PACKAGE_JSON" | "INVALID_PACKAGE_JSON" | "INVALID_BORING_FIELD" | "UNSAFE_PLUGIN_PATH"
  message: string
}

export interface BoringPluginPreflightResult {
  ok: boolean
  errors: BoringPluginPreflightIssue[]
}

function safeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\0") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/.test(value) &&
    !value.split(/[\\/]+/).includes("..")
  )
}

function safePluginId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
}

function pluginIdFromPackageJson(pkg: Record<string, unknown>, rootDir: string): string {
  const boring = pkg.boring as { id?: unknown } | undefined
  const explicit = boring?.id
  if (typeof explicit === "string" && explicit.trim() && safePluginId(explicit.trim())) return explicit.trim()
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : undefined
  return (name ?? rootDir.split(/[\\/]/).at(-1) ?? "plugin").replace(/^@/, "").replaceAll("/", "-")
}

function normalizeBoringField(value: unknown): BoringPackageField | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as BoringPackageField
}

export function expandBoringPluginDirs(pluginDirs: string[]): string[] {
  const out = new Set<string>()
  for (const raw of pluginDirs) {
    const dir = resolve(raw)
    if (!existsSync(dir)) continue
    const info = statSync(dir)
    if (!info.isDirectory()) continue
    if (existsSync(join(dir, "package.json"))) out.add(dir)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      const child = join(dir, entry.name)
      if (existsSync(join(child, "package.json"))) out.add(child)
    }
  }
  return [...out].sort()
}

export function preflightBoringPlugins(pluginDirs: string[]): BoringPluginPreflightResult {
  const errors: BoringPluginPreflightIssue[] = []
  for (const rootDir of expandBoringPluginDirs(pluginDirs)) {
    const packageJsonPath = join(rootDir, "package.json")
    if (!existsSync(packageJsonPath)) {
      errors.push({ pluginDir: rootDir, code: "MISSING_PACKAGE_JSON", message: "package.json is missing" })
      continue
    }
    let pkg: Record<string, unknown>
    try {
      pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>
    } catch (error) {
      errors.push({ pluginDir: rootDir, code: "INVALID_PACKAGE_JSON", message: error instanceof Error ? error.message : "invalid JSON" })
      continue
    }
    const boring = normalizeBoringField(pkg.boring)
    if (!boring) continue
    if (boring.id !== undefined) {
      if (typeof boring.id !== "string" || !boring.id.trim() || !safePluginId(boring.id.trim())) {
        errors.push({ pluginDir: rootDir, code: "INVALID_BORING_FIELD", message: "id must start with a letter or number and use only letters, numbers, dot, underscore, colon, or dash" })
      }
    }
    for (const [label, value] of Object.entries({ front: boring.front, server: boring.server })) {
      if (value === undefined || value === false) continue
      if (typeof value !== "string" || !safeRelativePath(value)) {
        errors.push({ pluginDir: rootDir, code: "UNSAFE_PLUGIN_PATH", message: `${label} must be a safe relative path or false` })
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

export function readBoringPlugins(pluginDirs: string[]): BoringPluginManifest[] {
  const plugins: BoringPluginManifest[] = []
  for (const rootDir of expandBoringPluginDirs(pluginDirs)) {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as Record<string, unknown>
    const boring = normalizeBoringField(pkg.boring)
    if (!boring) continue
    const frontPath = typeof boring.front === "string" && safeRelativePath(boring.front)
      ? resolve(rootDir, boring.front)
      : undefined
    const serverPath = boring.server === false
      ? undefined
      : typeof boring.server === "string" && safeRelativePath(boring.server)
        ? resolve(rootDir, boring.server)
        : existsSync(join(rootDir, "server", "index.ts"))
          ? join(rootDir, "server", "index.ts")
          : existsSync(join(rootDir, "server", "index.js"))
            ? join(rootDir, "server", "index.js")
            : undefined
    const version = typeof pkg.version === "string" ? pkg.version : "0.0.0"
    plugins.push({
      id: pluginIdFromPackageJson(pkg, rootDir),
      rootDir,
      version,
      boring,
      ...(frontPath ? { frontPath, frontUrl: `/@fs/${frontPath}` } : {}),
      ...(serverPath ? { serverPath } : {}),
    })
  }
  return plugins
}

export function pluginRootFromExtensionPath(extensionPath: string): string {
  const resolved = resolve(extensionPath)
  const agentDir = dirname(resolved)
  if (basename(agentDir) !== "agent") {
    throw new Error(`boring plugin extension path must follow <pluginRoot>/agent/<entry>: ${extensionPath}`)
  }
  return dirname(agentDir)
}
