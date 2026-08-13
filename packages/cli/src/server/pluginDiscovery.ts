import { homedir } from "node:os"
import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
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
  resolvePluginSourceScopePaths,
  resolveRegisteredPluginSourceDirs,
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

/** Repository root in source checkouts; containing node_modules root when installed. */
export function resolveBoringUiCliPackageAuthorityRoot(): string {
  return resolve(resolveBoringUiCliPackageRoot(), "..", "..")
}

export interface ResolveCliBoringPluginDirsOptions {
  /** Existing tests/callers use this as the global extensions root. */
  globalRoot?: string
  /** Optional global ~/.pi/agent-style base root for Pi package sources. */
  globalAgentRoot?: string
  frontTargetResolver?: BoringPluginFrontTargetResolver
  /**
   * Include CLI-bundled default plugin packages (e.g.
   * `@hachej/boring-ask-user`) discovered from the CLI's own
   * `node_modules`. Defaults to `true` — the CLI ships with these
   * packages as part of its default install and they should be
   * registered for every workspace. Tests that need to assert the
   * exact set of *user* plugin sources can pass `false` to opt out.
   */
  includeDefaultPackages?: boolean
  /** Include the local-only automation executor package in folder mode. */
  includeFolderModeAutomation?: boolean
  /** Pre-resolved defaults let boot compose one diagnostic-bearing resolution pass. */
  defaultPackagePaths?: readonly string[]
}

export interface CliDefaultPluginPackageDiagnostic {
  source: "default-plugin-package-resolution"
  pluginId: string
  message: string
}

export interface CliDefaultPluginPackageResolution {
  paths: string[]
  diagnostics: CliDefaultPluginPackageDiagnostic[]
}

export function getGlobalPiExtensionsRoot(options: ResolveCliBoringPluginDirsOptions = {}): string {
  return resolve(options.globalRoot ?? join(homedir(), ".pi", "agent", "extensions"))
}

function getGlobalPiAgentRoot(options: ResolveCliBoringPluginDirsOptions = {}): string {
  return resolve(options.globalAgentRoot ?? dirname(getGlobalPiExtensionsRoot(options)))
}

/**
 * CLI-bundled internal plugins. The explicit server-side list — the front
 * side mirrors it with static imports in src/front/App.tsx. Keep the two
 * in sync when adding a default plugin.
 */
const CLI_DEFAULT_PLUGIN_PACKAGES = ["@hachej/boring-ask-user", "@hachej/boring-diagram", "@hachej/boring-tasks"]
const CLI_FOLDER_MODE_PLUGIN_PACKAGES = [...CLI_DEFAULT_PLUGIN_PACKAGES, "@hachej/boring-automation"]

// Resolve the CLI's bundled default plugin packages from the CLI's own
// node_modules. Automation execution is folder-mode-only until workspaces mode
// has an equivalent request-scoped trusted actor composition.
export function resolveCliDefaultPluginPackageResolution(
  options: { includeFolderModeAutomation?: boolean; defaultPluginPackages?: readonly string[] } = {},
): CliDefaultPluginPackageResolution {
  const packages = options.defaultPluginPackages
    ?? (options.includeFolderModeAutomation ? CLI_FOLDER_MODE_PLUGIN_PACKAGES : CLI_DEFAULT_PLUGIN_PACKAGES)
  const paths: string[] = []
  const diagnostics: CliDefaultPluginPackageDiagnostic[] = []
  const anchorDir = resolveBoringUiCliPackageRoot()
  for (const pluginId of packages) {
    try {
      // Keep the package-manager link spelling for diagnostics and Pi's logical
      // inventory. Containment still validates the canonical target before any
      // content is read.
      const linkedPackageRoot = isAbsolute(pluginId) ? undefined : join(anchorDir, "node_modules", pluginId)
      if (linkedPackageRoot && existsSync(join(linkedPackageRoot, "package.json"))) {
        paths.push(linkedPackageRoot)
        continue
      }
      paths.push(...resolveDefaultWorkspacePluginPackagePaths({
        anchorDir,
        defaultPluginPackages: [pluginId],
      }))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      diagnostics.push({
        source: "default-plugin-package-resolution",
        pluginId,
        message: `Default plugin ${pluginId} could not be resolved and will be unavailable: ${reason} Install or repair ${pluginId} in the boring-ui CLI package, then restart the CLI. Other default plugins remain enabled.`,
      })
    }
  }
  return { paths, diagnostics }
}

export function resolveCliDefaultPluginPackagePaths(options: { includeFolderModeAutomation?: boolean } = {}): string[] {
  const resolution = resolveCliDefaultPluginPackageResolution(options)
  if (resolution.diagnostics.length > 0) {
    console.warn(JSON.stringify({
      event: "boring_ui_default_plugin_resolution_warning",
      diagnostics: resolution.diagnostics,
    }))
  }
  return resolution.paths
}

export function resolveCliBoringPluginDirs(
  workspaceRoot: string,
  options: ResolveCliBoringPluginDirsOptions = {},
): BoringPluginSourceInput[] {
  const resolvedWorkspaceRoot = resolve(workspaceRoot)
  const globalAgentRoot = getGlobalPiAgentRoot(options)
  const globalScope = resolvePluginSourceScopePaths("global", { globalRoot: globalAgentRoot })
  const localScope = resolvePluginSourceScopePaths("local", { workspaceRoot: resolvedWorkspaceRoot })
  // Resolved WITHOUT validation: registered sources are passed to the
  // scanner as-is (flagged `registered`) so a broken one — deleted dir,
  // stripped package.json — produces a visible preflight error instead
  // of silently dropping the plugin.
  const packageSources = [
    ...resolveRegisteredPluginSourceDirs(globalScope).map((dir) => ({ ...dir, scope: "global" as const })),
    ...resolveRegisteredPluginSourceDirs(localScope).map((dir) => ({ ...dir, scope: "local" as const })),
  ]
  const includeDefaultPackages = options.includeDefaultPackages ?? true
  const roots: BoringPluginSourceInput[] = [
    ...(process.env.BORING_AGENT_FLEET === "1"
      ? [{ rootDir: resolve(process.cwd(), ".agents", "personas"), kind: "internal" as const }]
      : []),
    ...(includeDefaultPackages
      ? (options.defaultPackagePaths
          ?? resolveCliDefaultPluginPackagePaths({ includeFolderModeAutomation: options.includeFolderModeAutomation }))
        .map((rootDir): BoringPluginSourceInput => ({ rootDir, kind: "internal" }))
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
      registered: true,
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
  })
}
