/**
 * Standalone workspace + agent Fastify composition.
 *
 * This entry intentionally imports @hachej/boring-agent/server. Browser-facing
 * workspace entrypoints must not.
 */
import {
  autoDetectMode,
  createAgentAuthMiddleware,
  createAgentHost,
  createResolvedRuntimeScopeIdentity,
  createSandboxRuntimeModeAdapter,
  normalizeRuntimeReadonlyFilesystemPolicy,
  provisionRuntimeWorkspace,
  provisionWorkspaceRuntime,
  registerAgentRoutes,
  resolveBuiltinRuntimeLayoutRoot,
  sandboxRuntimeHostOperations,
  type AgentFleetCompiler,
  type AgentHostAgentSpec,
  type AuthorizedAgentScope,
  type CreateAgentAppOptions,
  type PiExtensionFactory,
  type ProvisionWorkspaceRuntimeOptions,
  type RegisterAgentRoutesOptions,
  type ResolvedAgentRuntimeScope,
  type VerifiedAgentScopeClaim,
  type WorkspaceAgentDispatcherResolver,
} from "@hachej/boring-agent/server"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { buildBoringSystemPrompt } from "../../server/boringSystemPrompt"
import { BoringPluginAssetManager } from "../../server/agentPlugins/manager"
import { PLUGIN_SIGNATURE_CACHE_FILE } from "../../server/agentPlugins/signatureCache"
import type { BoringPluginFrontTargetResolver, BoringPluginSource, BoringPluginSourceInput } from "../../server/agentPlugins/types"
import { boringPluginRoutes, collectRestartWarnings } from "../../server/agentPlugins/routes"
import { RuntimeBackendRegistry, runtimeBackendGateway } from "../../server/runtimeBackend"
import { aggregatePluginPrompts } from "../../server/agentPlugins/aggregatePluginPrompts"
import { normalizeBoringPluginPiPackages } from "../../server/agentPlugins/piPackages"
import {
  assertWorkspaceBridgeHandlersTrusted,
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
  createLocalCliBridgeAuthPolicy,
  createWorkspaceBridgeRuntimeCore,
  InMemoryWorkspaceBridgeIdempotencyStore,
  createWorkspaceBridgeRuntimeEnvContribution,
  workspaceBridgeHttpRoutes,
  type BridgeAuthPolicy,
  type WorkspaceBridgeHandler,
  type WorkspaceBridgeOperationDefinition,
  type WorkspaceBridgeRegistry,
  type WorkspaceBridgeRuntimeEnvOptions,
} from "../../server"
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
  /** Available only to boot-time internal package plugins in standalone/local composition. */
  trusted?: {
    workspaceAgentDispatcherResolver: WorkspaceAgentDispatcherResolver
    actorResolver: (request: FastifyRequest) => Promise<{ workspaceId: string; userId: string }> | { workspaceId: string; userId: string }
    /** Host-owned database connection exposed only to trusted boot-time plugins. */
    sql?: unknown
    actorVerifier?: (actor: { workspaceId: string; userId: string }) => Promise<boolean> | boolean
    hostedAutomationTriggerToken?: string
  }
}

/**
 * Single install entry type. Accepts:
 *  - `WorkspaceServerPlugin` — pre-built plugin object.
 *  - `{ dir, options?, hotReload?, trust? }` — directory-source plugin resolved
 *     via explicit package.json#boring.server. Declared-but-missing throws.
 *     hotReload uses jiti for diagnostic re-imports, while route/tool
 *     registration is still boot-time. Directory entries may contribute
 *     `workspaceBridgeHandlers` only when marked `trust: "internal"`.
 */
export type WorkspacePluginEntry = WorkspaceServerPlugin | DirPluginEntry

export interface CreateWorkspaceAgentServerOptions
  extends WorkspaceAgentCreateOptions,
    Pick<ServerBootstrapOptions, "defaults" | "excludeDefaults"> {
  /** Trusted deployment fleet. Omission preserves the legacy default Agent. */
  agents?: readonly AgentHostAgentSpec[]
  /** App-owned trust compiler for configured Agent plugin/model bindings. */
  fleetCompiler?: AgentFleetCompiler
  /** Agent selected by the compatibility browser wire. Defaults to `default`. */
  defaultAgentTypeId?: string
  /** Optional host admission called immediately before each Agent effect. */
  admitEffect?: RegisterAgentRoutesOptions["admitEffect"]
  /**
   * Host-installed server plugins. Accepts pre-built `WorkspaceServerPlugin`
   * objects or `{ dir, options?, hotReload?, trust? }` directory-source entries.
   * Directory entries may contribute privileged `workspaceBridgeHandlers` only
   * when explicitly marked `trust: "internal"`.
   */
  plugins?: WorkspacePluginEntry[]
  provisionWorkspace?: boolean
  /** Host-owned workspace-relative readonly path ceiling. */
  readonlyWorkspacePaths?: readonly string[]
  /** Require strong shell enforcement; unsupported providers fail closed. */
  requestedReadonlyWorkspacePathEnforcement?: RegisterAgentRoutesOptions["requestedReadonlyWorkspacePathEnforcement"]
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
  workspaceBridge?: {
    registry?: WorkspaceBridgeRegistry
    runtimeTokenSecret?: string
    runtimeRefreshTokenSecret?: string
    browserAuthPolicy?: BridgeAuthPolicy
    /**
     * Dev-only escape hatch for standalone/local CLI usage. This is never
     * enabled implicitly: exposed hosts must provide browserAuthPolicy, and
     * local tools that intentionally rely on the unauthenticated local-cli
     * policy must opt in explicitly.
     */
    allowInsecureLocalCliBrowserAuth?: boolean
    handlers?: Array<{
      definition: WorkspaceBridgeOperationDefinition
      handler: WorkspaceBridgeHandler
    }>
    runtimeEnv?: WorkspaceBridgeRuntimeEnvOptions
  }
  /** Additional plugin collection roots to scan alongside workspace .pi/extensions and package/plugin-derived roots. */
  additionalBoringPluginDirs?: BoringPluginSourceInput[]
  /**
   * Install and advertise the boring plugin-authoring runtime.
   *
   * This option is ignored when `externalPlugins` is false. Keep it off for
   * production/hosted workspaces unless a plugin-editing experience is
   * explicitly enabled. Remote sandboxes can support authoring, but the CLI
   * should be provisioned only for that activated editing mode, not for every
   * normal workspace boot.
   *
   * Defaults to true for local/standalone strong-filesystem runtimes and false
   * for remote/best-effort runtimes. Core/full-app may choose a stricter
   * default at its composition boundary.
   */
  installPluginAuthoring?: boolean
  /** Optional host-owned front-target override for boring plugin list/event payloads. */
  boringPluginFrontTargetResolver?: BoringPluginFrontTargetResolver
  /**
   * Single public-mode switch for user/global external plugins. When false,
   * the server disables .pi/~/.pi/Pi-settings discovery, authoring CLI/prompt
   * provisioning, plugin diagnostics, and external hot-reload resources. App/
   * internal plugins from explicit `plugins`, `defaultPluginPackages`, and
   * `additionalBoringPluginDirs` continue to work.
   */
  externalPlugins?: boolean
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const DEFAULT_WORKSPACE_SCOPE_ID = "default"

interface WorkspaceAgentScopeIssuer {
  issue(input: {
    claim: VerifiedAgentScopeClaim
    runtimeScope: ResolvedAgentRuntimeScope
  }): AuthorizedAgentScope
  context(scope: AuthorizedAgentScope): ResolvedAgentRuntimeScope
  verifier: {
    verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim>
  }
}

/** App-owned, provenance-checked issuer for the standalone Workspace scope. */
function createWorkspaceAgentScopeIssuer(workspaceScopeId: string): WorkspaceAgentScopeIssuer {
  const contexts = new WeakMap<object, ResolvedAgentRuntimeScope>()
  const issue = ({ claim, runtimeScope }: {
    claim: VerifiedAgentScopeClaim
    runtimeScope: ResolvedAgentRuntimeScope
  }): AuthorizedAgentScope => {
    if (claim.workspaceScopeId !== workspaceScopeId) {
      throw Object.assign(new Error("workspace scope is not allowed"), {
        code: "AGENT_SCOPE_DENIED",
        statusCode: 403,
      })
    }
    const scope = Object.freeze({ ...claim }) as AuthorizedAgentScope
    contexts.set(scope as object, runtimeScope)
    return scope
  }
  return {
    issue,
    context(scope) {
      const runtimeScope = contexts.get(scope as object)
      if (!runtimeScope) throw new Error("agent scope was not issued by this Workspace")
      return runtimeScope
    },
    verifier: {
      async verify(scope) {
        if (!contexts.has(scope as object) || scope.workspaceScopeId !== workspaceScopeId) {
          throw new Error("agent scope was not issued by this Workspace")
        }
        return {
          workspaceScopeId: scope.workspaceScopeId,
          authSubjectId: scope.authSubjectId,
        }
      },
    },
  }
}

function trustedWorkspaceScopeId(
  request: FastifyRequest,
  workspaceScopeId: string,
  allowedSelectors: ReadonlySet<string>,
): string {
  const selectors = [
    request.headers["x-boring-workspace-id"],
    request.headers["x-boring-storage-scope"],
  ].flatMap((value) => typeof value === "string" ? [value.trim()] : [])
  if (selectors.some((selector) => selector.length === 0 || !allowedSelectors.has(selector))) {
    throw Object.assign(new Error("workspace/storage selector is not allowed"), {
      code: "AGENT_SCOPE_DENIED",
      statusCode: 403,
    })
  }
  return workspaceScopeId
}

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
 * canonical harness policy (`withPiHarnessDefaults` in @hachej/boring-agent)
 * defaults to `noSkills: true` so user-global skills (~/.agents/skills)
 * don't leak into hosted agents' prompts. To keep OUR
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


export interface ResolvedWorkspacePluginArtifact {
  /** Canonical package ID validated by the directory resolver before admission. */
  readonly id: string
  /** Deterministic digest of the admitted package/object contribution. */
  readonly contentDigest: string
  /** The single imported server module value shared by both activation sites. */
  readonly plugin: WorkspaceServerPlugin
  readonly entry: WorkspacePluginEntry
}

export interface AgentSpecPluginArtifactProjection {
  readonly artifacts: readonly ResolvedWorkspacePluginArtifact[]
  readonly runtimePlugins: WorkspaceRuntimeProvisioningInput[]
  readonly agentOptions: Pick<
    WorkspaceAgentCreateOptions,
    "extraTools" | "systemPromptAppend" | "pi"
  >
}

type IdentityJson = null | boolean | number | string | IdentityJson[] | { [key: string]: IdentityJson }

interface NormalizedAgentRuntimeContribution {
  readonly artifacts: readonly { pluginId: string; digest: string }[]
  readonly validatedConfig: IdentityJson
  readonly grants: readonly string[]
  readonly toolContractDigests: readonly string[]
  readonly bindingInputs: IdentityJson
  readonly runtimePlugins: readonly WorkspaceRuntimeProvisioningInput[]
  readonly agentOptions: AgentSpecPluginArtifactProjection["agentOptions"]
  readonly includeAllDiscoveredPluginResources: boolean
}

export const AGENT_RUNTIME_IDENTITY_ERROR_CODE = "BORING_AGENT_RUNTIME_IDENTITY_INCOMPLETE"

export class AgentRuntimeIdentityError extends Error {
  readonly code = AGENT_RUNTIME_IDENTITY_ERROR_CODE

  constructor(message: string) {
    super(message)
    this.name = "AgentRuntimeIdentityError"
  }
}

function identityDigest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function canonicalIdentityJson(value: IdentityJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalIdentityJson).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalIdentityJson(value[key]!)}`).join(",")}}`
}

function jsonIdentityValue(value: unknown, field: string): IdentityJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((entry, index) => jsonIdentityValue(entry, `${field}[${index}]`))
  if (!value || typeof value !== "object" || value instanceof URL) {
    throw new AgentRuntimeIdentityError(`${field} contains an opaque value without an explicit stable digest`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AgentRuntimeIdentityError(`${field} contains an opaque value without an explicit stable digest`)
  }
  const result: Record<string, IdentityJson> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
    if (entry !== undefined) result[key] = jsonIdentityValue(entry, `${field}.${key}`)
  }
  return result
}

function resolvedPolicyIdentity(
  policy: Readonly<Record<string, unknown>>,
  explicitDigest: unknown,
): IdentityJson {
  try {
    return jsonIdentityValue(policy, "resolvedPolicy")
  } catch (error) {
    if (typeof explicitDigest === "string" && explicitDigest.trim()) {
      return { resolvedPolicyDigest: explicitDigest.trim() }
    }
    throw error
  }
}

function pluginHasAgentRuntimeContribution(plugin: WorkspaceServerPlugin): boolean {
  return Boolean(
    plugin.systemPrompt
    || plugin.agentTools?.length
    || plugin.piPackages?.length
    || plugin.extensionPaths?.length
    || plugin.skills?.length
    || plugin.provisioning,
  )
}

function directoryContentDigest(root: string): string {
  const hash = createHash("sha256")
  const visit = (absolute: string, relative: string) => {
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) {
      throw new AgentRuntimeIdentityError(`directory plugin contains unsupported symlink at ${relative}`)
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (
          name === ".git"
          || name === "node_modules"
          || (relative === "" && name === PLUGIN_SIGNATURE_CACHE_FILE)
        ) continue
        visit(join(absolute, name), relative ? `${relative}/${name}` : name)
      }
      return
    }
    if (!stat.isFile()) return
    hash.update(`file\0${relative}\0`)
    hash.update(readFileSync(absolute))
    hash.update("\0")
  }
  visit(resolve(root), "")
  return hash.digest("hex")
}

function resolvedArtifactContentDigest(entry: WorkspacePluginEntry, plugin: WorkspaceServerPlugin): string {
  if ("dir" in entry) return directoryContentDigest(entry.dir)
  if (typeof plugin.contentDigest === "string" && plugin.contentDigest.trim()) return plugin.contentDigest.trim()
  if (pluginHasAgentRuntimeContribution(plugin)) {
    throw new AgentRuntimeIdentityError(
      `prebuilt plugin "${plugin.id}" contributes Agent/runtime bindings without contentDigest`,
    )
  }
  return identityDigest(canonicalIdentityJson({ pluginId: plugin.id, contribution: "none" }))
}

function toolContractDigest(tool: unknown): string {
  if (!tool || typeof tool !== "object") {
    throw new AgentRuntimeIdentityError("Agent tool contract must be an object")
  }
  const { execute: _execute, ...contract } = tool as Record<string, unknown>
  return identityDigest(canonicalIdentityJson(jsonIdentityValue(contract, "agentToolContract")))
}

function agentRuntimeContributionIdentityInput(input: {
  readonly agent: AgentHostAgentSpec & { readonly resolvedPolicyDigest?: string }
  readonly resolvedPolicy: Readonly<Record<string, unknown>>
  readonly projection: AgentSpecPluginArtifactProjection
  readonly includeAllDiscoveredPluginResources: boolean
}): Pick<NormalizedAgentRuntimeContribution, "artifacts" | "validatedConfig" | "grants" | "toolContractDigests" | "bindingInputs"> {
  const { agent, projection } = input
  const configuredBindings = "legacyDefault" in agent ? [] : (agent.plugins ?? [])
  const toolContractDigests = (projection.agentOptions.extraTools ?? []).map(toolContractDigest)
  const bindingInputs = jsonIdentityValue({
    agent: "legacyDefault" in agent
      ? { agentTypeId: agent.agentTypeId, legacyDefault: true }
      : {
          agentTypeId: agent.agentTypeId,
          definition: agent.definition,
          model: agent.model,
          pluginOrder: configuredBindings.map((binding) => binding.name),
        },
    resolvedPolicy: resolvedPolicyIdentity(input.resolvedPolicy, input.agent.resolvedPolicyDigest),
    contribution: {
      selectedArtifactOrder: projection.artifacts.map((artifact) => artifact.id),
      systemPromptAppend: projection.agentOptions.systemPromptAppend ?? null,
      pi: {
        packages: projection.agentOptions.pi?.packages ?? [],
        extensionPaths: projection.agentOptions.pi?.extensionPaths ?? [],
        additionalSkillPaths: projection.agentOptions.pi?.additionalSkillPaths ?? [],
      },
      toolContractOrder: toolContractDigests,
      runtimePluginOrder: projection.runtimePlugins.map((plugin) => plugin.id),
      includeAllDiscoveredPluginResources: input.includeAllDiscoveredPluginResources,
    },
  }, "bindingInputs")
  return {
    artifacts: projection.artifacts.map((artifact) => ({ pluginId: artifact.id, digest: artifact.contentDigest })),
    validatedConfig: jsonIdentityValue(Object.fromEntries(configuredBindings.map((binding) => [
      binding.name,
      binding.config ?? null,
    ])), "validatedConfig"),
    grants: [],
    toolContractDigests,
    bindingInputs,
  }
}

export const AGENT_SPEC_PLUGIN_PROJECTION_ERROR_CODE = "BORING_AGENT_PLUGIN_NOT_PREFLIGHTED"

export class AgentSpecPluginProjectionError extends Error {
  readonly code = AGENT_SPEC_PLUGIN_PROJECTION_ERROR_CODE

  constructor(message: string) {
    super(message)
    this.name = "AgentSpecPluginProjectionError"
  }
}

/**
 * Projects only Agent-site contributions from canonical artifacts that the app
 * resolver already imported and preflighted. It never discovers or loads a
 * package, so Workspace and fleet activation cannot grow separate machinery.
 */
export function projectAgentSpecPluginArtifacts(
  agent: AgentHostAgentSpec,
  artifacts: readonly ResolvedWorkspacePluginArtifact[],
): AgentSpecPluginArtifactProjection {
  const byId = new Map<string, ResolvedWorkspacePluginArtifact>()
  for (const artifact of artifacts) {
    if (byId.has(artifact.id)) {
      throw new AgentSpecPluginProjectionError(`duplicate resolved plugin artifact "${artifact.id}"`)
    }
    byId.set(artifact.id, artifact)
  }

  const requested = "legacyDefault" in agent ? [] : (agent.plugins ?? [])
  const selected: ResolvedWorkspacePluginArtifact[] = []
  const selectedIds = new Set<string>()
  for (const binding of requested) {
    if (selectedIds.has(binding.name)) {
      throw new AgentSpecPluginProjectionError(
        `agent "${agent.agentTypeId}" selects plugin "${binding.name}" more than once`,
      )
    }
    selectedIds.add(binding.name)
    const artifact = byId.get(binding.name)
    if (!artifact) {
      throw new AgentSpecPluginProjectionError(
        `agent "${agent.agentTypeId}" selects plugin "${binding.name}" without a preflighted artifact`,
      )
    }
    selected.push(artifact)
  }

  const projected = bootstrapServer({ plugins: selected.map((artifact) => artifact.plugin) })
  return {
    artifacts: selected,
    runtimePlugins: projected.runtimePlugins,
    agentOptions: {
      extraTools: projected.agentTools,
      systemPromptAppend: projected.systemPromptAppend || undefined,
      pi: {
        packages: projected.piPackages,
        extensionPaths: projected.extensionPaths,
      },
    },
  }
}

export interface WorkspaceAgentServerPluginCollection {
  /** Package artifacts admitted through the sole directory entry resolver. */
  resolvedPluginArtifacts: readonly ResolvedWorkspacePluginArtifact[]
  provisioningContributions: WorkspaceProvisioningContribution[]
  runtimePlugins: WorkspaceRuntimeProvisioningInput[]
  routeContributions: WorkspaceRouteContribution[]
  workspaceBridgeHandlers: WorkspaceServerPlugin["workspaceBridgeHandlers"]
  preservedUiStateKeys: string[]
  defaultPluginPackagePaths: string[]
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

export interface ResolveWorkspaceAgentServerPluginCollectionOptions
  extends Omit<CollectWorkspaceAgentServerPluginsOptions, "plugins"> {
  workspaceRoot: string
  bridge: ReturnType<typeof createInMemoryBridge>
  defaultPluginPackages?: string[]
  appRoot?: string
  plugins?: WorkspacePluginEntry[]
  trustedPluginContext?: WorkspaceAgentServerPluginContext["trusted"]
}

export function buildWorkspaceContextPrompt(options: { pluginAuthoringEnabled?: boolean } = {}): string {
  return [
    '## Workspace',
    '- Root: `$BORING_AGENT_WORKSPACE_ROOT` (exported into every bash invocation)',
    '- User workspace skills: `$BORING_AGENT_WORKSPACE_ROOT/.agents/skills/`',
    ...(options.pluginAuthoringEnabled
      ? [
          '- Generated plugin skills: `$BORING_AGENT_WORKSPACE_ROOT/.boring-agent/skills/` — readable with normal file tools',
          '- Runtime CLIs (`boring-ui-plugin`, `bm`, `python`, `pip`, `uv`) come from `.boring-agent/node`, `.boring-agent/venv`, and `.boring-agent/sdk/uv` and are already on PATH',
        ]
      : [
          '- Runtime CLIs (`bm`, `python`, `pip`, `uv`) come from `.boring-agent/node`, `.boring-agent/venv`, and `.boring-agent/sdk/uv` when provisioned',
          '- This public app does not expose Boring plugin creation or installation. If asked about Boring plugins, do not explain how to create/install them; say that this app does not expose that feature and continue with normal workspace tasks.',
        ]),
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
    resolvedPluginArtifacts: [],
    provisioningContributions: [
      ...builtinProvisioningContributions,
      ...result.provisioningContributions,
    ],
    runtimePlugins: [
      ...builtinProvisioningContributions,
      ...result.runtimePlugins,
    ],
    routeContributions: result.routeContributions,
    workspaceBridgeHandlers: result.workspaceBridgeHandlers,
    preservedUiStateKeys: result.preservedUiStateKeys,
    defaultPluginPackagePaths: [],
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

export async function resolveWorkspaceAgentServerPluginCollection(
  opts: ResolveWorkspaceAgentServerPluginCollectionOptions,
): Promise<WorkspaceAgentServerPluginCollection> {
  const baseCtx: WorkspaceAgentServerPluginContext = { workspaceRoot: opts.workspaceRoot, bridge: opts.bridge }
  const trustedCtx: WorkspaceAgentServerPluginContext = { ...baseCtx, trusted: opts.trustedPluginContext }
  const defaultPluginPackagePaths = resolveDefaultWorkspacePluginPackagePaths({
    workspaceRoot: opts.workspaceRoot,
    defaultPluginPackages: opts.defaultPluginPackages,
    anchorDir: opts.appRoot,
  })
  const defaultPluginDirEntries: WorkspacePluginEntry[] = defaultPluginPackagePaths
    .map((dir) => ({ dir, hotReload: true, trust: "internal" as const }))
    .filter((entry) => hasDirServerPlugin(entry))
  const allPluginEntries: WorkspacePluginEntry[] = []
  const seenDirEntries = new Set<string>()
  for (const entry of [...defaultPluginDirEntries, ...(opts.plugins ?? [])]) {
    if ("dir" in entry) {
      const key = resolve(entry.dir)
      if (seenDirEntries.has(key)) continue
      seenDirEntries.add(key)
    }
    allPluginEntries.push(entry)
  }
  const resolvedPluginArtifacts = await Promise.all(
    allPluginEntries.map(async (entry): Promise<ResolvedWorkspacePluginArtifact> => {
      const plugin = await resolveOnePluginEntry<WorkspaceServerPlugin>(
        entry,
        "dir" in entry && entry.trust === "internal" ? trustedCtx : baseCtx,
      )
      assertWorkspaceBridgeHandlersTrusted(plugin, entry)
      return {
        id: plugin.id,
        contentDigest: resolvedArtifactContentDigest(entry, plugin),
        plugin,
        entry,
      }
    }),
  )
  const collection = collectWorkspaceAgentServerPlugins({
    ...opts,
    plugins: resolvedPluginArtifacts.map((artifact) => artifact.plugin),
  })
  return { ...collection, resolvedPluginArtifacts, defaultPluginPackagePaths }
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
  externalPluginsEnabled = true,
): BoringPluginSource[] {
  const extensionPaths = pluginCollection.agentOptions.pi?.extensionPaths ?? []
  const pluginRoots = extensionPaths.flatMap((path) => {
    try {
      return [pluginRootFromExtensionPath(path)]
    } catch {
      return []
    }
  })
  const externalSources: BoringPluginSource[] = externalPluginsEnabled ? [
    { rootDir: join(workspaceRoot, ".pi", "extensions"), kind: "external", workspaceId: workspaceRoot },
    { rootDir: join(workspaceRoot, ".pi", "npm"), kind: "external", workspaceId: workspaceRoot },
    { rootDir: join(workspaceRoot, ".pi", "git"), kind: "external", workspaceId: workspaceRoot },
    { rootDir: join(homedir(), ".pi", "agent", "extensions"), kind: "external" },
    ...readPiSettingsBoringPluginSources(join(workspaceRoot, ".pi", "settings.json"), workspaceRoot),
    ...readPiSettingsBoringPluginSources(join(homedir(), ".pi", "agent", "settings.json")),
  ] : []
  return uniquePluginSources([
    ...externalSources,
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
  return `# Loaded app-provided context\n\n${prompts.join("\n\n")}`
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

function resolveWorkspaceBridgeBrowserAuthPolicy(
  opts: CreateWorkspaceAgentServerOptions,
  registry: WorkspaceBridgeRegistry,
): BridgeAuthPolicy | undefined {
  if (opts.workspaceBridge?.browserAuthPolicy) return opts.workspaceBridge.browserAuthPolicy

  if (opts.workspaceBridge?.allowInsecureLocalCliBrowserAuth !== true) return undefined

  emitLocalCliBridgeAuthWarning()
  return createLocalCliBridgeAuthPolicy({
    workspaceId: "default",
    capabilities: registry.listDefinitions().flatMap((definition) => [...definition.requiredCapabilities]),
    forceOwnerWorkspaceId: true,
  })
}

function emitLocalCliBridgeAuthWarning(): void {
  const message = "createWorkspaceAgentServer is using createLocalCliBridgeAuthPolicy for WorkspaceBridge browser calls. This policy is unauthenticated, grants registered bridge capabilities to a fixed local-cli principal, and is intended only for local/dev CLI usage. Provide workspaceBridge.browserAuthPolicy before exposing this server."
  if (typeof process.emitWarning === "function") {
    process.emitWarning(message, { code: "BORING_WORKSPACE_BRIDGE_INSECURE_AUTH" })
    return
  }
  console.warn(message)
}

export async function createWorkspaceAgentServer(
  opts: CreateWorkspaceAgentServerOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const readonlyWorkspacePolicy = opts.readonlyWorkspacePaths
    ? normalizeRuntimeReadonlyFilesystemPolicy(opts.readonlyWorkspacePaths)
    : undefined
  const bridge = createInMemoryBridge()
  const unregisterUiBridge = registerWorkspaceUiBridge(bridge)
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const modeAdapter = opts.runtimeModeAdapter ?? createSandboxRuntimeModeAdapter(
    resolvedMode as 'direct' | 'local' | 'vercel-sandbox',
  )
  const runtimeHost = opts.runtimeHost ?? modeAdapter.runtimeHost ?? sandboxRuntimeHostOperations
  const workspaceFsCapability = modeAdapter.workspaceFsCapability ?? "best-effort"
  const validateUiPaths = opts.validateUiPaths ?? workspaceFsCapability === "strong"
  const externalPluginsEnabled = opts.externalPlugins !== false
  const uiTools = createWorkspaceUiTools(bridge, {
    workspaceRoot: validateUiPaths ? workspaceRoot : undefined,
  })
  const pluginAuthoringEnabled = externalPluginsEnabled
    && (opts.installPluginAuthoring ?? workspaceFsCapability === "strong")
    && !(opts.excludeDefaults ?? []).includes("boring-ui-plugin-cli-package")
  let workspaceAgentDispatcherResolver: WorkspaceAgentDispatcherResolver | undefined
  const trustedDispatcherProxy: WorkspaceAgentDispatcherResolver = {
    async resolve(actor, options) {
      if (!workspaceAgentDispatcherResolver) throw new Error("workspace agent dispatcher is not ready")
      return await workspaceAgentDispatcherResolver.resolve(actor, options)
    },
  }
  const pluginCollection = await resolveWorkspaceAgentServerPluginCollection({
    trustedPluginContext: {
      workspaceAgentDispatcherResolver: trustedDispatcherProxy,
      actorResolver: () => ({ workspaceId: opts.sessionId ?? "default", userId: "local" }),
    },
    ...opts,
    workspaceRoot,
    bridge,
    installPluginAuthoring: pluginAuthoringEnabled,
  })
  const defaultPluginPackagePaths = pluginCollection.defaultPluginPackagePaths
  // Omitted fleets are the historical one-Agent composition. Keep its route
  // options byte-for-byte compatible; explicit fleets are scoped per Agent.
  const legacyGlobalPluginAgentContributions = opts.agents === undefined
  const ctx: WorkspaceAgentServerPluginContext = { workspaceRoot, bridge }
  const allPluginEntries: WorkspacePluginEntry[] = [
    ...defaultPluginPackagePaths
      .map((dir) => ({ dir, hotReload: true, trust: "internal" as const }))
      .filter((entry) => hasDirServerPlugin(entry)),
    ...(opts.plugins ?? []),
  ]

  const { registry: workspaceBridgeRegistry } = createWorkspaceBridgeRuntimeCore({
    registry: opts.workspaceBridge?.registry,
    ownerWorkspaceId: "default",
    handlers: [
      ...(opts.workspaceBridge?.handlers ?? []),
      ...(pluginCollection.workspaceBridgeHandlers ?? []),
    ],
  })

  // Static app resources are global to every Agent. Plugin Agent resources are
  // added later from the app-owned normalized contribution for that Agent.
  // Plugin package.json#pi resources remain dynamic for legacyDefault only.
  const workspacePackagePiPackage = pluginAuthoringEnabled ? createBoringPiPackageSource(workspaceRoot) : undefined
  const baseStaticPiSkillPaths = [
    ...(pluginAuthoringEnabled ? resolveBoringPiSkillPaths(workspaceRoot) : []),
    ...(legacyGlobalPluginAgentContributions
      ? pluginCollection.agentOptions.pi?.additionalSkillPaths ?? []
      : [join(workspaceRoot, ".agents", "skills"), ...(opts.pi?.additionalSkillPaths ?? [])]),
  ]
  const baseStaticPiPackages = [
    workspacePackagePiPackage,
    ...(legacyGlobalPluginAgentContributions
      ? pluginCollection.agentOptions.pi?.packages ?? []
      : opts.pi?.packages ?? []),
  ]
  const baseStaticPiExtensionPaths = legacyGlobalPluginAgentContributions
    ? pluginCollection.agentOptions.pi?.extensionPaths ?? []
    : opts.pi?.extensionPaths ?? []

  // Boring plugin discovery: scan external workspace/global extension
  // collections plus internal app/plugin-provided sources. Source kind is
  // explicit so later activation code does not infer trust from paths.
  const boringPluginDirs: BoringPluginSource[] = []
  const refreshBoringPluginDirs = (): BoringPluginSource[] => {
    const next = uniquePluginSources([
      ...defaultPluginPackagePaths.map((rootDir): BoringPluginSource => ({ rootDir, kind: "internal" })),
      ...collectBoringPluginSources(workspaceRoot, pluginCollection, opts.additionalBoringPluginDirs, externalPluginsEnabled),
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
  const runtimeWorkspaceRoot = modeAdapter.getRuntimeLayoutRoot?.({
    workspaceRoot,
    sessionId: opts.sessionId ?? DEFAULT_WORKSPACE_SCOPE_ID,
    workspaceId: opts.sessionId ?? DEFAULT_WORKSPACE_SCOPE_ID,
  }) ?? resolveBuiltinRuntimeLayoutRoot(
    resolvedMode as "direct" | "local" | "vercel-sandbox",
    workspaceRoot,
  )
  const runtimeLayout = runtimeHost.getBoringAgentRuntimePaths(runtimeWorkspaceRoot)
  type RuntimeProvisionerContext = Parameters<NonNullable<CreateAgentAppOptions["runtimeProvisioner"]>>[0]
  let liveRuntimeBundle: RuntimeProvisionerContext["runtimeBundle"] | undefined
  const runRuntimeProvisioning = async (runtimeBundle?: RuntimeProvisionerContext["runtimeBundle"]) => {
    if (opts.provisionWorkspace === false) return currentRuntimeProvisioning
    const provisioningContext = {
      workspaceRoot,
      sessionId: opts.sessionId ?? "default",
      workspaceId: opts.sessionId ?? "default",
    }
    let scopedRuntime: Awaited<ReturnType<typeof modeAdapter.create>> | undefined
    let operationError: unknown
    try {
      if (!runtimeBundle) scopedRuntime = await modeAdapter.create(provisioningContext)
      const adapter = runtimeBundle
        ? runtimeBundle.provisioningAdapter
        : scopedRuntime?.provisioningAdapter
      if (!adapter) return currentRuntimeProvisioning
      const provisioned = await provisionWorkspaceRuntime({
        plugins: buildRuntimeProvisioningInputs(),
        adapter,
        runtimeLayout,
        runtimeHost,
      })
      currentRuntimeProvisioning = provisioned ? {
        ...provisioned,
        env: {
          ...provisioned.env,
          BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS: workspaceFsCapability === "strong" ? "1" : "0",
        },
      } : currentRuntimeProvisioning
      return currentRuntimeProvisioning
    } catch (error) {
      operationError = error
      throw error
    } finally {
      try {
        await scopedRuntime?.disposeRuntime?.()
      } catch (error) {
        if (operationError === undefined) throw error
      }
    }
  }
  await runRuntimeProvisioning()

  // Rebuild closure created before Agent route projection so beforeReload can
  // call it.
  const rebuildPlugins = async (): Promise<PluginRebuildResult> => {
    return rebuildServerPlugins({ entries: allPluginEntries, ctx })
  }
  const callerRuntimeProvisioner = opts.runtimeProvisioner
  const boringUiCliCommandAvailable = opts.provisionWorkspace !== false && pluginCollection.provisioningContributions.some(
    (entry) => entry.id === "boring-ui-cli-package",
  )
  const workspaceBridgeRuntimeEnvContribution = createWorkspaceBridgeRuntimeEnvContribution({
    workspaceId: "default",
    runtimeMode: resolvedMode,
    registry: workspaceBridgeRegistry,
    runtimeTokenSecret: opts.workspaceBridge?.runtimeTokenSecret,
    runtimeRefreshTokenSecret: opts.workspaceBridge?.runtimeRefreshTokenSecret,
    runtimeEnv: opts.workspaceBridge?.runtimeEnv,
    runtimePlacement: workspaceFsCapability === "strong" ? "local" : "remote",
  })

  const workspaceScopeId = opts.sessionId ?? DEFAULT_WORKSPACE_SCOPE_ID
  const allowedWorkspaceSelectors = new Set([
    workspaceScopeId,
    basename(workspaceRoot),
  ].filter(Boolean))
  const agents = opts.agents ?? [{ agentTypeId: "default", legacyDefault: true } as const]
  const defaultAgentTypeId = opts.defaultAgentTypeId ?? "default"
  const allPluginAgentProjection = bootstrapServer({
    defaults: opts.defaults,
    plugins: pluginCollection.resolvedPluginArtifacts.map((artifact) => artifact.plugin),
    excludeDefaults: opts.excludeDefaults,
  })
  const normalizedRuntimeContributions = new Map<string, NormalizedAgentRuntimeContribution>()
  const fleetCompiler: AgentFleetCompiler = {
    async compile({ agents: fleet }) {
      const compiled = opts.fleetCompiler
        ? await opts.fleetCompiler.compile({ agents: fleet })
        : fleet
      return compiled.map((agent) => {
        const legacyDefault = "legacyDefault" in agent
        const projection = legacyDefault
          ? {
              artifacts: pluginCollection.resolvedPluginArtifacts,
              runtimePlugins: legacyGlobalPluginAgentContributions ? [] : allPluginAgentProjection.runtimePlugins,
              agentOptions: legacyGlobalPluginAgentContributions
                ? { extraTools: [], systemPromptAppend: undefined, pi: {} }
                : {
                    extraTools: allPluginAgentProjection.agentTools,
                    systemPromptAppend: allPluginAgentProjection.systemPromptAppend || undefined,
                    pi: {
                      packages: allPluginAgentProjection.piPackages,
                      extensionPaths: allPluginAgentProjection.extensionPaths,
                    },
                  },
            }
          : projectAgentSpecPluginArtifacts(agent, pluginCollection.resolvedPluginArtifacts)
        const pluginIds = projection.artifacts.map((artifact) => artifact.id)
        const resolvedPolicy = {
          ...("resolvedPolicy" in agent && agent.resolvedPolicy && typeof agent.resolvedPolicy === "object"
            ? agent.resolvedPolicy as Readonly<Record<string, unknown>>
            : {}),
          pluginIds,
        }
        const includeAllDiscoveredPluginResources = legacyDefault && !legacyGlobalPluginAgentContributions
        normalizedRuntimeContributions.set(agent.agentTypeId, {
          ...agentRuntimeContributionIdentityInput({
            agent,
            resolvedPolicy,
            projection,
            includeAllDiscoveredPluginResources,
          }),
          runtimePlugins: projection.runtimePlugins,
          agentOptions: projection.agentOptions,
          includeAllDiscoveredPluginResources,
        })
        return { ...agent, resolvedPolicy }
      })
    },
  }
  const scopeIssuer = createWorkspaceAgentScopeIssuer(workspaceScopeId)
  const agentHost = await createAgentHost({
    agents,
    fleetCompiler,
    hostId: "workspace-agent-host",
    scopeVerifier: scopeIssuer.verifier,
    runtimeModeAdapter: modeAdapter,
    runtimeHost,
    sessionRoot: opts.sessionRoot,
    telemetry: opts.telemetry,
    metering: opts.metering,
    harnessFactory: opts.harnessFactory,
    ...(opts.admitEffect
      ? {
          effectAdmission: {
            async admit({ key, scope }) {
              await opts.admitEffect!({
                workspaceId: scope.workspaceScopeId,
                requestId: key.requestId,
              })
              return {
                type: "accepted" as const,
                admissionReceipt: `workspace-legacy:${scope.workspaceScopeId}:${key.requestId}`,
              }
            },
          },
        }
      : {}),
    async resolveRuntimeScope({ agentTypeId, scope }) {
      const base = scopeIssuer.context(scope)
      const contribution = normalizedRuntimeContributions.get(agentTypeId)
      if (!contribution) throw new Error(`Agent runtime contribution was not compiled: ${agentTypeId}`)

      const selectedSkillPaths = contribution.runtimePlugins.flatMap((plugin) =>
        (plugin.skills ?? []).map((skill) => join(runtimeLayout.skills, plugin.id, skill.name)),
      )
      const basePi = base.pi ?? {}
      const selectedPi = contribution.agentOptions.pi
      const baseBindingInputs = jsonIdentityValue({
        systemPromptAppend: base.systemPromptAppend ?? null,
        piHarnessPolicy: {
          noContextFiles: basePi.noContextFiles ?? null,
          noSkills: basePi.noSkills ?? null,
        },
        toolContractOrder: (base.extraTools ?? []).map(toolContractDigest),
      }, "baseRuntimeBindingInputs")
      const getBaseHotResources = basePi.getHotReloadableResources
      const getHotReloadableResources = getBaseHotResources
        || selectedSkillPaths.length > 0
        || contribution.includeAllDiscoveredPluginResources
        ? () => {
            const baseHot = getBaseHotResources?.() ?? {}
            const discovered = contribution.includeAllDiscoveredPluginResources
              ? getHotReloadablePiResources()
              : emptyPackageJsonPiSnapshot()
            const baseSkillPaths = (baseHot.additionalSkillPaths ?? []).filter((path) =>
              contribution.includeAllDiscoveredPluginResources || path !== runtimeLayout.skills,
            )
            return {
              ...baseHot,
              ...discovered,
              additionalSkillPaths: uniqueStrings([
                ...baseSkillPaths,
                ...selectedSkillPaths,
                ...discovered.additionalSkillPaths,
              ]),
              packages: compactPiPackages([
                ...(baseHot.packages ?? []),
                ...discovered.packages,
              ]),
              extensionPaths: uniqueStrings([
                ...(baseHot.extensionPaths ?? []),
                ...discovered.extensionPaths,
              ]),
            }
          }
        : undefined
      const baseDynamicPrompt = base.loadSystemPromptAppend
      const loadSystemPromptAppend = baseDynamicPrompt || contribution.includeAllDiscoveredPluginResources
        ? async () => [
            await baseDynamicPrompt?.(),
            contribution.includeAllDiscoveredPluginResources ? aggregatePluginPrompts(boringAssetManager) : undefined,
          ].filter((part): part is string => Boolean(part)).join("\n\n") || undefined
        : undefined

      return {
        ...base,
        identity: createResolvedRuntimeScopeIdentity({
          artifacts: contribution.artifacts,
          validatedConfig: contribution.validatedConfig,
          grants: contribution.grants,
          placementIdentity: base.environment.placementIdentity,
          isolationMode: resolvedMode,
          toolContractDigests: contribution.toolContractDigests,
          provisioningGeneration: base.environment.provisioningFingerprint,
          bindingInputs: {
            baseRuntimeScopeIdentity: base.identity,
            environmentProvisioningFingerprint: base.environment.provisioningFingerprint,
            sessionNamespace: base.sessionNamespace,
            readonlyWorkspacePolicyRevision: readonlyWorkspacePolicy?.revision ?? null,
            base: baseBindingInputs,
            contribution: contribution.bindingInputs,
          },
        }),
        pi: {
          ...basePi,
          ...selectedPi,
          additionalSkillPaths: uniqueStrings([
            ...(basePi.additionalSkillPaths ?? []),
            ...(selectedPi?.additionalSkillPaths ?? []),
          ]),
          packages: compactPiPackages([
            ...(basePi.packages ?? []),
            ...(selectedPi?.packages ?? []),
          ]),
          extensionPaths: uniqueStrings([
            ...(basePi.extensionPaths ?? []),
            ...(selectedPi?.extensionPaths ?? []),
          ]),
          ...(getHotReloadableResources ? { getHotReloadableResources } : {}),
        },
        extraTools: [
          ...(base.extraTools ?? []),
          ...(contribution.agentOptions.extraTools ?? []),
        ],
        systemPromptAppend: [base.systemPromptAppend, contribution.agentOptions.systemPromptAppend]
          .filter((part): part is string => Boolean(part))
          .join("\n\n") || undefined,
        loadSystemPromptAppend,
      }
    },
  })
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  app.addHook("onRequest", createAgentAuthMiddleware({
    authToken: opts.authToken,
    workspaceId: workspaceScopeId,
    publicPaths: ["/health", "/ready", "/api/v1/ready-status"],
  }))
  app.addHook("onRequest", async (request, reply) => {
    if (reply.sent) return
    try {
      trustedWorkspaceScopeId(request, workspaceScopeId, allowedWorkspaceSelectors)
    } catch (error) {
      return reply.code(403).send({
        error: {
          code: "WORKSPACE_UNINITIALIZED",
          message: error instanceof Error ? error.message : "workspace scope failed",
        },
      })
    }
  })
  try {
    await app.register(registerAgentRoutes, {
    ...opts,
    agentHost: {
      created: agentHost,
      defaultAgentTypeId,
      issueScope: scopeIssuer.issue,
    },
    onWorkspaceAgentDispatcher: (resolver) => {
      workspaceAgentDispatcherResolver = resolver
      opts.onWorkspaceAgentDispatcher?.(resolver)
    },
    mode: resolvedMode,
    runtimeModeAdapter: modeAdapter,
    runtimeHost,
    readonlyWorkspacePolicy,
    getWorkspaceId: async (request) => trustedWorkspaceScopeId(
      request,
      workspaceScopeId,
      allowedWorkspaceSelectors,
    ),
    provisionRuntime: async (context) => {
      liveRuntimeBundle = context.runtimeBundle
      await callerRuntimeProvisioner?.({
        workspaceRoot: context.workspaceRoot,
        runtimeMode: context.runtimeMode,
        runtimeBundle: context.runtimeBundle,
      })
      return currentRuntimeProvisioning
    },
    workspaceRoot,
    externalPlugins: externalPluginsEnabled,
    runtimeEnvContributions: [
      ...(opts.runtimeEnvContributions ?? []),
      ...(workspaceBridgeRuntimeEnvContribution ? [workspaceBridgeRuntimeEnvContribution] : []),
    ],
    extraTools: [
      ...(opts.extraTools ?? []),
      ...uiTools,
      ...(legacyGlobalPluginAgentContributions ? pluginCollection.agentOptions.extraTools ?? [] : []),
    ],
    systemPromptAppend: [
      workspaceFsCapability === "strong" ? buildWorkspaceContextPrompt({ pluginAuthoringEnabled }) : undefined,
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
      legacyGlobalPluginAgentContributions
        ? pluginCollection.agentOptions.systemPromptAppend
        : opts.systemPromptAppend,
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
      await runRuntimeProvisioning(liveRuntimeBundle)
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
    getPluginDiagnostics: async () => [
      ...boringAssetManager.getErrors().map((error) => ({
        source: "plugin-load",
        message: error.message,
        ...(error.id ? { pluginId: error.id } : {}),
      })),
      ...boringAssetManager.preflight().errors.map((error) => ({
        source: "plugin-preflight",
        message: `${error.code}: ${error.message} (${error.pluginDir})`,
        ...(error.pluginId ? { pluginId: error.pluginId } : {}),
      })),
    ],
    pi: {
      ...(legacyGlobalPluginAgentContributions ? pluginCollection.agentOptions.pi : opts.pi),
      additionalSkillPaths: staticPiSkillPaths,
      packages: staticPiPackages,
      extensionPaths: staticPiExtensionPaths,
      extensionFactories: opts.pi?.extensionFactories,
      ...(legacyGlobalPluginAgentContributions
        ? { getHotReloadableResources: getHotReloadablePiResources }
        : {}),
    },
    systemPromptDynamic: legacyGlobalPluginAgentContributions
      ? () => aggregatePluginPrompts(boringAssetManager)
      : opts.systemPromptDynamic,
    })
  } catch (error) {
    try { await app.close() } catch {}
    try { await agentHost.host.close() } catch {}
    throw error
  }
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
  await app.register(workspaceBridgeHttpRoutes, {
    registry: workspaceBridgeRegistry,
    runtimeTokenSecret: opts.workspaceBridge?.runtimeTokenSecret,
    runtimeRefreshTokenSecret: opts.workspaceBridge?.runtimeRefreshTokenSecret,
    ownerWorkspaceId: "default",
    idempotencyStore: new InMemoryWorkspaceBridgeIdempotencyStore(),
    browserAuthPolicy: resolveWorkspaceBridgeBrowserAuthPolicy(opts, workspaceBridgeRegistry),
  })
  // Internal handles exposed on the Fastify instance for external callers /
  // tests (e.g. the CLI reads __boringAssetManager). The rebuild closure is
  // also wired into `beforeReload` so /reload triggers it automatically.
  interface BoringWorkspaceInternals {
    __boringWorkspaceBridgeRegistry?: WorkspaceBridgeRegistry
    __boringRebuildPlugins?: () => Promise<PluginRebuildResult>
    __boringAssetManager?: BoringPluginAssetManager
    __boringRuntimeBackendRegistry?: RuntimeBackendRegistry
  }
  const internals = app as FastifyInstance & BoringWorkspaceInternals
  internals.__boringWorkspaceBridgeRegistry = workspaceBridgeRegistry
  internals.__boringRebuildPlugins = rebuildPlugins
  internals.__boringAssetManager = boringAssetManager
  internals.__boringRuntimeBackendRegistry = runtimeBackendRegistry

  await app.register(boringPluginRoutes, {
    manager: boringAssetManager,
  })
  await app.register(runtimeBackendGateway, { registry: runtimeBackendRegistry, defaultWorkspaceId: workspaceRoot })
  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }

  return app
}
