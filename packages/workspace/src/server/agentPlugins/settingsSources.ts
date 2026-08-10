import { readFileSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import type { BoringPluginSource } from "./types"

const REMOTE_PI_PACKAGE_SOURCE_PREFIXES = ["npm:", "git:", "github:", "http:", "https:", "ssh:"]

export function uniqueBoringPluginSources(sources: BoringPluginSource[]): BoringPluginSource[] {
  const byRoot = new Map<string, BoringPluginSource>()
  for (const source of sources) {
    const existing = byRoot.get(source.rootDir)
    if (!existing || (!existing.workspaceId && source.workspaceId)) byRoot.set(source.rootDir, source)
  }
  return [...byRoot.values()]
}

function piPackageSourceValue(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const source = (entry as { source?: unknown }).source
    return typeof source === "string" ? source : undefined
  }
  return undefined
}

function resolveLocalPiPackageSource(settingsDir: string, source: string): string | undefined {
  const path = source.startsWith("file:") ? source.slice("file:".length) : source
  if (!path) return undefined
  if (REMOTE_PI_PACKAGE_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix))) return undefined
  if (!isAbsolute(path) && path !== "." && path !== "./" && !path.startsWith("./") && !path.startsWith("../")) return undefined
  return resolve(settingsDir, path)
}

export function readPiSettingsBoringPluginSources(
  settingsPath: string,
  workspaceId?: string,
): BoringPluginSource[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch {
    return []
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const packages = (raw as { packages?: unknown }).packages
  if (!Array.isArray(packages)) return []
  const settingsDir = dirname(settingsPath)
  return uniqueBoringPluginSources(
    packages
      .map(piPackageSourceValue)
      .map((source) => source ? resolveLocalPiPackageSource(settingsDir, source) : undefined)
      .filter((rootDir): rootDir is string => Boolean(rootDir))
      .map((rootDir): BoringPluginSource => ({
        rootDir,
        kind: "external",
        ...(workspaceId ? { workspaceId } : {}),
      })),
  )
}

function isInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child)
  return fromParent === "" || (fromParent !== ".." && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
}

function canonicalPath(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

export function isRemoteMaterializedPiPackageRoot(
  rootDir: string,
  dirs: { readonly npmDir: string; readonly gitDir: string },
): boolean {
  const canonicalRoot = canonicalPath(rootDir)
  return [dirs.npmDir, dirs.gitDir].some((reservedDir) => {
    if (isInside(reservedDir, rootDir)) return true
    const canonicalReservedDir = canonicalPath(reservedDir)
    return Boolean(canonicalRoot && canonicalReservedDir && isInside(canonicalReservedDir, canonicalRoot))
  })
}

/**
 * Local settings sources allowed to contribute `boring.agent` at boot.
 * Remote installs are written back as local-looking `./npm/...` / `./git/...`
 * paths, so containment exclusion is required in addition to prefix checks.
 */
export function readPiSettingsLocalAgentPackageSources(
  settingsPath: string,
  workspaceId: string,
): BoringPluginSource[] {
  const settingsDir = dirname(settingsPath)
  return readPiSettingsBoringPluginSources(settingsPath, workspaceId)
    .filter((source) => !isRemoteMaterializedPiPackageRoot(source.rootDir, {
      npmDir: join(settingsDir, "npm"),
      gitDir: join(settingsDir, "git"),
    }))
    .map((source) => ({ ...source, registered: true }))
}
