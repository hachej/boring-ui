import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Sidecar file the asset manager writes after each successful plugin
 * load. Surfaces (verify-plugin) read it later to tell whether the
 * server file on disk has drifted from what the running workspace
 * actually loaded — i.e. whether a /reload alone will suffice or the
 * user needs to restart the process to pick up server-side changes.
 *
 * Lives in the plugin's own source dir (next to package.json) so the
 * convention-based verify-plugin CLI ( walks `.pi/extensions/<id>` )
 * finds it without knowing how the manager was configured.
 */
export const PLUGIN_SIGNATURE_CACHE_FILE = ".boring-signature.json"

export interface PluginSignatureCachePayload {
  version: 1
  /**
   * `fileSignature(serverPath)` at load time, or null when the plugin
   * has no server entry.
   */
  serverSignature: string | null
  /** Unix ms when the manager wrote this cache. */
  loadedAt: number
}

/**
 * mtimeMs+size — cheap, mirrors what the asset manager uses to decide
 * whether to fire `requiresRestart` on /reload. Bytes are deliberately
 * NOT hashed (perf bug on 50MB+ bundles, and we only need change
 * detection, not content equality).
 */
export function pluginFileSignature(path: string | undefined): string {
  if (!path || !existsSync(path)) return "missing"
  const stat = statSync(path)
  return `${stat.mtimeMs}:${stat.size}`
}

function cachePath(pluginRootDir: string): string {
  return join(pluginRootDir, PLUGIN_SIGNATURE_CACHE_FILE)
}

export function writePluginSignatureCache(
  pluginRootDir: string,
  payload: Omit<PluginSignatureCachePayload, "version" | "loadedAt"> &
    Partial<Pick<PluginSignatureCachePayload, "loadedAt">>,
): void {
  const full: PluginSignatureCachePayload = {
    version: 1,
    serverSignature: payload.serverSignature,
    loadedAt: payload.loadedAt ?? Date.now(),
  }
  const path = cachePath(pluginRootDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(full, null, 2)}\n`, "utf8")
}

export function readPluginSignatureCache(pluginRootDir: string): PluginSignatureCachePayload | null {
  const path = cachePath(pluginRootDir)
  if (!existsSync(path)) return null
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const obj = parsed as Record<string, unknown>
  if (obj.version !== 1) return null
  const sig = obj.serverSignature
  if (sig !== null && typeof sig !== "string") return null
  const loadedAt = typeof obj.loadedAt === "number" ? obj.loadedAt : 0
  return { version: 1, serverSignature: sig, loadedAt }
}

export function clearPluginSignatureCache(pluginRootDir: string): void {
  const path = cachePath(pluginRootDir)
  if (existsSync(path)) rmSync(path, { force: true })
}
