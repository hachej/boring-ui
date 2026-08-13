import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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
  let current = here
  while (true) {
    const manifestPath = join(current, "package.json")
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown }
        if (manifest.name === "@hachej/boring-ui-cli") return current
      } catch {}
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`Cannot locate @hachej/boring-ui-cli package root from ${here}`)
}

/** Host-owned anchor for linked packages in both source checkouts and installs. */
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
  /** Pre-resolved, pre-authorized default package roots. */
  defaultPackagePaths?: readonly string[]
  /** Pre-resolved, pre-authorized roots for the asset manager. */
  resolvedPluginDirs?: readonly BoringPluginSourceInput[]
}

export interface CliDefaultPluginPackageDiagnostic {
  source: "default-plugin-package-resolution"
  pluginId: string
  message: string
}

export interface CliDefaultPluginPackageCandidate {
  pluginId: string
  packageRoot: string
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

/**
 * Resolve package names without reading package contents. Callers must run the
 * resulting roots through the Pi authority guard before inspecting manifests.
 */
export function resolveCliDefaultPluginPackageCandidates(
  options: { includeFolderModeAutomation?: boolean; defaultPluginPackages?: readonly string[] } = {},
): { candidates: CliDefaultPluginPackageCandidate[]; diagnostics: CliDefaultPluginPackageDiagnostic[] } {
  const pluginIds = options.defaultPluginPackages
    ?? (options.includeFolderModeAutomation ? CLI_FOLDER_MODE_PLUGIN_PACKAGES : CLI_DEFAULT_PLUGIN_PACKAGES)
  const anchorDir = resolveBoringUiCliPackageRoot()
  const requireFromCli = createRequire(join(anchorDir, "package.json"))
  const candidates: CliDefaultPluginPackageCandidate[] = []
  const diagnostics: CliDefaultPluginPackageDiagnostic[] = []
  for (const pluginId of pluginIds) {
    try {
      const linkedRoot = isAbsolute(pluginId) ? resolve(pluginId) : join(anchorDir, "node_modules", pluginId)
      const packageRoot = existsSync(linkedRoot)
        ? linkedRoot
        : isAbsolute(pluginId)
          ? linkedRoot
          : dirname(requireFromCli.resolve(`${pluginId}/package.json`))
      candidates.push({ pluginId, packageRoot })
    } catch (error) {
      diagnostics.push(defaultPluginDiagnostic(pluginId, error))
    }
  }
  return { candidates, diagnostics }
}

/** Inspect only candidates that the host has already authorized. */
export function inspectAuthorizedCliDefaultPluginPackages(
  candidates: readonly CliDefaultPluginPackageCandidate[],
): CliDefaultPluginPackageResolution {
  const paths: string[] = []
  const diagnostics: CliDefaultPluginPackageDiagnostic[] = []
  for (const { pluginId, packageRoot } of candidates) {
    try {
      const manifestPath = join(packageRoot, "package.json")
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { boring?: { front?: unknown; server?: unknown } }
      for (const [kind, entry] of Object.entries(manifest.boring ?? {})) {
        if ((kind !== "front" && kind !== "server") || typeof entry !== "string") continue
        const entryPath = resolve(packageRoot, entry)
        if (!existsSync(entryPath)) {
          throw new Error(`${kind} entry declared by ${manifestPath} is unavailable at ${entryPath}`)
        }
      }
      paths.push(packageRoot)
    } catch (error) {
      diagnostics.push(defaultPluginDiagnostic(pluginId, error))
    }
  }
  return { paths, diagnostics }
}

function defaultPluginDiagnostic(pluginId: string, error: unknown): CliDefaultPluginPackageDiagnostic {
  const reason = error instanceof Error ? error.message : String(error)
  return {
    source: "default-plugin-package-resolution",
    pluginId,
    message: `Default plugin ${pluginId} could not be loaded and will be unavailable: ${reason}. Install, build, or repair ${pluginId} in the boring-ui CLI package, then restart the CLI. Other default plugins remain enabled.`,
  }
}

/** Legacy synchronous helper for non-boot callers. CLI boot uses the guarded two-phase API above. */
export function resolveCliDefaultPluginPackagePaths(options: { includeFolderModeAutomation?: boolean } = {}): string[] {
  const located = resolveCliDefaultPluginPackageCandidates(options)
  const resolution = inspectAuthorizedCliDefaultPluginPackages(located.candidates)
  const diagnostics = [...located.diagnostics, ...resolution.diagnostics]
  if (diagnostics.length > 0) {
    console.warn(JSON.stringify({ event: "boring_ui_default_plugin_resolution_warning", diagnostics }))
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
    pluginDirs: options.resolvedPluginDirs
      ? [...options.resolvedPluginDirs]
      : resolveCliBoringPluginDirs(workspaceRoot, options),
    errorRoot: resolve(workspaceRoot, ".boring-agent", "plugin-errors"),
    frontTargetResolver: options.frontTargetResolver,
  })
}
