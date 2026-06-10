import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
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

// Read boring.defaultPluginPackages from the CLI's own package.json manifest.
// Each entry is a package name (e.g. "@hachej/boring-ask-user") resolved via
// import.meta.resolve so it is found in node_modules both in the published CLI
// and in the monorepo (where pnpm symlinks workspace:* deps into node_modules).
function resolveCliDefaultPluginPackagePaths(): string[] {
  const cliRoot = resolveBoringUiCliPackageRoot()
  let entries: string[]
  try {
    const manifest = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf-8")) as {
      boring?: { defaultPluginPackages?: string[] }
    }
    entries = manifest.boring?.defaultPluginPackages ?? []
  } catch {
    return []
  }
  const resolved: string[] = []
  for (const entry of entries) {
    try {
      // Resolve the package's package.json via Node module resolution so this
      // works from any invocation directory — no hardcoded relative paths.
      // createRequire anchored to this file finds packages in the CLI's own
      // node_modules, both in the published build and in the monorepo.
      const req = createRequire(import.meta.url)
      const pkgJsonPath = req.resolve(`${entry}/package.json`)
      const pkgDir = dirname(pkgJsonPath)
      if (existsSync(join(pkgDir, "package.json"))) resolved.push(pkgDir)
    } catch {
      // package not installed — skip silently
    }
  }
  return resolved
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
