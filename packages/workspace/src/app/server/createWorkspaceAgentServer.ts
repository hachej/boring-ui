/**
 * Standalone workspace + agent Fastify composition.
 *
 * This entry intentionally imports @hachej/boring-agent/server. Browser-facing
 * workspace entrypoints must not.
 */
import {
  autoDetectMode,
  createAgentApp,
  provisionRuntimeWorkspace,
  resolveMode,
  type CreateAgentAppOptions,
  type PiExtensionFactory,
} from "@hachej/boring-agent/server"
import type { FastifyInstance } from "fastify"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { buildBoringSystemPrompt } from "../../server/boringSystemPrompt"
import { BoringPluginAssetManager } from "../../server/agentPlugins/manager"
import { boringPluginRoutes } from "../../server/agentPlugins/routes"
import { aggregatePluginPrompts } from "../../server/agentPlugins/aggregatePluginPrompts"
import { normalizeBoringPluginPiPackages } from "../../server/agentPlugins/piPackages"
import {
  resolveOnePluginEntry,
  type DirPluginEntry,
  type ModulePluginEntry,
} from "./pluginEntryResolver"
import { rebuildServerPlugins, type PluginRebuildResult } from "./rebuildServerPlugins"
import { pluginRootFromExtensionPath, preflightBoringPlugins, readBoringPlugins } from "../../server/agentPlugins/scan"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "../../server/ui-control/tools/uiTools"
import { uiRoutes } from "../../server/ui-control/http/uiRoutes"
import {
  ServerPluginError,
  bootstrapServer,
  defineServerPlugin,
  validateServerPlugin,
  compactPiPackages,
  type ServerBootstrapOptions,
  type WorkspacePiPackageSource,
  type WorkspaceServerPlugin,
  type WorkspaceExtensionFactory,
  type WorkspaceProvisioningContribution,
  type WorkspaceRouteContribution,
} from "../../server/plugins/bootstrapServer"

type HostExtensionFactory = PiExtensionFactory

export interface WorkspaceAgentPiOptions {
  noContextFiles?: boolean
  noSkills?: boolean
  additionalSkillPaths?: string[]
  packages?: WorkspacePiPackageSource[]
  extensionPaths?: string[]
  extensionFactories?: HostExtensionFactory[]
}

type WorkspaceAgentCreateOptions = Omit<
  CreateAgentAppOptions,
  "pi"
> & {
  pi?: WorkspaceAgentPiOptions
}

export interface WorkspaceAgentServerPluginContext {
  workspaceRoot: string
  bridge: ReturnType<typeof createInMemoryBridge>
}

export type WorkspaceAgentServerPluginFactory = (context: WorkspaceAgentServerPluginContext) => WorkspaceServerPlugin

/**
 * Single install entry type. Accepts:
 *  - `WorkspaceServerPlugin` — pre-built plugin object.
 *  - `WorkspaceAgentServerPluginFactory` — callable that receives the
 *     workspace context (workspaceRoot + bridge) and returns a
 *     `WorkspaceServerPlugin`.
 *  - `{ module, options? }` — workspace dep imported by the host. Calls
 *     the module's default export with `(options, ctx)`.
 *  - `{ dir, options?, hotReload? }` — directory-source plugin resolved
 *     via package.json#boring.server (Pi parity: manifest first,
 *     convention fallback, declared-but-missing throws). hotReload uses
 *     jiti so /reload picks up source edits.
 */
export type WorkspacePluginEntry =
  | WorkspaceServerPlugin
  | WorkspaceAgentServerPluginFactory
  | DirPluginEntry
  | ModulePluginEntry

export interface CreateWorkspaceAgentServerOptions
  extends WorkspaceAgentCreateOptions,
    Pick<ServerBootstrapOptions, "defaults" | "excludeDefaults"> {
  /**
   * Plugins to install. Accepts either pre-built `WorkspaceServerPlugin` objects
   * or factory functions that receive the workspace context — same array.
   */
  plugins?: WorkspacePluginEntry[]
  provisionWorkspace?: boolean
  workspaceProvisioning?: { force?: boolean }
  validateUiPaths?: boolean
  /**
   * Whether /reload refreshes Boring package plugin UI/server assets.
   * Initial plugin discovery still runs so statically configured plugins load.
   * Defaults to true.
   */
  boringPluginReload?: boolean
  /**
   * Whether package.json#pi contributions from Boring package plugins are
   * forwarded to Pi and refreshed by /reload. Host-supplied opts.pi values are
   * unaffected. Defaults to true.
   */
  piPluginReload?: boolean
  /**
   * App-default plugin packages (by npm name OR absolute filesystem path).
   * Each entry is resolved at boot, registered as a Pi package (so Pi sees
   * its skills/extensions/prompts), and discovered by the
   * `BoringPluginAssetManager` (so the workspace sees its
   * package.json#boring contributions). One declaration, both sides.
   *
   * Equivalent to the user manually placing each package under
   * `.pi/extensions/<name>/` and `pi install`-ing it — done programmatically
   * at app boot. Combined with `.pi/extensions/<name>/` (user-added) and
   * any `pi install npm:<pkg>` packages, all three flow through the same
   * load process.
   */
  defaultPluginPackages?: string[]
  /**
   * Absolute path to the app's `package.json`. When passed, the workspace
   * reads `package.json#boring.defaultPluginPackages: string[]` from it
   * and merges those entries with anything passed in
   * `defaultPluginPackages`. Relative entries in package.json resolve
   * against the package.json's own directory.
   *
   * Example app `package.json`:
   *
   *     {
   *       "name": "my-app",
   *       "boring": {
   *         "defaultPluginPackages": [
   *           "@hachej/boring-ask-user",
   *           "./src/plugins/playgroundDataCatalog"
   *         ]
   *       }
   *     }
   *
   * Lets apps declare their plugin set in the canonical app manifest
   * instead of inside the server boot path.
   */
  appPackageJsonPath?: string
}

export {
  ServerPluginError,
  defineServerPlugin,
  validateServerPlugin,
}
export type {
  WorkspacePiPackageSource,
  WorkspaceServerPlugin,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function resolveWorkspacePackageRoot(): string {
  const candidates = [
    join(__dirname, ".."),
    join(__dirname, "../../.."),
  ]
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
      if (pkg.name === "@hachej/boring-workspace") return candidate
    } catch {
      // try next layout
    }
  }
  return join(__dirname, "../../..")
}

function nodePackageContribution(
  contributionId: string,
  nodePackageId: string,
  packageName: string,
  packageRoot: string | null,
): WorkspaceProvisioningContribution | null {
  if (!packageRoot || !existsSync(join(packageRoot, "package.json"))) return null
  return {
    id: contributionId,
    provisioning: {
      nodePackages: [{ id: nodePackageId, packageName, packageRoot }],
    },
  }
}

function createWorkspacePackageProvisioningContribution(): WorkspaceProvisioningContribution | null {
  return nodePackageContribution(
    "boring-workspace-package",
    "boring-workspace",
    "@hachej/boring-workspace",
    resolveWorkspacePackageRoot(),
  )
}

function resolveBoringPiPackageRoot(): string | null {
  const workspacePackageRoot = resolveWorkspacePackageRoot()
  const candidates = [
    join(workspacePackageRoot, "..", "pi"),
    join(workspacePackageRoot, "node_modules", "@hachej", "boring-pi"),
  ]
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
      if (pkg.name === "@hachej/boring-pi") return candidate
    } catch {
      // try next layout
    }
  }
  try {
    return dirname(require.resolve("@hachej/boring-pi/package.json"))
  } catch {
    return null
  }
}

function createBoringPiPackageProvisioningContribution(): WorkspaceProvisioningContribution | null {
  return nodePackageContribution("boring-pi-package", "boring-pi", "@hachej/boring-pi", resolveBoringPiPackageRoot())
}

function createBoringPiPackageSource(workspaceRoot: string): WorkspacePiPackageSource | undefined {
  const workspacePackageRoot = join(workspaceRoot, "node_modules", "@hachej", "boring-pi")
  const source = existsSync(join(workspacePackageRoot, "package.json"))
    ? workspacePackageRoot
    : resolveBoringPiPackageRoot()
  if (!source || !existsSync(join(source, "package.json"))) return undefined
  return { source, skills: ["skills/boring-plugin-authoring"] }
}

export interface WorkspaceAgentServerPluginCollection {
  provisioningContributions: WorkspaceProvisioningContribution[]
  routeContributions: WorkspaceRouteContribution[]
  preservedUiStateKeys: string[]
  agentOptions: Pick<
    WorkspaceAgentCreateOptions,
    "extraTools" | "systemPromptAppend" | "pi"
  >
}

export interface CollectWorkspaceAgentServerPluginsOptions
  extends Pick<ServerBootstrapOptions, "plugins" | "defaults" | "excludeDefaults"> {
  workspaceRoot?: string
  systemPromptAppend?: string
  pi?: WorkspaceAgentPiOptions
}

export function buildWorkspaceContextPrompt(): string {
  return [
    '## Workspace',
    '- Root: `$BORING_AGENT_WORKSPACE_ROOT` (exported into every bash invocation)',
    '- Skills: `$BORING_AGENT_WORKSPACE_ROOT/.agents/skills/`',
    '- CLI shims (`bm`, `python`, `pip`): `$BORING_AGENT_WORKSPACE_ROOT/.boring-agent/bin/` — already on PATH, call directly',
  ].join('\n')
}

export function collectWorkspaceAgentServerPlugins(
  opts: CollectWorkspaceAgentServerPluginsOptions = {},
): WorkspaceAgentServerPluginCollection {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const result = bootstrapServer({
    defaults: opts.defaults,
    plugins: opts.plugins,
    excludeDefaults: opts.excludeDefaults,
  })
  const workspaceSkillsDir = join(workspaceRoot, ".agents", "skills")
  const callerAdditional = opts.pi?.additionalSkillPaths ?? []
  const callerPiPackages = opts.pi?.packages ?? []
  const callerExtensionPaths = opts.pi?.extensionPaths ?? []
  const callerExtensionFactories = opts.pi?.extensionFactories ?? []

  return {
    provisioningContributions: [
      createWorkspacePackageProvisioningContribution(),
      createBoringPiPackageProvisioningContribution(),
      ...result.provisioningContributions,
    ].filter((entry): entry is WorkspaceProvisioningContribution => Boolean(entry)),
    routeContributions: result.routeContributions,
    preservedUiStateKeys: result.preservedUiStateKeys,
    agentOptions: {
      extraTools: result.agentTools,
      systemPromptAppend: [opts.systemPromptAppend, result.systemPromptAppend]
        .filter(Boolean)
        .join("\n\n") || undefined,
      pi: {
        ...opts.pi,
        additionalSkillPaths: [workspaceSkillsDir, ...callerAdditional],
        packages: compactPiPackages([...result.piPackages, ...callerPiPackages]),
        extensionPaths: [...result.extensionPaths, ...callerExtensionPaths],
        extensionFactories: [...result.extensionFactories, ...callerExtensionFactories],
      },
    },
  }
}

export async function provisionWorkspaceAgentServer(opts: {
  workspaceRoot: string
  provisioningContributions?: WorkspaceProvisioningContribution[]
  force?: boolean
}) {
  if (!opts.provisioningContributions?.length) return

  await provisionRuntimeWorkspace({
    workspaceRoot: opts.workspaceRoot,
    contributions: opts.provisioningContributions,
    force: opts.force,
  })
}

function collectBoringPluginDirs(workspaceRoot: string, pluginCollection: WorkspaceAgentServerPluginCollection): string[] {
  const extensionPaths = pluginCollection.agentOptions.pi?.extensionPaths ?? []
  const pluginRoots = extensionPaths.flatMap((path) => {
    try {
      return [pluginRootFromExtensionPath(path)]
    } catch {
      return []
    }
  })
  return [
    join(workspaceRoot, ".pi", "extensions"),
    ...pluginRoots,
  ]
}

/**
 * Read `package.json#boring.defaultPluginPackages: string[]` from the
 * app's package.json, if `appPackageJsonPath` was provided. Relative
 * entries are resolved against the package.json's own directory so apps
 * can write paths like "./src/plugins/foo" without computing absolutes
 * in their boot code. Returns the resolved absolute paths (or npm names
 * unchanged, for later resolution by resolveDefaultPluginPackagePaths).
 */
function readAppManifestDefaultPlugins(appPackageJsonPath: string | undefined): string[] {
  if (!appPackageJsonPath || !existsSync(appPackageJsonPath)) return []
  let pkg: { boring?: { defaultPluginPackages?: unknown } }
  try {
    pkg = JSON.parse(readFileSync(appPackageJsonPath, "utf8"))
  } catch {
    return []
  }
  const entries = pkg.boring?.defaultPluginPackages
  if (!Array.isArray(entries)) return []
  const pkgDir = dirname(appPackageJsonPath)
  return entries
    .filter((e): e is string => typeof e === "string")
    .map((entry) => {
      // Relative paths resolve from the package.json's directory; npm names
      // and absolute paths pass through unchanged.
      if (entry.startsWith("./") || entry.startsWith("../")) {
        return join(pkgDir, entry)
      }
      return entry
    })
}

/**
 * Resolve each entry in `defaultPluginPackages` to an absolute package
 * directory. Accepts either an npm-style name (resolved via
 * `require.resolve('<name>/package.json')`) or an absolute filesystem
 * path. THROWS on unresolved entries — a typo or missing dependency
 * is an app boot-time error, not something to silently drop.
 */
function resolveDefaultPluginPackagePaths(
  workspaceRoot: string,
  defaultPluginPackages: string[],
): string[] {
  if (defaultPluginPackages.length === 0) return []
  const require = createRequire(join(workspaceRoot, "package.json"))
  const requireFromHere = createRequire(import.meta.url)
  const resolved: string[] = []
  for (const entry of defaultPluginPackages) {
    if (entry.startsWith("/")) {
      if (!existsSync(join(entry, "package.json"))) {
        throw new Error(
          `defaultPluginPackages: "${entry}" has no package.json — provide a path to a directory containing package.json with a "boring" field.`,
        )
      }
      resolved.push(entry)
      continue
    }
    let resolvedPath: string | null = null
    try {
      resolvedPath = dirname(require.resolve(`${entry}/package.json`))
    } catch {
      try {
        // Fallback: resolve from this module's location (covers hosts
        // whose workspace doesn't have its own package.json layout).
        resolvedPath = dirname(requireFromHere.resolve(`${entry}/package.json`))
      } catch {
        throw new Error(
          `defaultPluginPackages: cannot resolve "${entry}" — install it as a dep of the app (or workspace root) so require.resolve can find its package.json. Pass an absolute path instead if the package lives outside node_modules.`,
        )
      }
    }
    resolved.push(resolvedPath)
  }
  return resolved
}

interface PackageJsonPiSnapshot {
  additionalSkillPaths: string[]
  packages: WorkspacePiPackageSource[]
  extensionPaths: string[]
}

function emptyPackageJsonPiSnapshot(): PackageJsonPiSnapshot {
  return { additionalSkillPaths: [], packages: [], extensionPaths: [] }
}

function readPackageJsonPiSnapshot(pluginDirs: string[]): PackageJsonPiSnapshot {
  if (!preflightBoringPlugins(pluginDirs).ok) return emptyPackageJsonPiSnapshot()
  try {
    const plugins = readBoringPlugins(pluginDirs)
    return {
      additionalSkillPaths: plugins.flatMap((plugin) => plugin.skillPaths ?? []),
      packages: compactPiPackages(normalizeBoringPluginPiPackages(plugins)),
      extensionPaths: plugins.flatMap((plugin) => plugin.extensionPaths ?? []),
    }
  } catch {
    return emptyPackageJsonPiSnapshot()
  }
}

export async function createWorkspaceAgentServer(
  opts: CreateWorkspaceAgentServerOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const bridge = createInMemoryBridge()
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const workspaceFsCapability = opts.runtimeModeAdapter
    ? opts.runtimeModeAdapter.workspaceFsCapability ?? "best-effort"
    : resolveMode(resolvedMode).workspaceFsCapability ?? "best-effort"
  const validateUiPaths = opts.validateUiPaths ?? workspaceFsCapability === "strong"
  const uiTools = createWorkspaceUiTools(bridge, {
    workspaceRoot: validateUiPaths ? workspaceRoot : undefined,
  })
  const ctx: WorkspaceAgentServerPluginContext = { workspaceRoot, bridge }

  // Resolve app-default plugin packages from two sources, merged:
  //   1. `opts.defaultPluginPackages` (explicit, set in code)
  //   2. `package.json#boring.defaultPluginPackages` (declarative, the
  //      canonical app manifest location — preferred for new apps).
  // Each entry is resolved to an absolute package dir and flows into
  // BOTH the server-side install array (as DirPluginEntries) AND the
  // boring asset manager scan. ONE declaration, all sides.
  const manifestPluginPackages = readAppManifestDefaultPlugins(opts.appPackageJsonPath)
  const defaultPluginPackagePaths = resolveDefaultPluginPackagePaths(workspaceRoot, [
    ...manifestPluginPackages,
    ...(opts.defaultPluginPackages ?? []),
  ])
  const defaultPluginDirEntries: WorkspacePluginEntry[] = defaultPluginPackagePaths.map(
    (dir) => ({ dir, hotReload: opts.boringPluginReload ?? true }),
  )

  const allPluginEntries: WorkspacePluginEntry[] = [
    ...defaultPluginDirEntries,
    ...(opts.plugins ?? []),
  ]
  // Inline dispatch: each entry shape (object / factory / { dir } /
   // { module }) is resolved by `resolveOnePluginEntry`. Same logic
   // serves rebuilds on /reload (rebuildServerPlugins.ts).
  const resolvedPlugins = await Promise.all(
    allPluginEntries.map((entry) => resolveOnePluginEntry<WorkspaceServerPlugin>(entry, ctx)),
  )
  const pluginCollection = collectWorkspaceAgentServerPlugins({
    ...opts,
    plugins: resolvedPlugins,
  })
  const boringPluginReload = opts.boringPluginReload ?? true
  const piPluginReload = opts.piPluginReload ?? true

  // Note: we don't need to explicitly register defaultPluginPackagePaths
  // as Pi packages here. They land in `boringPluginDirs` below, and the
  // dynamic Pi resources path (`readPackageJsonPiSnapshot`) reads each
  // package's `pi.*` fields from there and forwards them to Pi on every
  // session creation + /reload. ONE pi-discovery path, no duplication.

  if (opts.provisionWorkspace !== false) {
    await provisionWorkspaceAgentServer({
      workspaceRoot,
      provisioningContributions: pluginCollection.provisioningContributions,
      force: opts.workspaceProvisioning?.force,
    })
  }

  // Static Pi resources known at boot: workspace skill dir,
  // factory-supplied values, and the bundled @hachej/boring-pi skill
  // package. defaultPluginPackages are NOT included here — they flow
  // to Pi via the dynamic resources path (boringPluginDirs scan +
  // readPackageJsonPiSnapshot) which already reads each package's
  // pi.* fields on every session/reload.
  const workspacePackagePiPackage = createBoringPiPackageSource(workspaceRoot)
  const staticPiSkillPaths = pluginCollection.agentOptions.pi?.additionalSkillPaths ?? []
  const staticPiPackages = compactPiPackages([
    workspacePackagePiPackage,
    ...(pluginCollection.agentOptions.pi?.packages ?? []),
  ])
  const staticPiExtensionPaths = pluginCollection.agentOptions.pi?.extensionPaths ?? []

  // Boring plugin discovery: scan .pi/extensions/, any plugin-contributed
  // extension parent paths, and the app-default plugin package dirs.
  // The asset manager treats each as a plugin source; SSE + jiti reload
  // works the same for all three categories.
  const boringPluginDirs = [
    ...collectBoringPluginDirs(workspaceRoot, pluginCollection),
    ...defaultPluginPackagePaths,
  ]

  // Dynamic Pi resources discovered from package.json#pi at /reload time.
  // Pi calls `getDynamicResources()` on every reloadSession() and merges the
  // result with the static fields above, so the workspace never mutates
  // arrays the harness already captured.
  const getDynamicPiResources = piPluginReload
    ? () => readPackageJsonPiSnapshot(boringPluginDirs)
    : undefined

  const boringAssetManager = new BoringPluginAssetManager({
    pluginDirs: boringPluginDirs,
    errorRoot: join(workspaceRoot, ".pi", "extensions"),
  })

  // Phase 5: rebuild closure created BEFORE createAgentApp so beforeReload
  // can call it. `liveLoadedIds` is mutable across reloads (Phase 4 review
  // bug fix). Each rebuild updates it from its result.plugins.
  let liveLoadedIds: string[] = resolvedPlugins.map((p) => p.id)
  const rebuildPlugins = async (): Promise<PluginRebuildResult> => {
    const result = await rebuildServerPlugins({
      entries: allPluginEntries,
      ctx,
      currentPluginIds: liveLoadedIds,
    })
    liveLoadedIds = result.plugins.map((p) => p.id)
    return result
  }

  const app = await createAgentApp({
    ...opts,
    mode: resolvedMode,
    workspaceRoot,
    extraTools: [
      ...(opts.extraTools ?? []),
      ...uiTools,
      ...(pluginCollection.agentOptions.extraTools ?? []),
    ],
    systemPromptAppend: [
      workspaceFsCapability === "strong" ? buildWorkspaceContextPrompt() : undefined,
      buildBoringSystemPrompt(),
      pluginCollection.agentOptions.systemPromptAppend,
    ].filter(Boolean).join("\n\n") || undefined,
    beforeReload: async () => {
      if (boringPluginReload) {
        const result = await boringAssetManager.load()
        if (result.errors.length > 0) {
          const details = result.errors
            .map((error) => `${error.id}#${error.revision}: ${error.message}`)
            .join("\n\n")
          throw new Error(`Boring plugin reload failed:\n\n${details}`)
        }
      }
      // Phase 5: re-resolve directory-source plugin entries via jiti so
      // their fresh `WorkspaceServerPlugin` is in the registry the next
      // turn's `systemPromptDynamic` / `getDynamicResources` reads from.
      // Diagnostics from failed entries are surfaced as a thrown error
      // matching boringAssetManager's posture — Pi parity: errors are
      // reload diagnostics, but the workspace currently throws to keep
      // the existing /reload error format. Phase 6+ will widen the
      // /reload response shape to carry diagnostics non-fatally.
      const rebuild = await rebuildPlugins()
      if (rebuild.diagnostics.length > 0) {
        const details = rebuild.diagnostics.map((d) => `${d.source}: ${d.message}`).join("\n\n")
        throw new Error(`Boring plugin re-resolve failed:\n\n${details}`)
      }
      await opts.beforeReload?.()
    },
    pi: {
      ...pluginCollection.agentOptions.pi,
      additionalSkillPaths: staticPiSkillPaths,
      packages: staticPiPackages,
      extensionPaths: staticPiExtensionPaths,
      extensionFactories: pluginCollection.agentOptions.pi?.extensionFactories,
      getDynamicResources: getDynamicPiResources,
    },
    systemPromptDynamic: piPluginReload
      ? () => aggregatePluginPrompts(boringAssetManager)
      : undefined,
  })
  await boringAssetManager.load()
  await app.register(uiRoutes, { bridge, preserveStateKeys: pluginCollection.preservedUiStateKeys })
  await app.register(boringPluginRoutes, { manager: boringAssetManager })
  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }

  // Expose the rebuild closure on the Fastify instance for external
  // callers / tests. The same closure is also wired into `beforeReload`
  // above so /reload triggers it automatically.
  ;(app as FastifyInstance & { __boringRebuildPlugins?: () => Promise<PluginRebuildResult> }).__boringRebuildPlugins =
    rebuildPlugins

  return app
}
