/**
 * Standalone workspace + agent Fastify composition.
 *
 * This entry intentionally imports @hachej/boring-agent/server. Browser-facing
 * workspace entrypoints must not.
 */
import {
  autoDetectMode,
  createAgentApp,
  getBoringAgentRuntimePaths,
  provisionRuntimeWorkspace,
  provisionWorkspaceRuntime,
  resolveMode,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
  type CreateAgentAppOptions,
  type PiExtensionFactory,
  type ProvisionWorkspaceRuntimeOptions,
} from "@hachej/boring-agent/server"
import type { FastifyInstance } from "fastify"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { buildBoringSystemPrompt } from "../../server/boringSystemPrompt"
import { BoringPluginAssetManager } from "../../server/agentPlugins/manager"
import type { BoringPluginFrontTargetResolver, BoringPluginSource, BoringPluginSourceInput } from "../../server/agentPlugins/types"
import { boringPluginRoutes, collectRestartWarnings } from "../../server/agentPlugins/routes"
import { RuntimeBackendRegistry, runtimeBackendGateway } from "../../server/runtimeBackend"
import { aggregatePluginPrompts } from "../../server/agentPlugins/aggregatePluginPrompts"
import { normalizeBoringPluginPiPackages } from "../../server/agentPlugins/piPackages"
import {
  hasDirServerPlugin,
  resolveOnePluginEntry,
  type DirPluginEntry,
} from "./pluginEntryResolver"
import { rebuildServerPlugins, type PluginRebuildResult } from "./rebuildServerPlugins"
import { resolveDefaultWorkspacePluginPackagePaths } from "./defaultPluginPackages"
import { pluginRootFromExtensionPath, scanBoringPlugins } from "../../server/agentPlugins/scan"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import { registerWorkspaceUiBridge } from "../../shared/plugins/uiBridgeRegistry"
import { createWorkspaceUiTools } from "../../server/ui-control/tools/uiTools"
import { uiRoutes } from "../../server/ui-control/http/uiRoutes"
import {
  bootstrapServer,
  compactPiPackages,
  type ServerBootstrapOptions,
  type WorkspacePiPackageSource,
  type WorkspaceServerPlugin,
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

/**
 * Single install entry type. Accepts:
 *  - `WorkspaceServerPlugin` — pre-built plugin object.
 *  - `{ dir, options?, hotReload? }` — directory-source plugin resolved
 *     via explicit package.json#boring.server. Declared-but-missing throws.
 *     hotReload uses jiti for diagnostic re-imports, while route/tool
 *     registration is still boot-time.
 */
export type WorkspacePluginEntry = WorkspaceServerPlugin | DirPluginEntry

export interface CreateWorkspaceAgentServerOptions
  extends WorkspaceAgentCreateOptions,
    Pick<ServerBootstrapOptions, "defaults" | "excludeDefaults"> {
  /**
   * Plugins to install. Accepts pre-built `WorkspaceServerPlugin` objects
   * or `{ dir, options?, hotReload? }` directory-source entries.
   */
  plugins?: WorkspacePluginEntry[]
  provisionWorkspace?: boolean
  workspaceProvisioning?: { force?: boolean }
  validateUiPaths?: boolean
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
   * The host app's package root. Anchors npm-name resolution of
   * `defaultPluginPackages` at the app's own node_modules (in addition to a
   * walk-up from `workspaceRoot`). Pass when the workspace root does not
   * live under the app directory.
   */
  appRoot?: string
  /** Additional plugin collection roots to scan alongside workspace .pi/extensions and package/plugin-derived roots. */
  additionalBoringPluginDirs?: BoringPluginSourceInput[]
  /**
   * Install and advertise the boring plugin-authoring runtime.
   *
   * Keep this off for production/hosted workspaces unless a plugin-editing
   * experience is explicitly enabled. Remote sandboxes can support authoring,
   * but the CLI should be provisioned only for that activated editing mode,
   * not for every normal workspace boot.
   *
   * Defaults to true for local/standalone strong-filesystem runtimes and false
   * for remote/best-effort runtimes. Core/full-app may choose a stricter
   * default at its composition boundary.
   */
  installPluginAuthoring?: boolean
  /** Optional host-owned front-target override for boring plugin list/event payloads. */
  boringPluginFrontTargetResolver?: BoringPluginFrontTargetResolver
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function boringPiRootVisibleToAgentTools(workspaceRoot: string, resolvedMode: string, provisioned: boolean): string | undefined {
  void workspaceRoot
  void resolvedMode
  if (!provisioned) return undefined
  // Sandbox-rooted absolute path is unambiguous regardless of agent cwd
  // changes. Avoid host paths (they leak /home/... and are rejected by
  // the sandbox) and avoid bare relative paths (they break on `cd`).
  return "/workspace/.boring-agent/node/node_modules/@hachej/boring-pi"
}



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

function readPackageVersion(packageRoot: string | null): string | undefined {
  if (!packageRoot) return undefined
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown }
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : undefined
  } catch {
    return undefined
  }
}

function useLocalPackageProvisioning(): boolean {
  return process.env.BORING_USE_LOCAL_PACKAGES === "1"
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

function isUsableBoringUiPluginCliPackageRoot(candidate: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
    return pkg.name === "@hachej/boring-ui-plugin-cli"
      && existsSync(join(candidate, "dist", "bin.js"))
  } catch {
    return false
  }
}

function resolveBoringUiPluginCliPackageRoot(): string | null {
  const workspacePackageRoot = resolveWorkspacePackageRoot()
  const candidates = [
    join(workspacePackageRoot, "..", "plugin-cli"),
    join(workspacePackageRoot, "node_modules", "@hachej", "boring-ui-plugin-cli"),
  ]
  for (const candidate of candidates) {
    if (isUsableBoringUiPluginCliPackageRoot(candidate)) return candidate
  }
  try {
    const resolved = dirname(require.resolve("@hachej/boring-ui-plugin-cli/package.json"))
    return isUsableBoringUiPluginCliPackageRoot(resolved) ? resolved : null
  } catch {
    return null
  }
}

export const PLUGIN_AUTHORING_PROVISIONING_IDS = new Set(["boring-ui-plugin-cli-package"])

export function omitPluginAuthoringProvisioning(
  plugins: WorkspaceRuntimeProvisioningInput[],
): WorkspaceRuntimeProvisioningInput[] {
  return plugins.filter((plugin) => !PLUGIN_AUTHORING_PROVISIONING_IDS.has(plugin.id))
}

function createBoringUiPluginCliPackageProvisioningContribution(): WorkspaceProvisioningContribution | null {
  const packageRoot = useLocalPackageProvisioning() ? resolveBoringUiPluginCliPackageRoot() : null
  const version = readPackageVersion(resolveWorkspacePackageRoot())

  return {
    id: "boring-ui-plugin-cli-package",
    provisioning: {
      nodePackages: [{
        id: "boring-ui-plugin-cli",
        packageName: "@hachej/boring-ui-plugin-cli",
        ...(packageRoot ? { packageRoot } : { version }),
        expectedBins: ["boring-ui-plugin"],
      }],
    },
  }
}

function createBoringPiPackageSource(workspaceRoot: string): WorkspacePiPackageSource | undefined {
  const workspacePackageRoot = join(workspaceRoot, "node_modules", "@hachej", "boring-pi")
  const source = existsSync(join(workspacePackageRoot, "package.json"))
    ? workspacePackageRoot
    : resolveBoringPiPackageRoot()
  if (!source || !existsSync(join(source, "package.json"))) return undefined
  return { source, skills: ["skills/boring-plugin-authoring"] }
}

/**
 * Direct absolute path(s) to bundled boring-pi skills.
 *
 * The boring-pi package source above is the canonical declarative way to
 * register the skill, but Pi's DefaultResourceLoader skips package-resolved
 * skills (`enabledSkills`) when `noSkills: true` is set — and boring's
 * default agent factory does set `noSkills: true` so user-global skills
 * (~/.agents/skills) don't leak into the agent's prompt. To keep OUR
 * skill flowing regardless of that filter, we also push the SKILL.md
 * path into `additionalSkillPaths`, which Pi loads via its skillsOverride
 * even under noSkills. Belt-and-suspenders so the agent always sees the
 * plugin-authoring skill.
 */
function resolveBoringPiSkillPaths(workspaceRoot: string): string[] {
  const pkg = createBoringPiPackageSource(workspaceRoot)
  const root = typeof pkg === "string" ? pkg : pkg?.source
  if (!root) return []
  const skillFile = join(root, "skills", "boring-plugin-authoring", "SKILL.md")
  return existsSync(skillFile) ? [skillFile] : []
}


export interface WorkspaceAgentServerPluginCollection {
  provisioningContributions: WorkspaceProvisioningContribution[]
  runtimePlugins: WorkspaceRuntimeProvisioningInput[]
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
  /** Whether to include built-in boring plugin-authoring provisioning/prompt resources. */
  installPluginAuthoring?: boolean
}

export function buildWorkspaceContextPrompt(): string {
  return [
    '## Workspace',
    '- Root: `$BORING_AGENT_WORKSPACE_ROOT` (exported into every bash invocation)',
    '- Generated plugin skills: `$BORING_AGENT_WORKSPACE_ROOT/.boring-agent/skills/` — readable with normal file tools',
    '- User workspace skills: `$BORING_AGENT_WORKSPACE_ROOT/.agents/skills/`',
    '- Runtime CLIs (`boring-ui-plugin`, `bm`, `python`, `pip`, `uv`) come from `.boring-agent/node`, `.boring-agent/venv`, and `.boring-agent/sdk/uv` and are already on PATH',
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

  const excludedDefaults = new Set(opts.excludeDefaults ?? [])
  const builtinProvisioningContributions = (opts.installPluginAuthoring === false
    ? []
    : [createBoringUiPluginCliPackageProvisioningContribution()])
    .filter((entry): entry is WorkspaceProvisioningContribution => Boolean(entry))
    .filter((entry) => !excludedDefaults.has(entry.id))

  return {
    provisioningContributions: [
      ...builtinProvisioningContributions,
      ...result.provisioningContributions,
    ],
    runtimePlugins: [
      ...builtinProvisioningContributions,
      ...result.runtimePlugins,
    ],
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
        // Host-level extensionFactories (opts.pi.extensionFactories) flow
        // straight through via the ...opts.pi spread above. Plugins no
        // longer contribute extensionFactories — tools live on agentTools,
        // file-based extensions on extensionPaths.
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
    contributions: opts.provisioningContributions as Parameters<typeof provisionRuntimeWorkspace>[0]["contributions"],
    force: opts.force,
  })
}

function uniquePluginSources(sources: BoringPluginSource[]): BoringPluginSource[] {
  const byRoot = new Map<string, BoringPluginSource>()
  for (const source of sources) {
    const existing = byRoot.get(source.rootDir)
    if (!existing || (!existing.workspaceId && source.workspaceId)) byRoot.set(source.rootDir, source)
  }
  return [...byRoot.values()]
}

const REMOTE_PI_PACKAGE_SOURCE_PREFIXES = ["npm:", "git:", "github:", "http:", "https:", "ssh:"]

function piPackageSourceValue(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const source = (entry as { source?: unknown }).source
    return typeof source === "string" ? source : undefined
  }
  return undefined
}

function resolveLocalPiPackageSource(settingsDir: string, source: string): string | undefined {
  const path = source.startsWith("file:") ? source.slice("file:".length) : source
  if (!path) return undefined
  if (REMOTE_PI_PACKAGE_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix))) return undefined
  if (!isAbsolute(path) && path !== "." && path !== "./" && !path.startsWith("./") && !path.startsWith("../")) return undefined
  return resolve(settingsDir, path)
}

export function readPiSettingsBoringPluginSources(settingsPath: string, workspaceId?: string): BoringPluginSource[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch {
    return []
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const packages = (raw as { packages?: unknown }).packages
  if (!Array.isArray(packages)) return []
  const settingsDir = dirname(settingsPath)
  return uniquePluginSources(
    packages
      .map(piPackageSourceValue)
      .map((source) => source ? resolveLocalPiPackageSource(settingsDir, source) : undefined)
      .filter((rootDir): rootDir is string => Boolean(rootDir))
      .map((rootDir): BoringPluginSource => ({
        rootDir,
        kind: "external",
        ...(workspaceId ? { workspaceId } : {}),
      })),
  )
}

function collectBoringPluginSources(
  workspaceRoot: string,
  pluginCollection: WorkspaceAgentServerPluginCollection,
  additionalPluginDirs: BoringPluginSourceInput[] = [],
): BoringPluginSource[] {
  const extensionPaths = pluginCollection.agentOptions.pi?.extensionPaths ?? []
  const pluginRoots = extensionPaths.flatMap((path) => {
    try {
      return [pluginRootFromExtensionPath(path)]
    } catch {
      return []
    }
  })
  return uniquePluginSources([
    { rootDir: join(workspaceRoot, ".pi", "extensions"), kind: "external", workspaceId: workspaceRoot },
    { rootDir: join(workspaceRoot, ".pi", "npm"), kind: "external", workspaceId: workspaceRoot },
    { rootDir: join(workspaceRoot, ".pi", "git"), kind: "external", workspaceId: workspaceRoot },
    { rootDir: join(homedir(), ".pi", "agent", "extensions"), kind: "external" },
    ...readPiSettingsBoringPluginSources(join(workspaceRoot, ".pi", "settings.json"), workspaceRoot),
    ...readPiSettingsBoringPluginSources(join(homedir(), ".pi", "agent", "settings.json")),
    ...pluginRoots.map((rootDir): BoringPluginSource => ({ rootDir, kind: "internal" })),
    ...additionalPluginDirs.map((entry): BoringPluginSource => typeof entry === "string"
      ? { rootDir: entry, kind: "internal" }
      : entry),
  ])
}

export interface WorkspacePluginPackagePiSnapshot {
  additionalSkillPaths: string[]
  packages: WorkspacePiPackageSource[]
  extensionPaths: string[]
  systemPromptAppend?: string
}

export type WorkspaceRuntimeProvisioningInput = ProvisionWorkspaceRuntimeOptions["plugins"][number]

function mergeRuntimeProvisioningInputs(
  plugins: WorkspaceRuntimeProvisioningInput[],
): WorkspaceRuntimeProvisioningInput[] {
  const byId = new Map<string, WorkspaceRuntimeProvisioningInput>()
  for (const plugin of plugins) {
    const current = byId.get(plugin.id) ?? { id: plugin.id }
    byId.set(plugin.id, {
      id: plugin.id,
      skills: [...(current.skills ?? []), ...(plugin.skills ?? [])],
      provisioning: {
        templateDirs: [...(current.provisioning?.templateDirs ?? []), ...(plugin.provisioning?.templateDirs ?? [])],
        python: [...(current.provisioning?.python ?? []), ...(plugin.provisioning?.python ?? [])],
        nodePackages: [...(current.provisioning?.nodePackages ?? []), ...(plugin.provisioning?.nodePackages ?? [])],
      },
    })
  }
  return [...byId.values()]
}

function emptyPackageJsonPiSnapshot(): WorkspacePluginPackagePiSnapshot {
  return { additionalSkillPaths: [], packages: [], extensionPaths: [] }
}

function skillNameFromResolvedPath(path: string): string {
  const leaf = path.split(/[\\/]/).filter(Boolean).at(-1) ?? "skill"
  if (leaf.toLowerCase() !== "skill.md") return leaf
  return path.split(/[\\/]/).filter(Boolean).at(-2) ?? "skill"
}

function skillPathForPiLoader(path: string): string {
  return existsSync(join(path, "SKILL.md")) ? dirname(path) : path
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

export function readWorkspacePluginPackageRuntimePlugins(pluginDirs: BoringPluginSourceInput[]): WorkspaceRuntimeProvisioningInput[] {
  const scan = scanBoringPlugins(pluginDirs)
  return scan.plugins.map((plugin) => ({
    id: plugin.id,
    ...(plugin.skillPaths?.length
      ? {
          skills: plugin.skillPaths.map((source) => ({
            name: skillNameFromResolvedPath(source),
            source,
          })),
        }
      : {}),
  }))
}

function aggregatePluginSystemPromptsFromScan(scan: ReturnType<typeof scanBoringPlugins>): string | undefined {
  const prompts = scan.plugins
    .map((plugin) => plugin.pi?.systemPrompt?.trim())
    .filter((prompt): prompt is string => Boolean(prompt))
  if (prompts.length === 0) return undefined
  return `# Loaded boring-ui plugin context\n\n${prompts.join("\n\n")}`
}

export function readWorkspacePluginPackagePiSnapshot(pluginDirs: BoringPluginSourceInput[]): WorkspacePluginPackagePiSnapshot {
  try {
    const scan = scanBoringPlugins(pluginDirs)
    const systemPromptAppend = aggregatePluginSystemPromptsFromScan(scan)
    return {
      additionalSkillPaths: uniqueStrings(
        scan.plugins.flatMap((plugin) => plugin.skillPaths ?? []).map(skillPathForPiLoader),
      ),
      packages: compactPiPackages(normalizeBoringPluginPiPackages(scan.plugins)),
      extensionPaths: scan.plugins.flatMap((plugin) => plugin.extensionPaths ?? []),
      ...(systemPromptAppend ? { systemPromptAppend } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      '[boring-workspace] readWorkspacePluginPackagePiSnapshot failed — falling back to empty Pi snapshot:',
      message,
    )
    return emptyPackageJsonPiSnapshot()
  }
}

export async function createWorkspaceAgentServer(
  opts: CreateWorkspaceAgentServerOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const bridge = createInMemoryBridge()
  const unregisterUiBridge = registerWorkspaceUiBridge(bridge)
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const modeAdapter = opts.runtimeModeAdapter ?? resolveMode(resolvedMode)
  const workspaceFsCapability = modeAdapter.workspaceFsCapability ?? "best-effort"
  const validateUiPaths = opts.validateUiPaths ?? workspaceFsCapability === "strong"
  const uiTools = createWorkspaceUiTools(bridge, {
    workspaceRoot: validateUiPaths ? workspaceRoot : undefined,
  })
  const ctx: WorkspaceAgentServerPluginContext = { workspaceRoot, bridge }

  // Resolve app-default plugin packages (explicit list set in host boot
  // code — the server-side mirror of the app's static front imports). Each
  // entry is resolved to an absolute package dir. All default package dirs
  // flow into the boring asset manager + dynamic Pi scan; only packages
  // that actually declare/provide a server entry flow into the server-side
  // install array. Front/Pi-only default packages must not be forced through
  // a server import.
  const defaultPluginPackagePaths = resolveDefaultWorkspacePluginPackagePaths({
    workspaceRoot,
    defaultPluginPackages: opts.defaultPluginPackages,
    anchorDir: opts.appRoot,
  })
  const defaultPluginDirEntries: WorkspacePluginEntry[] = defaultPluginPackagePaths
    .map((dir) => ({ dir, hotReload: true }))
    .filter((entry) => hasDirServerPlugin(entry))

  const allPluginEntries: WorkspacePluginEntry[] = [
    ...defaultPluginDirEntries,
    ...(opts.plugins ?? []),
  ]
  // Each entry (pre-built plugin or { dir, ... }) is resolved by
  // resolveOnePluginEntry. Same logic serves rebuilds on /reload.
  const resolvedPlugins = await Promise.all(
    allPluginEntries.map((entry) => resolveOnePluginEntry<WorkspaceServerPlugin>(entry, ctx)),
  )
  const pluginAuthoringEnabled = (opts.installPluginAuthoring ?? workspaceFsCapability === "strong")
    && !(opts.excludeDefaults ?? []).includes("boring-ui-plugin-cli-package")
  const pluginCollection = collectWorkspaceAgentServerPlugins({
    ...opts,
    plugins: resolvedPlugins,
    installPluginAuthoring: pluginAuthoringEnabled,
  })

  // Static Pi resources known at boot: workspace skill dir,
  // factory-supplied values, and the bundled @hachej/boring-pi skill package.
  // Plugin package.json#pi resources flow through the dynamic resource getter
  // so `/reload` always re-reads manifest changes.
  const workspacePackagePiPackage = pluginAuthoringEnabled ? createBoringPiPackageSource(workspaceRoot) : undefined
  const baseStaticPiSkillPaths = [
    ...(pluginAuthoringEnabled ? resolveBoringPiSkillPaths(workspaceRoot) : []),
    ...(pluginCollection.agentOptions.pi?.additionalSkillPaths ?? []),
  ]
  const baseStaticPiPackages = [
    workspacePackagePiPackage,
    ...(pluginCollection.agentOptions.pi?.packages ?? []),
  ]
  const baseStaticPiExtensionPaths = pluginCollection.agentOptions.pi?.extensionPaths ?? []

  // Boring plugin discovery: scan external workspace/global extension
  // collections plus internal app/plugin-provided sources. Source kind is
  // explicit so later activation code does not infer trust from paths.
  const boringPluginDirs: BoringPluginSource[] = []
  const refreshBoringPluginDirs = (): BoringPluginSource[] => {
    const next = uniquePluginSources([
      ...defaultPluginPackagePaths.map((rootDir): BoringPluginSource => ({ rootDir, kind: "internal" })),
      ...collectBoringPluginSources(workspaceRoot, pluginCollection, opts.additionalBoringPluginDirs),
    ])
    boringPluginDirs.splice(0, boringPluginDirs.length, ...next)
    return boringPluginDirs
  }
  refreshBoringPluginDirs()

  // Dynamic Pi resources discovered from package.json#pi at /reload time.
  // Pi calls `getHotReloadableResources()` on every reloadSession() and merges the
  // result with the static fields above, so the workspace never mutates
  // arrays the harness already captured.
  const staticPluginPackagePiSnapshot = emptyPackageJsonPiSnapshot()
  const staticPiSkillPaths = [
    ...baseStaticPiSkillPaths,
    ...staticPluginPackagePiSnapshot.additionalSkillPaths,
  ]
  const staticPiPackages = compactPiPackages([
    ...baseStaticPiPackages,
    ...staticPluginPackagePiSnapshot.packages,
  ])
  const staticPiExtensionPaths = [
    ...baseStaticPiExtensionPaths,
    ...staticPluginPackagePiSnapshot.extensionPaths,
  ]

  const getHotReloadablePiResources = () => readWorkspacePluginPackagePiSnapshot(refreshBoringPluginDirs())

  const boringAssetManager = new BoringPluginAssetManager({
    pluginDirs: boringPluginDirs,
    errorRoot: join(workspaceRoot, ".pi", "extensions"),
    frontTargetResolver: opts.boringPluginFrontTargetResolver,
  })
  const runtimeBackendRegistry = new RuntimeBackendRegistry()

  const buildRuntimeProvisioningInputs = () => {
    const inputs = mergeRuntimeProvisioningInputs([
      ...pluginCollection.runtimePlugins,
      ...readWorkspacePluginPackageRuntimePlugins(refreshBoringPluginDirs()),
    ])
    if (resolvedMode === "direct") return omitPluginAuthoringProvisioning(inputs)
    return inputs
  }
  let currentRuntimeProvisioning = opts.runtimeProvisioning
  const runtimeWorkspaceRoot = resolvedMode === "vercel-sandbox"
    ? VERCEL_SANDBOX_WORKSPACE_ROOT
    : workspaceRoot
  const runtimeLayout = getBoringAgentRuntimePaths(runtimeWorkspaceRoot)
  const runRuntimeProvisioning = async () => {
    if (opts.provisionWorkspace === false) return currentRuntimeProvisioning
    const adapter = modeAdapter.createProvisioningAdapter?.(runtimeLayout, {
      workspaceRoot,
      sessionId: opts.sessionId ?? "default",
    })
    if (!adapter) return currentRuntimeProvisioning
    const provisioned = await provisionWorkspaceRuntime({
      plugins: buildRuntimeProvisioningInputs(),
      adapter,
      runtimeLayout,
    })
    currentRuntimeProvisioning = provisioned ? {
      ...provisioned,
      env: {
        ...provisioned.env,
        BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS: workspaceFsCapability === "strong" ? "1" : "0",
      },
    } : currentRuntimeProvisioning
    return currentRuntimeProvisioning
  }
  await runRuntimeProvisioning()

  // Rebuild closure created BEFORE createAgentApp so beforeReload can
  // call it.
  const rebuildPlugins = async (): Promise<PluginRebuildResult> => {
    return rebuildServerPlugins({ entries: allPluginEntries, ctx })
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
      // `boring-ui-plugin` resolves via PATH from the provisioned workspace
      // runtime. It is the slim setup component for agent-authored plugins;
      // do not route plugin authoring through the full human-facing CLI.
      pluginAuthoringEnabled ? buildBoringSystemPrompt({
        scaffoldCommand: "boring-ui-plugin scaffold",
        verifyCommand: "boring-ui-plugin verify",
        boringPiRootOverride: boringPiRootVisibleToAgentTools(
          workspaceRoot,
          resolvedMode,
          opts.provisionWorkspace !== false,
        ),
      }) : undefined,
      pluginCollection.agentOptions.systemPromptAppend,
      staticPluginPackagePiSnapshot.systemPromptAppend,
    ].filter(Boolean).join("\n\n") || undefined,
    beforeReload: async () => {
      // Per-plugin scan/rebuild failures are surfaced via SSE error
      // events + `.error` files (asset manager) and via the response
      // body of POST /api/v1/agent/reload (rebuild diagnostics). They
      // MUST NOT throw out of beforeReload — that would abort the
      // entire reload, leaving every other plugin on stale code and
      // contradicting the "previous live state untouched, other
      // plugins unaffected" recovery story.
      let restart_warnings: ReturnType<typeof collectRestartWarnings> = []
      let diagnostics: PluginRebuildResult["diagnostics"] = []
      refreshBoringPluginDirs()
      const scan = await boringAssetManager.load()
      const backendReload = await runtimeBackendRegistry.reloadFromLoadedPlugins(boringAssetManager.inspectLoaded())
      restart_warnings = collectRestartWarnings(scan.events)
      const scanDiagnostics = scan.errors.map((error) => ({
        source: `boring plugin asset scan (${error.id})`,
        message: error.message,
        pluginId: error.id,
      }))
      const rebuild = await rebuildPlugins()
      diagnostics = [...scanDiagnostics, ...backendReload.diagnostics, ...rebuild.diagnostics]
      await runRuntimeProvisioning()
      const callerResult = await opts.beforeReload?.()
      const callerRestartWarnings = callerResult && typeof callerResult === "object"
        ? callerResult.restart_warnings ?? []
        : []
      const callerDiagnostics = callerResult && typeof callerResult === "object"
        ? callerResult.diagnostics ?? []
        : []
      const mergedRestartWarnings = [...restart_warnings, ...callerRestartWarnings]
      const mergedDiagnostics = [...diagnostics, ...callerDiagnostics]
      // Surface restart warnings and non-fatal rebuild diagnostics on the
      // /api/v1/agent/reload response so the chat UI / agent can render
      // actionable warnings even when partial plugin failures don't abort
      // the reload.
      if (mergedRestartWarnings.length === 0 && mergedDiagnostics.length === 0) return undefined
      return {
        ...(mergedRestartWarnings.length > 0 ? { restart_warnings: mergedRestartWarnings } : {}),
        ...(mergedDiagnostics.length > 0 ? { diagnostics: mergedDiagnostics } : {}),
      }
    },
    runtimeProvisioning: currentRuntimeProvisioning,
    getRuntimeProvisioning: () => currentRuntimeProvisioning,
    pi: {
      ...pluginCollection.agentOptions.pi,
      additionalSkillPaths: staticPiSkillPaths,
      packages: staticPiPackages,
      extensionPaths: staticPiExtensionPaths,
      extensionFactories: pluginCollection.agentOptions.pi?.extensionFactories,
      getHotReloadableResources: getHotReloadablePiResources,
    },
    systemPromptDynamic: () => aggregatePluginPrompts(boringAssetManager),
  })
  refreshBoringPluginDirs()
  await boringAssetManager.load()
  await runtimeBackendRegistry.reloadFromLoadedPlugins(boringAssetManager.inspectLoaded())
  if (typeof app.addHook === "function") {
    app.addHook("onClose", async () => {
      await runtimeBackendRegistry.close()
      unregisterUiBridge()
    })
  }
  await app.register(uiRoutes, { bridge, preserveStateKeys: pluginCollection.preservedUiStateKeys })
  await app.register(boringPluginRoutes, {
    manager: boringAssetManager,
  })
  await app.register(runtimeBackendGateway, { registry: runtimeBackendRegistry, defaultWorkspaceId: workspaceRoot })
  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }

  // Expose the rebuild closure on the Fastify instance for external
  // callers / tests. The same closure is also wired into `beforeReload`
  // above so /reload triggers it automatically.
  ;(app as FastifyInstance & {
    __boringRebuildPlugins?: () => Promise<PluginRebuildResult>
    __boringAssetManager?: BoringPluginAssetManager
    __boringRuntimeBackendRegistry?: RuntimeBackendRegistry
  }).__boringRebuildPlugins = rebuildPlugins
  ;(app as FastifyInstance & {
    __boringRebuildPlugins?: () => Promise<PluginRebuildResult>
    __boringAssetManager?: BoringPluginAssetManager
    __boringRuntimeBackendRegistry?: RuntimeBackendRegistry
  }).__boringAssetManager = boringAssetManager
  ;(app as FastifyInstance & {
    __boringRebuildPlugins?: () => Promise<PluginRebuildResult>
    __boringAssetManager?: BoringPluginAssetManager
    __boringRuntimeBackendRegistry?: RuntimeBackendRegistry
  }).__boringRuntimeBackendRegistry = runtimeBackendRegistry

  return app
}
