import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  BoringPluginAssetManager,
  type BoringPluginFrontTargetResolver,
  type BoringPluginSourceInput,
} from "@hachej/boring-workspace/server"
import {
  readWorkspacePluginPackagePiSnapshot,
  type WorkspacePluginPackagePiSnapshot,
} from "@hachej/boring-workspace/app/server"
import {
  readPluginSourceRecords,
  resolvePluginSourceScopePaths,
} from "@hachej/boring-ui-plugin-cli"

export interface ResolveCliBoringPluginDirsOptions {
  /** Existing tests/callers use this as the global extensions root. */
  globalRoot?: string
  /** Optional global ~/.pi/agent-style base root for Pi package sources. */
  globalAgentRoot?: string
  frontTargetResolver?: BoringPluginFrontTargetResolver
  includeLegacyFrontUrl?: boolean
}

export function getGlobalPiExtensionsRoot(options: ResolveCliBoringPluginDirsOptions = {}): string {
  return resolve(options.globalRoot ?? join(homedir(), ".pi", "agent", "extensions"))
}

function getGlobalPiAgentRoot(options: ResolveCliBoringPluginDirsOptions = {}): string {
  return resolve(options.globalAgentRoot ?? dirname(getGlobalPiExtensionsRoot(options)))
}

export function resolveCliBoringPluginDirs(
  workspaceRoot: string,
  options: ResolveCliBoringPluginDirsOptions = {},
): BoringPluginSourceInput[] {
  const resolvedWorkspaceRoot = resolve(workspaceRoot)
  const globalAgentRoot = getGlobalPiAgentRoot(options)
  const globalScope = resolvePluginSourceScopePaths("global", { globalRoot: globalAgentRoot })
  const localScope = resolvePluginSourceScopePaths("local", { workspaceRoot: resolvedWorkspaceRoot })
  const packageSources = [
    ...readPluginSourceRecords(globalScope),
    ...readPluginSourceRecords(localScope),
  ]
  const roots: BoringPluginSourceInput[] = [
    { rootDir: getGlobalPiExtensionsRoot(options), kind: "external" },
    { rootDir: globalScope.npmDir, kind: "external" },
    { rootDir: globalScope.gitDir, kind: "external" },
    { rootDir: localScope.extensionsDir, kind: "external", workspaceId: resolvedWorkspaceRoot },
    { rootDir: localScope.npmDir, kind: "external", workspaceId: resolvedWorkspaceRoot },
    { rootDir: localScope.gitDir, kind: "external", workspaceId: resolvedWorkspaceRoot },
    ...packageSources.map((record): BoringPluginSourceInput => ({
      rootDir: record.rootDir,
      kind: "external",
      ...(record.scope === "local" ? { workspaceId: resolvedWorkspaceRoot } : {}),
    })),
  ]
  const seen = new Set<string>()
  return roots.filter((root) => {
    const key = resolve(typeof root === "string" ? root : root.rootDir)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
    errorRoot: resolve(workspaceRoot, ".boring-agent", "plugin-errors"),
    frontTargetResolver: options.frontTargetResolver,
    includeLegacyFrontUrl: options.includeLegacyFrontUrl,
  })
}
