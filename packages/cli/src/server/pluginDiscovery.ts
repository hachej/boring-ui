import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { BoringPluginAssetManager } from "@hachej/boring-workspace/server"
import {
  readWorkspacePluginPackagePiSnapshot,
  type WorkspacePluginPackagePiSnapshot,
} from "@hachej/boring-workspace/app/server"

export interface ResolveCliBoringPluginDirsOptions {
  globalRoot?: string
}

export function getGlobalPiExtensionsRoot(options: ResolveCliBoringPluginDirsOptions = {}): string {
  return resolve(options.globalRoot ?? join(homedir(), ".pi", "agent", "extensions"))
}

export function resolveCliBoringPluginDirs(
  workspaceRoot: string,
  options: ResolveCliBoringPluginDirsOptions = {},
): string[] {
  const roots = [
    getGlobalPiExtensionsRoot(options),
    resolve(workspaceRoot, ".pi", "extensions"),
  ]
  return [...new Set(roots)]
}

export function readCliPluginPiSnapshot(
  workspaceRoot: string,
  options: ResolveCliBoringPluginDirsOptions = {},
): WorkspacePluginPackagePiSnapshot {
  return readWorkspacePluginPackagePiSnapshot(resolveCliBoringPluginDirs(workspaceRoot, options))
}

export function createCliPluginAssetManager(
  workspaceRoot: string,
  options: ResolveCliBoringPluginDirsOptions = {},
): BoringPluginAssetManager {
  return new BoringPluginAssetManager({
    pluginDirs: resolveCliBoringPluginDirs(workspaceRoot, options),
    errorRoot: resolve(workspaceRoot, ".pi", "extensions"),
  })
}

