import { resolve } from "node:path"
import {
  isSafePluginRelativePath,
  type BoringPackagePiSource,
} from "../../shared/plugins/manifest"
import type { WorkspacePiPackageSource } from "../plugins/piPackages"
import type { BoringServerPluginManifest } from "./types"

const REMOTE_PI_PACKAGE_PREFIXES = ["npm:", "git:", "github:", "http:", "https:", "ssh:"]

export function isRemotePiPackageSource(source: string): boolean {
  return REMOTE_PI_PACKAGE_PREFIXES.some((prefix) => source.startsWith(prefix))
}

function packageLocalPathFromSource(source: string): string | null {
  if (isRemotePiPackageSource(source)) return null
  return source.startsWith("file:") ? source.slice("file:".length) : source
}

export function isSafePiPackageSource(source: string): boolean {
  const localPath = packageLocalPathFromSource(source)
  if (localPath == null) return source.length > 0
  if (localPath === "." || localPath === "./") return true
  const normalized = localPath.startsWith("./") ? localPath.slice(2) : localPath
  return isSafePluginRelativePath(normalized)
}

function normalizeLocalPiPackageSource(pluginRoot: string, source: string): string {
  const localPath = packageLocalPathFromSource(source)
  if (localPath == null) return source
  if (localPath === "." || localPath === "./") return resolve(pluginRoot)
  const normalized = localPath.startsWith("./") ? localPath.slice(2) : localPath
  if (!isSafePluginRelativePath(normalized)) {
    throw new Error(`unsafe Pi package source: ${source}`)
  }
  return resolve(pluginRoot, normalized)
}

export function normalizeBoringPluginPiPackageSource(
  pluginRoot: string,
  source: BoringPackagePiSource,
): WorkspacePiPackageSource {
  if (typeof source === "string") return normalizeLocalPiPackageSource(pluginRoot, source)

  return {
    source: normalizeLocalPiPackageSource(pluginRoot, source.source),
    ...(source.extensions ? { extensions: source.extensions } : {}),
    ...(source.skills ? { skills: source.skills } : {}),
    ...(source.prompts ? { prompts: source.prompts } : {}),
    ...(source.themes ? { themes: source.themes } : {}),
  }
}

export function normalizeBoringPluginPiPackages(
  plugins: BoringServerPluginManifest[],
): WorkspacePiPackageSource[] {
  return plugins.flatMap((plugin) =>
    (plugin.pi?.packages ?? []).map((source) =>
      normalizeBoringPluginPiPackageSource(plugin.rootDir, source),
    ),
  )
}
