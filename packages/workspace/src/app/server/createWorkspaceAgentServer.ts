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
import { LifecycleBus } from "../../shared/plugins/lifecycleBus"
import { rebuildServerPlugins, type PluginRebuildResult } from "./rebuildServerPlugins"
import { pluginRootFromExtensionPath, preflightBoringPlugins, readBoringPlugins } from "../../server/agentPlugins/scan"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "../../server/ui-control/tools/uiTools"
import { uiRoutes } from "../../server/ui-control/http/uiRoutes"
import {
  ServerPluginError,
  bootstrapServer,
  composeServerPlugins,
  defineServerPlugin,
  validateServerPlugin,
  compactPiPackages,
  type ServerBootstrapOptions,
  type ComposeServerPluginsOptions,
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
  /**
   * @deprecated Pass factory functions in `plugins:` instead. Kept for
   * back-compat; entries are concatenated into the unified install array.
   */
  pluginFactories?: WorkspaceAgentServerPluginFactory[]
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
}

export {
  ServerPluginError,
  composeServerPlugins,
  defineServerPlugin,
  validateServerPlugin,
}
export type {
  ComposeServerPluginsOptions,
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
  // Phase 4: server-side plugin lifecycle bus. Phase 5 will wire it to the
  // /reload route so consumers can subscribe for cleanup/rebuild work.
  const pluginLifecycleBus = new LifecycleBus()
  const allPluginEntries: WorkspacePluginEntry[] = [
    ...(opts.plugins ?? []),
    ...(opts.pluginFactories ?? []),
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
  const boringPluginDirs = collectBoringPluginDirs(workspaceRoot, pluginCollection)
  const boringPluginReload = opts.boringPluginReload ?? true
  const piPluginReload = opts.piPluginReload ?? true

  if (opts.provisionWorkspace !== false) {
    await provisionWorkspaceAgentServer({
      workspaceRoot,
      provisioningContributions: pluginCollection.provisioningContributions,
      force: opts.workspaceProvisioning?.force,
    })
  }

  // Static Pi resources known at boot: workspace skill dir, factory-supplied
  // values, and the bundled @hachej/boring-pi skill package. These never
  // change for the lifetime of the server.
  const workspacePackagePiPackage = createBoringPiPackageSource(workspaceRoot)
  const staticPiSkillPaths = pluginCollection.agentOptions.pi?.additionalSkillPaths ?? []
  const staticPiPackages = compactPiPackages([
    workspacePackagePiPackage,
    ...(pluginCollection.agentOptions.pi?.packages ?? []),
  ])
  const staticPiExtensionPaths = pluginCollection.agentOptions.pi?.extensionPaths ?? []

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
      bus: pluginLifecycleBus,
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

  // Phase 4: emit `plugin_start { reason: "startup" }` for every initially
  // installed plugin. Pi parity (`agent-session.js:1912` `session_start
  // { reason }`). Subscribers (none yet — Phase 5 wires them) can use this
  // to mirror initial state.
  if (pluginLifecycleBus.hasHandlers("plugin_start")) {
    for (const plugin of resolvedPlugins) {
      await pluginLifecycleBus.emit({ type: "plugin_start", pluginId: plugin.id, reason: "startup" })
    }
  }

  // Phase 5: expose the rebuild closure on the Fastify instance for
  // external callers / tests. The same closure is also wired into
  // `beforeReload` above so /reload triggers it automatically.
  ;(app as FastifyInstance & { __boringRebuildPlugins?: () => Promise<PluginRebuildResult> }).__boringRebuildPlugins =
    rebuildPlugins

  return app
}
