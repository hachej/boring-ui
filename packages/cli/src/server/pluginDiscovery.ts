import { homedir } from "node:os"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  BoringPluginAssetManager,
  type BoringPluginFrontTargetResolver,
  type BoringPluginSourceInput,
} from "@hachej/boring-workspace/server"
import {
  readWorkspacePluginPackagePiSnapshot,
  resolveDefaultWorkspacePluginPackagePaths,
  type WorkspacePluginPackagePiSnapshot,
} from "@hachej/boring-workspace/app/server"
import {
  readPluginSourceRecords,
  resolvePluginSourceScopePaths,
} from "@hachej/boring-ui-plugin-cli"

/**
 * Absolute path to the running CLI package's directory. Used to resolve
 * CLI-default plugin packages (e.g. `@hachej/boring-ask-user`) from the
 * CLI's own `node_modules`, regardless of the current working directory
 * the CLI was invoked from. Re-exported by `./cli.ts` for backward
 * compatibility with existing call sites.
 */
export function resolveBoringUiCliPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // pluginDiscovery.ts is in src/server/, the package root is ../..
  return resolve(here, "..", "..")
}

export interface ResolveCliBoringPluginDirsOptions {
  /** Existing tests/callers use this as the global extensions root. */
  globalRoot?: string
  /** Optional global ~/.pi/agent-style base root for Pi package sources. */
  globalAgentRoot?: string
  frontTargetResolver?: BoringPluginFrontTargetResolver
  includeLegacyFrontUrl?: boolean
  /**
   * Include CLI-bundled default plugin packages (e.g.
   * `@hachej/boring-ask-user`) discovered from the CLI's own
   * `node_modules`. Defaults to `true` — the CLI ships with these
   * packages as part of its default install and they should be
   * registered for every workspace. Tests that need to assert the
   * exact set of *user* plugin sources can pass `false` to opt out.
   */
  includeDefaultPackages?: boolean
}

export function getGlobalPiExtensionsRoot(options: ResolveCliBoringPluginDirsOptions = {}): string {
  return resolve(options.globalRoot ?? join(homedir(), ".pi", "agent", "extensions"))
}

function getGlobalPiAgentRoot(options: ResolveCliBoringPluginDirsOptions = {}): string {
  return resolve(options.globalAgentRoot ?? dirname(getGlobalPiExtensionsRoot(options)))
}

// Resolve CLI-bundled default plugin packages declared in this package's own
// boring.defaultPlugins manifest field. Delegates to the shared workspace
// utility so resolution semantics (anchor, error policy, relative paths) stay
// consistent across the CLI and app hosts.
function resolveCliDefaultPluginPackagePaths(): string[] {
  const cliPackageJsonPath = join(resolveBoringUiCliPackageRoot(), "package.json")
  if (!existsSync(cliPackageJsonPath)) return []
  try {
    return resolveDefaultWorkspacePluginPackagePaths({ appPackageJsonPath: cliPackageJsonPath })
  } catch (error) {
    // Missing dep in the CLI package is a packaging error; swallow here so a
    // bad build doesn't crash every workspace launch — the plugin just won't load.
    console.error("[boring-ui] failed to resolve default plugin packages:", error instanceof Error ? error.message : String(error))
    return []
  }
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
  const includeDefaultPackages = options.includeDefaultPackages ?? true
  const roots: BoringPluginSourceInput[] = [
    ...(includeDefaultPackages
      ? resolveCliDefaultPluginPackagePaths().map((rootDir): BoringPluginSourceInput => ({ rootDir, kind: "internal" }))
      : []),
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
