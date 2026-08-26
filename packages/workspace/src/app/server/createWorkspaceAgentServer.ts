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
  createPiResourceDigestFence,
  createPiResourceDigestInput,
  createResolvedRuntimeScopeIdentity,
  createSandboxRuntimeModeAdapter,
  createUserFilesystemBinding,
  DEFAULT_READONLY_WORKSPACE_PATHS,
  createValidatingAgentFleetCompiler,
  digestPiResourceInputs,
  mergeRuntimeFilesystemBindings,
  normalizeRuntimeReadonlyFilesystemPolicy,
  provisionRuntimeWorkspace,
  provisionWorkspaceRuntime,
  projectAuthorizedSessionRunDetails,
  registerAgentHostEnvironmentRoutes,
  resolveRequestLedgerPath,
  sandboxRuntimeHostOperations,
  withRuntimeEnvContributions,
  type AgentFleetCompiler,
  type AgentHostEnvironmentLease,
  type AgentHostEnvironmentScope,
  type AgentHostAgentSpec,
  type AuthorizedAgentScope,
  type AgentHarnessFactory,
  type AgentMeteringSink,
  type AgentRuntimeHostOperations,
  type PiExtensionFactory,
  type ProvisionWorkspaceRuntimeOptions,
  type ResolvedAgentRuntimeScope,
  type RuntimeBundle,
  type RuntimeEnvContribution,
  type RuntimeFilesystemBinding,
  RuntimeReadonlyFilesystemPolicyError,
  type RuntimeModeAdapter,
  type RuntimeModeId,
  type VerifiedAgentScopeClaim,
  type WorkspaceProvisioningResult,
  type WorkspaceAgentDispatcherResolver,
  resolveDefaultAgentFleet,
} from "@hachej/boring-agent/server"
import type { AgentEffectAdmission } from "@hachej/boring-agent/core"
import {
  AGENT_RESOURCES_FILESYSTEM_ID,
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentTool,
  type TelemetrySink,
} from "@hachej/boring-agent/shared"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { buildBoringSystemPrompt } from "../../server/boringSystemPrompt"
import { BoringPluginAssetManager } from "../../server/agentPlugins/manager"
import { discoverRepositoryAgentPackages } from "../../server/agentPlugins/discoverAgentPackages"
import { PLUGIN_SIGNATURE_CACHE_FILE } from "../../server/agentPlugins/signatureCache"
import type { BoringPluginFrontTargetResolver, BoringPluginSource, BoringPluginSourceInput } from "../../server/agentPlugins/types"
import { aggregatePluginPrompts } from "../../server/agentPlugins/aggregatePluginPrompts"
import { boringPluginRoutes, collectRestartWarnings } from "../../server/agentPlugins/routes"
import { RuntimeBackendRegistry, runtimeBackendGateway } from "../../server/runtimeBackend"
import { normalizeBoringPluginPiPackages } from "../../server/agentPlugins/piPackages"
import {
  readPiSettingsBoringPluginSources,
  readPiSettingsLocalAgentPackageSources,
  uniqueBoringPluginSources,
} from "../../server/agentPlugins/settingsSources"
export { readPiSettingsBoringPluginSources } from "../../server/agentPlugins/settingsSources"
import {
  assertWorkspaceBridgeHandlersTrusted,
  hasDirServerPlugin,
  resolveOnePluginEntry,
  type DirPluginEntry,
} from "./pluginEntryResolver"
import { rebuildServerPlugins, type PluginRebuildResult } from "./rebuildServerPlugins"
import { resolveDefaultWorkspacePluginPackagePaths } from "./defaultPluginPackages"
export {
  createPiResourceDigestInput as createWorkspacePiResourceDigestInput,
  digestPiResourceInputs as digestWorkspacePiResourceInputs,
} from "@hachej/boring-agent/server"
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
  type WorkspacePackageResourceRecord,
  type WorkspacePiPackageSource,
  type WorkspaceServerPlugin,
  type WorkspaceAgentReloadBlocker,
  type WorkspaceProvisioningContribution,
  type WorkspaceRouteContribution,
} from "../../server/plugins/bootstrapServer"
import {
  discoverPackageResourceRecords,
  enumerateExternalSkillFiles,
  packageResourceHandlesPath,
  resolveWorkspacePackageResourceSnapshot,
  selectAgentPackageResourceView,
  type ResolvedWorkspacePackageResourceRegistry,
} from "../../server/plugins/packageResources"

type HostExtensionFactory = PiExtensionFactory

interface WorkspacePiSessionRequestContext {
  workspaceId?: string
  storageScope?: string
  authSubject?: string
  authEmail?: string
  authEmailVerified?: boolean
  sessionAuthority?: "workspace-scope"
  requestId: string
}

type WorkspacePiSessionRequestContextResolver = (
  request: FastifyRequest,
  defaultContext: WorkspacePiSessionRequestContext,
) => WorkspacePiSessionRequestContext | Promise<WorkspacePiSessionRequestContext>

interface WorkspaceReloadHookResult {
  restart_warnings?: ReadonlyArray<{ id: string; surfaces: string[]; message: string }>
  diagnostics?: ReadonlyArray<{ source: string; message: string; pluginId?: string }>
}

export interface WorkspaceAgentPiOptions {
  noContextFiles?: boolean
  noSkills?: boolean
  additionalSkillPaths?: string[]
  packages?: WorkspacePiPackageSource[]
  extensionPaths?: string[]
  extensionFactories?: HostExtensionFactory[]
}

export interface WorkspaceAgentCreateOptions {
  workspaceRoot?: string
  sessionId?: string
  mode?: RuntimeModeId
  runtimeModeAdapter?: RuntimeModeAdapter
  runtimeHost?: AgentRuntimeHostOperations
  authToken?: string
  logger?: boolean
  extraTools?: AgentTool[]
  disableDefaultFileTools?: boolean
  systemPromptAppend?: string
  harnessFactory?: AgentHarnessFactory
  pi?: WorkspaceAgentPiOptions
  runtimeProvisioning?: WorkspaceProvisioningResult
  telemetry?: TelemetrySink
  metering?: AgentMeteringSink
  /**
   * Workspace-relative prefixes in the primary user filesystem that cannot be
   * mutated. Defaults to {@link DEFAULT_READONLY_WORKSPACE_PATHS} (`['.agents']`);
   * pass an explicit empty array to opt out entirely.
   */
  readonlyWorkspacePaths?: readonly string[]
  getFilesystemBindings?: (ctx: {
    request?: FastifyRequest
    workspaceId: string
    workspaceRoot: string
    sessionId?: string
    userId?: string
    userEmail?: string
    userEmailVerified?: boolean
    requestId?: string
  }) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
  resolvePiSessionRequestContext?: WorkspacePiSessionRequestContextResolver
  runtimeEnvContributions?: RuntimeEnvContribution[]
  runtimeProvisioner?: (ctx: {
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    runtimeBundle: RuntimeBundle
  }) => Promise<void>
  sessionRoot?: string
  /**
   * Durable request ledger file. Host application state, not workspace content:
   * point it at host-owned storage. Defaults per
   * {@link resolveRequestLedgerPath}.
   */
  requestLedgerPath?: string
  externalPlugins?: boolean
  /** Independently trusted roots for configured Pi resources outside the workspace/plugin roots. */
  piResourceAuthorizedRoots?: string[]
  beforeReload?: () => void | WorkspaceReloadHookResult | undefined | Promise<void | WorkspaceReloadHookResult | undefined>
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
  onWorkspaceAgentDispatcher?: (resolver: WorkspaceAgentDispatcherResolver) => void
}

export interface WorkspaceAgentServerPluginContext {
  workspaceRoot: string
  bridge: ReturnType<typeof createInMemoryBridge>
  /** Host-selected Agent owner for package-level server plugin actions. */
  agentTypeId?: string
  /** Agent addresses registered by the host and available for dispatch. */
  availableAgentTypeIds?: readonly string[]
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
  /** Trusted deployment fleet. Omission preserves the standalone default Agent. */
  agents?: readonly AgentHostAgentSpec[]
  /**
   * Repository root used to resolve `.agents/{personas,factory}` when
   * `BORING_AGENT_FLEET=1` composes the fleet and `agents` is not supplied.
   * Defaults to `process.cwd()`.
   */
  fleetRepositoryRoot?: string
  /** App-owned trust compiler for configured Agent plugin/model bindings. */
  fleetCompiler?: AgentFleetCompiler
  /** Default Agent selected for package-level server plugin ownership. */
  defaultAgentTypeId?: string
  /**
   * Compose app-declared default plugin Agent contributions into every Agent
   * in the workspace. This is intentionally limited to `defaultPluginPackages`:
   * arbitrary host plugins and workspace-local packages still require an
   * explicit per-Agent binding.
   */
  workspaceScopedDefaultPluginAgentContributions?: boolean
  /** Optional host admission called immediately before each Agent effect. */
  admitEffect?: AgentEffectAdmission
  /**
   * Host-installed server plugins. Accepts pre-built `WorkspaceServerPlugin`
   * objects or `{ dir, options?, hotReload?, trust? }` directory-source entries.
   * Directory entries may contribute privileged `workspaceBridgeHandlers` only
   * when explicitly marked `trust: "internal"`.
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
  }): AuthorizedAgentScope
  context(scope: AuthorizedAgentScope): VerifiedAgentScopeClaim
  verifier: {
    verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim>
  }
}

/** App-owned, provenance-checked issuer for the standalone Workspace scope. */
function createWorkspaceAgentScopeIssuer(workspaceScopeId: string): WorkspaceAgentScopeIssuer {
  const contexts = new WeakMap<object, VerifiedAgentScopeClaim>()
  const issue = ({ claim }: {
    claim: VerifiedAgentScopeClaim
  }): AuthorizedAgentScope => {
    if (claim.workspaceScopeId !== workspaceScopeId) {
      throw Object.assign(new Error("workspace scope is not allowed"), {
        code: "AGENT_SCOPE_DENIED",
        statusCode: 403,
      })
    }
    const scope = Object.freeze({ ...claim }) as AuthorizedAgentScope
    contexts.set(scope as object, Object.freeze({ ...claim }))
    return scope
  }
  return {
    issue,
    context(scope) {
      const claim = contexts.get(scope as object)
      if (!claim) throw new Error("agent scope was not issued by this Workspace")
      return claim
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
  const pathname = request.url.split("?", 1)[0] ?? request.url
  const rawFileWorkspaceSelector = pathname === "/api/v1/files/raw"
    && request.query
    && typeof request.query === "object"
    && "workspaceId" in request.query
    ? (request.query as { workspaceId?: unknown }).workspaceId
    : undefined
  // x-boring-storage-scope may be a per-agent-scoped compound value
  // (`${workspaceScopeId}:${agentTypeId}`, see WorkspaceAgentFront.tsx's
  // `sessionStorageScope` for the fleet agent selector, gh-1106) rather than
  // a bare workspace scope id. Only the portion before the first `:` is the
  // actual workspace/storage selector that needs to match; the suffix is
  // client-side namespacing and isn't a security boundary here.
  const storageScopeHeader = request.headers["x-boring-storage-scope"]
  const normalizedStorageScope = typeof storageScopeHeader === "string"
    ? storageScopeHeader.split(":", 1)[0]
    : storageScopeHeader
  const selectors = [
    request.headers["x-boring-workspace-id"],
    normalizedStorageScope,
    rawFileWorkspaceSelector,
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

function isUsableBoringPiPackageRoot(candidate: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: unknown }
    return pkg.name === "@hachej/boring-pi"
      && existsSync(join(candidate, "skills", "boring-plugin-authoring", "SKILL.md"))
  } catch {
    return false
  }
}

function resolveBoringPiPackageRoot(): string | null {
  const workspacePackageRoot = resolveWorkspacePackageRoot()
  const candidates = [
    join(workspacePackageRoot, "..", "pi"),
    join(workspacePackageRoot, "node_modules", "@hachej", "boring-pi"),
  ]
  for (const candidate of candidates) {
    if (isUsableBoringPiPackageRoot(candidate)) return candidate
  }
  try {
    const resolved = dirname(require.resolve("@hachej/boring-pi/package.json"))
    return isUsableBoringPiPackageRoot(resolved) ? resolved : null
  } catch {
    return null
  }
}

// 0.1.101 interim (see #848): boring-pi is OPTIONAL again — it has never been
// published to npm, so a hard requirement would crash every published install.
// 0.1.102 retires the package entirely (content moves to the plugin CLI).

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

function createBoringPiPackageSource(): WorkspacePiPackageSource | undefined {
  // The Pi runtime is part of the host's trusted computing base. Resolving it
  // from the opened workspace would let that workspace substitute executable
  // host code and, in pnpm projects, selects a symlink rejected by the resource
  // containment guard. Only the host installation is consulted; absence is
  // tolerated (published installs never carried this package — see #848).
  const source = resolveBoringPiPackageRoot()
  if (!source) return undefined
  return {
    source,
    skills: ["skills/boring-plugin-authoring"],
  }
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
export function resolveBoringPiSkillPaths(_workspaceRoot?: string): string[] {
  const root = resolveBoringPiPackageRoot()
  if (!root) return []
  return [join(root, "skills", "boring-plugin-authoring", "SKILL.md")]
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
  /** Preserves legacy standalone plugin/tool ordering for the default Agent composition. */
  readonly legacyStandaloneComposition: boolean
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
    || plugin.packageResources?.length
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
  workspaceScopedArtifacts: readonly ResolvedWorkspacePluginArtifact[] = [],
  defaultPlugins: Pick<ServerBootstrapOptions, "defaults" | "excludeDefaults"> = {},
): AgentSpecPluginArtifactProjection {
  const byId = new Map<string, ResolvedWorkspacePluginArtifact>()
  for (const artifact of artifacts) {
    if (byId.has(artifact.id)) {
      throw new AgentSpecPluginProjectionError(`duplicate resolved plugin artifact "${artifact.id}"`)
    }
    byId.set(artifact.id, artifact)
  }

  const selectAll = "legacyDefault" in agent
  const requested = selectAll ? [] : (agent.plugins ?? [])
  const selected: ResolvedWorkspacePluginArtifact[] = selectAll ? [...artifacts] : []
  const selectedIds = new Set(selected.map((artifact) => artifact.id))
  const workspaceScopedIds = new Set(workspaceScopedArtifacts.map((artifact) => artifact.id))
  const requestedIds = new Set<string>()
  for (const artifact of selectAll ? [] : workspaceScopedArtifacts) {
    if (selectedIds.has(artifact.id)) continue
    const canonical = byId.get(artifact.id)
    if (!canonical) {
      throw new AgentSpecPluginProjectionError(
        `agent "${agent.agentTypeId}" receives workspace-scoped plugin "${artifact.id}" without a preflighted artifact`,
      )
    }
    selectedIds.add(artifact.id)
    selected.push(canonical)
  }
  for (const binding of requested) {
    if (requestedIds.has(binding.name)) {
      throw new AgentSpecPluginProjectionError(`agent "${agent.agentTypeId}" selects plugin "${binding.name}" more than once`)
    }
    requestedIds.add(binding.name)
    if (workspaceScopedIds.has(binding.name)) continue
    selectedIds.add(binding.name)
    const artifact = byId.get(binding.name)
    if (!artifact) {
      throw new AgentSpecPluginProjectionError(
        `agent "${agent.agentTypeId}" selects plugin "${binding.name}" without a preflighted artifact`,
      )
    }
    selected.push(artifact)
  }

  const projected = bootstrapServer({
    ...(selectAll ? defaultPlugins : {}),
    plugins: selected.map((artifact) => artifact.plugin),
  })
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
  packageResources: WorkspacePackageResourceRecord[]
  routeContributions: WorkspaceRouteContribution[]
  agentReloadBlockers: WorkspaceAgentReloadBlocker[]
  workspaceBridgeHandlers: WorkspaceServerPlugin["workspaceBridgeHandlers"]
  preservedUiStateKeys: string[]
  defaultPluginPackagePaths: string[]
  agentOptions: Pick<
    WorkspaceAgentCreateOptions,
    "extraTools" | "systemPromptAppend" | "pi"
  >
}

async function assertAgentReloadAvailable(blockers: readonly WorkspaceAgentReloadBlocker[]): Promise<void> {
  for (const blocker of blockers) {
    const block = await blocker.getBlock()
    if (!block) continue
    if (typeof block.code !== "string" || !block.code || typeof block.message !== "string" || !block.message) {
      throw new Error(`server plugin "${blocker.id}": getAgentReloadBlock returned an invalid block`)
    }
    throw new AgentGatewayError(
      AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
      block.message,
      { blockerCode: block.code, pluginId: blocker.id },
    )
  }
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
  agentTypeId?: string
  availableAgentTypeIds?: readonly string[]
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
    packageResources: result.packageResources,
    routeContributions: result.routeContributions,
    agentReloadBlockers: result.agentReloadBlockers,
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
  const baseCtx: WorkspaceAgentServerPluginContext = {
    workspaceRoot: opts.workspaceRoot,
    bridge: opts.bridge,
    ...(opts.agentTypeId ? { agentTypeId: opts.agentTypeId } : {}),
    ...(opts.availableAgentTypeIds ? { availableAgentTypeIds: opts.availableAgentTypeIds } : {}),
  }
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
  // Explicit host entries take precedence over matching package defaults so a
  // host can configure a bundled plugin without activating it twice.
  for (const entry of [...(opts.plugins ?? []), ...defaultPluginDirEntries]) {
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
  return uniqueBoringPluginSources([
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

function mergePromptContents(values: readonly (string | undefined)[]): string | undefined {
  const normalized = values.flatMap((value) => value
    ? value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
    : [])
  const unique = [...new Set(normalized)]
  return unique.length > 0 ? unique.join("\n\n") : undefined
}

function localPiPackageRoot(source: WorkspacePiPackageSource | undefined): string | undefined {
  if (!source) return undefined
  const value = typeof source === "string" ? source : source.source
  const candidate = value.startsWith("file:") ? value.slice("file:".length) : value
  return isAbsolute(candidate) || candidate.startsWith(".") ? resolve(candidate) : undefined
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

function authenticatedRequestUserId(request: FastifyRequest): string | undefined {
  const id = (request as FastifyRequest & { user?: { id?: unknown } | null }).user?.id
  return typeof id === "string" && id.length > 0 ? id : undefined
}

function isAgentSessionRequest(request: FastifyRequest): boolean {
  const pathname = request.url.split("?", 1)[0] ?? request.url
  return /^\/api\/v1\/agents\/[^/]+\/sessions(?:\/|$)/.test(pathname)
}

function registerWorkspaceHealthRoutes(
  app: FastifyInstance,
  getEnvironmentReadiness: (request: FastifyRequest) => Promise<AgentHostEnvironmentLease>,
): void {
  const startedAt = Date.now()
  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0-dev",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  }))
  app.get("/ready", async (request, reply) => {
    let lease: AgentHostEnvironmentLease | undefined
    try {
      lease = await getEnvironmentReadiness(request)
      // This endpoint reports application/Environment readiness. Chat belongs
      // to an Agent binding and may remain `not-started` until the first
      // addressed Agent request; it must not keep an otherwise-ready Workspace
      // deployment out of service.
      const capabilities = [lease.readiness.workspace, lease.readiness.runtimeDependencies]
      const failed = capabilities.find((capability) => capability.state === "failed")
      if (failed) {
        return reply.code(503).send({ status: "degraded", reason: failed.message ?? "runtime provisioning failed" })
      }
      if (capabilities.some((capability) => capability.state !== "ready")) {
        return reply.code(503).send({ status: "provisioning", retryAfter: 2 })
      }
      return { status: "ready" }
    } catch (error) {
      return reply.code(503).send({
        status: "degraded",
        reason: error instanceof Error ? error.message : "runtime provisioning failed",
      })
    } finally {
      lease?.release()
    }
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
  // Protection is on by default: an omitted option must not silently disable
  // `.agents` enforcement. Only an explicit empty array opts out.
  const resolvedReadonlyWorkspacePaths = opts.readonlyWorkspacePaths ?? DEFAULT_READONLY_WORKSPACE_PATHS
  const readonlyWorkspacePolicy = resolvedReadonlyWorkspacePaths.length > 0
    ? normalizeRuntimeReadonlyFilesystemPolicy(resolvedReadonlyWorkspacePaths)
    : undefined
  // Everything fleet-related stays behind the flag check, including the
  // `process.cwd()` fallback: with BORING_AGENT_FLEET unset this seam must do
  // no eager work at all (gh-1107 slice 1 fix round: flag-off purity).
  const fleetEnabled = !opts.agents && process.env.BORING_AGENT_FLEET === '1'
  const fleetRepositoryRoot = fleetEnabled ? opts.fleetRepositoryRoot ?? process.cwd() : undefined
  const fleetLocalPackageSources = fleetEnabled && opts.externalPlugins !== false
    ? readPiSettingsLocalAgentPackageSources(join(workspaceRoot, '.pi', 'settings.json'), workspaceRoot)
    : []
  const discoveredPackages = fleetRepositoryRoot
    ? await discoverRepositoryAgentPackages(fleetRepositoryRoot, {
        localPackageSources: fleetLocalPackageSources,
      })
    : undefined
  const agents = opts.agents ?? await resolveDefaultAgentFleet({
    ...(fleetRepositoryRoot ? { repositoryRoot: fleetRepositoryRoot } : {}),
    ...(discoveredPackages ? { discoveredPackages } : {}),
  })
  const legacyStandaloneDefaultComposition = agents.length === 1 && "legacyDefault" in agents[0]!
  const bridge = createInMemoryBridge()
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const modeAdapter = opts.runtimeModeAdapter ?? createSandboxRuntimeModeAdapter(resolvedMode)
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
    async runWithWorkspaceAgent(input, run) {
      if (!workspaceAgentDispatcherResolver?.runWithWorkspaceAgent) throw new Error("workspace agent dispatcher run is not ready")
      return await workspaceAgentDispatcherResolver.runWithWorkspaceAgent(input, run)
    },
    async resolve(actor, options) {
      if (!workspaceAgentDispatcherResolver) throw new Error("workspace agent dispatcher is not ready")
      return await workspaceAgentDispatcherResolver.resolve(actor, options)
    },
    async authorizeSession(actor, ref, options) {
      if (!workspaceAgentDispatcherResolver?.authorizeSession) throw new Error("workspace agent session authorization is not ready")
      await workspaceAgentDispatcherResolver.authorizeSession(actor, ref, options)
    },
    async readSessionRunDetails(actor, ref, detailKinds, options) {
      if (!workspaceAgentDispatcherResolver?.readSessionRunDetails) throw new Error("workspace agent run details are not ready")
      return await workspaceAgentDispatcherResolver.readSessionRunDetails(actor, ref, detailKinds, options)
    },
  }
  const pluginCollection = await resolveWorkspaceAgentServerPluginCollection({
    trustedPluginContext: {
      workspaceAgentDispatcherResolver: trustedDispatcherProxy,
      actorResolver: (request) => ({
        workspaceId: opts.sessionId ?? "default",
        userId: authenticatedRequestUserId(request) ?? "local",
      }),
    },
    ...opts,
    agentTypeId: opts.defaultAgentTypeId ?? agents[0]?.agentTypeId ?? "default",
    availableAgentTypeIds: agents.map((agent) => agent.agentTypeId),
    workspaceRoot,
    bridge,
    installPluginAuthoring: pluginAuthoringEnabled,
  })
  const defaultPluginPackagePaths = pluginCollection.defaultPluginPackagePaths
  const ctx: WorkspaceAgentServerPluginContext = { workspaceRoot, bridge }
  const allPluginEntries: WorkspacePluginEntry[] = pluginCollection.resolvedPluginArtifacts
    .map((artifact) => artifact.entry)

  const { registry: workspaceBridgeRegistry } = createWorkspaceBridgeRuntimeCore({
    registry: opts.workspaceBridge?.registry,
    ownerWorkspaceId: "default",
    handlers: [
      ...(opts.workspaceBridge?.handlers ?? []),
      ...(pluginCollection.workspaceBridgeHandlers ?? []),
    ],
  })

  const runtimeWorkspaceRoot = modeAdapter.getRuntimeLayoutRoot({
    workspaceRoot,
    sessionId: opts.sessionId ?? DEFAULT_WORKSPACE_SCOPE_ID,
    workspaceId: opts.sessionId ?? DEFAULT_WORKSPACE_SCOPE_ID,
  })
  const runtimeLayout = runtimeHost.getBoringAgentRuntimePaths(runtimeWorkspaceRoot)
  const runtimeUserSkillsPath = join(runtimeWorkspaceRoot, ".agents", "skills")
  const hostUserSkillsPath = join(workspaceRoot, ".agents", "skills")

  // Static app resources are global to every Agent. Plugin Agent resources are
  // added later from the normalized contribution for that Agent.
  const workspacePackagePiPackage = pluginAuthoringEnabled ? createBoringPiPackageSource() : undefined
  const builtInBoringPiSkillPaths = pluginAuthoringEnabled ? resolveBoringPiSkillPaths(workspaceRoot) : []
  const baseStaticPiSkillPaths = [
    ...builtInBoringPiSkillPaths,
    runtimeUserSkillsPath,
    ...(opts.pi?.additionalSkillPaths ?? []),
  ]
  const baseStaticPiPackages = [workspacePackagePiPackage, ...(opts.pi?.packages ?? [])]
  const baseStaticPiExtensionPaths = opts.pi?.extensionPaths ?? []

  // Boring plugin discovery: scan external workspace/global extension
  // collections plus internal app/plugin-provided sources. Source kind is
  // explicit so later activation code does not infer trust from paths.
  const resolveBoringPluginDirs = (): BoringPluginSource[] => uniqueBoringPluginSources([
      ...defaultPluginPackagePaths.map((rootDir): BoringPluginSource => ({ rootDir, kind: "internal" })),
      ...(process.env.BORING_AGENT_FLEET === '1'
        ? [{ rootDir: join(opts.fleetRepositoryRoot ?? process.cwd(), '.agents', 'personas'), kind: 'internal' as const }]
        : []),
      ...collectBoringPluginSources(workspaceRoot, pluginCollection, opts.additionalBoringPluginDirs, externalPluginsEnabled),
    ])
  const boringPluginDirs: BoringPluginSource[] = []
  const refreshBoringPluginDirs = (): BoringPluginSource[] => {
    const next = resolveBoringPluginDirs()
    boringPluginDirs.splice(0, boringPluginDirs.length, ...next)
    return boringPluginDirs
  }
  refreshBoringPluginDirs()

  // Dynamic Pi resources discovered from package.json#pi at /reload time.
  // Pi calls `getHotReloadableResources()` on every reloadSession() and merges the
  // result with the static fields above, so the workspace never mutates
  // arrays the harness already captured.
  interface PackageResourceSnapshot {
    readonly registry: ResolvedWorkspacePackageResourceRegistry
    readonly diagnostics: readonly { source: string; message: string; pluginId?: string }[]
  }
  let currentPackageResourceSnapshot: PackageResourceSnapshot | undefined
  let packageResourceDiagnostics: Array<{ source: string; message: string; pluginId?: string }> = []
  const staticPiSkillPaths = [...baseStaticPiSkillPaths]
  const staticPiPackages = compactPiPackages(baseStaticPiPackages)
  const staticPiExtensionPaths = [...baseStaticPiExtensionPaths]

  const getHotReloadablePiResources = (registry = currentPackageResourceSnapshot?.registry) => {
    const discovered = readWorkspacePluginPackagePiSnapshot(refreshBoringPluginDirs())
    return {
      ...discovered,
      additionalSkillPaths: uniqueStrings([
        ...discovered.additionalSkillPaths.filter((path) => !registry || !packageResourceHandlesPath(path, registry.handledPackageRoots)),
        ...(registry?.additionalSkillPaths ?? []),
      ]),
    }
  }

  const boringAssetManager = new BoringPluginAssetManager({
    pluginDirs: boringPluginDirs,
    errorRoot: join(workspaceRoot, ".pi", "extensions"),
    frontTargetResolver: opts.boringPluginFrontTargetResolver,
  })
  const runtimeBackendRegistry = new RuntimeBackendRegistry()

  const buildRuntimeProvisioningInputs = () => {
    const handledRoots = currentPackageResourceSnapshot?.registry.handledPackageRoots ?? []
    const scanned = readWorkspacePluginPackageRuntimePlugins(refreshBoringPluginDirs()).map((plugin) => ({
      ...plugin,
      ...(plugin.skills
        ? { skills: plugin.skills.filter((skill) => !packageResourceHandlesPath(skill.source, handledRoots)) }
        : {}),
    }))
    const inputs = mergeRuntimeProvisioningInputs([
      ...pluginCollection.runtimePlugins,
      ...scanned,
    ])
    if (resolvedMode === "direct") return omitPluginAuthoringProvisioning(inputs)
    return inputs
  }
  let currentRuntimeProvisioning = opts.runtimeProvisioning
  type RuntimeProvisionerContext = Parameters<NonNullable<WorkspaceAgentCreateOptions["runtimeProvisioner"]>>[0]
  const runRuntimeProvisioning = async (runtimeBundle: RuntimeProvisionerContext["runtimeBundle"]) => {
    if (opts.provisionWorkspace === false) return currentRuntimeProvisioning
    const adapter = runtimeBundle.provisioningAdapter
    if (adapter) {
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
    }
    await opts.runtimeProvisioner?.({ workspaceRoot, runtimeMode: resolvedMode, runtimeBundle })
    return currentRuntimeProvisioning
  }
  // Rebuild closure created before Agent route projection so beforeReload can
  // call it.
  const rebuildPlugins = async (): Promise<PluginRebuildResult> => {
    return rebuildServerPlugins({ entries: allPluginEntries, ctx })
  }
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
  const allPluginAgentProjection = bootstrapServer({
    defaults: opts.defaults,
    plugins: pluginCollection.resolvedPluginArtifacts.map((artifact) => artifact.plugin),
    excludeDefaults: opts.excludeDefaults,
  })
  const canonicalDefaultPluginPackagePaths = new Set(defaultPluginPackagePaths.map((path) => resolve(path)))
  const workspaceScopedDefaultArtifacts = opts.workspaceScopedDefaultPluginAgentContributions
    ? pluginCollection.resolvedPluginArtifacts.filter((artifact) =>
        "dir" in artifact.entry
        && canonicalDefaultPluginPackagePaths.has(resolve(artifact.entry.dir)),
      )
    : []
  const resolvePackageResourceSnapshot = async (): Promise<PackageResourceSnapshot> => {
    const ambientSkillsEnabled = opts.pi?.noSkills === false
    const sharedSkillPaths = await enumerateExternalSkillFiles([
      ...baseStaticPiSkillPaths,
      ...(ambientSkillsEnabled ? [join(homedir(), ".pi", "agent", "skills")] : []),
    ], workspaceRoot)
    const snapshot = await resolveWorkspacePackageResourceSnapshot({
      declared: allPluginAgentProjection.packageResources,
      scanned: await discoverPackageResourceRecords(refreshBoringPluginDirs()),
      sharedSkillPaths,
    })
    return snapshot
  }
  const commitPackageResourceSnapshot = (snapshot: PackageResourceSnapshot): void => {
    currentPackageResourceSnapshot = snapshot
    packageResourceDiagnostics = [...snapshot.diagnostics]
  }
  commitPackageResourceSnapshot(await resolvePackageResourceSnapshot())
  const normalizedRuntimeContributions = new Map<string, NormalizedAgentRuntimeContribution>()
  const resolvedFleetCompiler: AgentFleetCompiler = {
    async compile({ agents: fleet }) {
      const compiled = opts.fleetCompiler
        ? await opts.fleetCompiler.compile({ agents: fleet })
        : fleet
      return compiled.map((agent) => {
        const legacyDefault = "legacyDefault" in agent
        const projection = projectAgentSpecPluginArtifacts(
          agent,
          pluginCollection.resolvedPluginArtifacts,
          workspaceScopedDefaultArtifacts,
          { defaults: opts.defaults, excludeDefaults: opts.excludeDefaults },
        )
        const pluginIds = projection.artifacts.map((artifact) => artifact.id)
        const resolvedPolicy = {
          ...("resolvedPolicy" in agent && agent.resolvedPolicy && typeof agent.resolvedPolicy === "object"
            ? agent.resolvedPolicy as Readonly<Record<string, unknown>>
            : {}),
          pluginIds,
        }
        const includeAllDiscoveredPluginResources = legacyDefault
        const identityProjection = legacyStandaloneDefaultComposition && legacyDefault
          ? { artifacts: projection.artifacts, runtimePlugins: [], agentOptions: { extraTools: [], pi: {} } }
          : projection
        normalizedRuntimeContributions.set(agent.agentTypeId, {
          ...agentRuntimeContributionIdentityInput({
            agent,
            resolvedPolicy,
            projection: identityProjection,
            includeAllDiscoveredPluginResources: legacyStandaloneDefaultComposition ? false : includeAllDiscoveredPluginResources,
          }),
          runtimePlugins: projection.runtimePlugins,
          agentOptions: projection.agentOptions,
          includeAllDiscoveredPluginResources,
          legacyStandaloneComposition: legacyStandaloneDefaultComposition && legacyDefault,
        })
        return { ...agent, resolvedPolicy }
      })
    },
  }
  const fleetCompiler = createValidatingAgentFleetCompiler({
    plugins: pluginCollection.resolvedPluginArtifacts.map(({ id, plugin }) => ({
      id,
      configKeys: plugin.agentConfigContract?.keys,
    })),
    compiler: resolvedFleetCompiler,
  })
  const runtimeEnvContributions = [
    ...(opts.runtimeEnvContributions ?? []),
    ...(workspaceBridgeRuntimeEnvContribution ? [workspaceBridgeRuntimeEnvContribution] : []),
  ]
  const basePi: WorkspaceAgentPiOptions & {
    getHotReloadableResources?: () => WorkspacePluginPackagePiSnapshot
  } = {
    ...opts.pi,
    additionalSkillPaths: staticPiSkillPaths,
    packages: staticPiPackages,
    extensionPaths: staticPiExtensionPaths,
    extensionFactories: opts.pi?.extensionFactories,
  }
  const baseExtraTools = [...(opts.extraTools ?? []), ...uiTools]
  const appSystemPromptParts = [
    workspaceFsCapability === "strong" ? buildWorkspaceContextPrompt({ pluginAuthoringEnabled }) : undefined,
    pluginAuthoringEnabled ? buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: boringPiRootVisibleToAgentTools(
        workspaceRoot,
        resolvedMode,
        opts.provisionWorkspace !== false,
      ),
    }) : undefined,
  ]
  const baseSystemPromptAppend = [
    ...appSystemPromptParts,
    opts.systemPromptAppend,
  ].filter(Boolean).join("\n\n") || undefined
  const legacyStandaloneCompositionSystemPromptAppend = [
    ...appSystemPromptParts,
    pluginCollection.agentOptions.systemPromptAppend,
  ].filter(Boolean).join("\n\n") || undefined
  const refreshWorkspaceAgentResources = async (input?: {
    availabilityPrechecked?: boolean
    packageResourceSnapshot?: PackageResourceSnapshot
  }): Promise<WorkspaceReloadHookResult | undefined> => {
    if (!input?.availabilityPrechecked) {
      await assertAgentReloadAvailable(pluginCollection.agentReloadBlockers)
    }
    boringAssetManager.setPluginDirs(refreshBoringPluginDirs())
    const scan = await boringAssetManager.load()
    const backendReload = await runtimeBackendRegistry.reloadFromLoadedPlugins(boringAssetManager.inspectLoaded())
    const rebuild = await rebuildPlugins()
    let packageResourceRebuildDiagnostics: Array<{ source: string; message: string; pluginId?: string }> = []
    try {
      commitPackageResourceSnapshot(input?.packageResourceSnapshot ?? await resolvePackageResourceSnapshot())
    } catch {
      packageResourceRebuildDiagnostics = [{
        source: "package-resource-registry",
        message: "package skill resources could not be refreshed; the previous snapshot remains active",
      }]
    }
    const restartWarnings = collectRestartWarnings(scan.events)
    const diagnostics = [
      ...scan.errors.map((error) => ({
        source: `boring plugin asset scan (${error.id})`,
        message: error.message,
        pluginId: error.id,
      })),
      ...backendReload.diagnostics,
      ...rebuild.diagnostics,
      ...packageResourceRebuildDiagnostics,
      ...packageResourceDiagnostics,
    ]
    const callerResult = await opts.beforeReload?.()
    await assertAgentReloadAvailable(pluginCollection.agentReloadBlockers)
    const mergedRestartWarnings = [
      ...restartWarnings,
      ...(callerResult && typeof callerResult === "object" ? callerResult.restart_warnings ?? [] : []),
    ]
    const mergedDiagnostics = [
      ...diagnostics,
      ...(callerResult && typeof callerResult === "object" ? callerResult.diagnostics ?? [] : []),
    ]
    if (mergedRestartWarnings.length === 0 && mergedDiagnostics.length === 0) return undefined
    return {
      ...(mergedRestartWarnings.length > 0 ? { restart_warnings: mergedRestartWarnings } : {}),
      ...(mergedDiagnostics.length > 0 ? { diagnostics: mergedDiagnostics } : {}),
    }
  }
  const environmentPlacementIdentity = identityDigest(canonicalIdentityJson({
    runtimeMode: resolvedMode,
    workspaceScopeId,
    workspaceRoot,
    readonlyWorkspacePolicyRevision: readonlyWorkspacePolicy?.revision ?? null,
  }))
  const environmentProvisioningFingerprint = identityDigest(canonicalIdentityJson({
    runtimeMode: resolvedMode,
    workspaceRoot,
    runtimeContributionIds: runtimeEnvContributions.map((entry) => entry.id),
    runtimePluginIds: buildRuntimeProvisioningInputs().map((entry) => entry.id),
    provisionWorkspace: opts.provisionWorkspace !== false,
  }))
  const semanticProvisioningIdentity = identityDigest(canonicalIdentityJson({
    runtimeMode: resolvedMode,
    runtimeContributionIds: runtimeEnvContributions.map((entry) => entry.id),
    runtimePluginIds: buildRuntimeProvisioningInputs().map((entry) => entry.id),
    provisionWorkspace: opts.provisionWorkspace !== false,
  }))
  const scopeIssuer = createWorkspaceAgentScopeIssuer(workspaceScopeId)
  const agentHost = await createAgentHost({
    agents,
    fleetCompiler,
    hostId: "workspace-agent-host",
    scopeVerifier: scopeIssuer.verifier,
    runtimeModeAdapter: modeAdapter,
    runtimeHost,
    sessionRoot: opts.sessionRoot,
    requestLedgerPath: resolveRequestLedgerPath({
      requestLedgerPath: opts.requestLedgerPath,
      sessionRoot: opts.sessionRoot,
      acceptSessionRootEnv: true,
      legacy: { layout: "workspace-boring-dir", workspaceRoot },
    }),
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
                admissionReceipt: `workspace-direct:${scope.workspaceScopeId}:${key.requestId}`,
              }
            },
          },
        }
      : {}),
    async resolveAuthorizedEnvironmentScope({ authorizedScope, verifiedClaim, intent }): Promise<AgentHostEnvironmentScope> {
      const issuedClaim = scopeIssuer.context(authorizedScope)
      if (
        issuedClaim.workspaceScopeId !== verifiedClaim.workspaceScopeId
        || issuedClaim.authSubjectId !== verifiedClaim.authSubjectId
      ) throw new Error("verified Workspace scope does not match its issuer context")
      return {
        placementIdentity: environmentPlacementIdentity,
        workspaceRoot,
        provisioningFingerprint: environmentProvisioningFingerprint,
        transformRuntimeBundle: runtimeEnvContributions.length > 0 || readonlyWorkspacePolicy
          ? async (runtimeBundle) => {
              const transformed = runtimeEnvContributions.length > 0
                ? await withRuntimeEnvContributions(runtimeBundle, {
                    workspaceId: verifiedClaim.workspaceScopeId,
                    workspaceRoot,
                    runtimeMode: resolvedMode,
                    runtimeBundle,
                  }, runtimeEnvContributions, opts.telemetry)
                : runtimeBundle
              if (!readonlyWorkspacePolicy) return transformed
              return {
                ...transformed,
                // Consumed by the bash tool builder for sandbox readonly binds
                // and by provisioning guards; same policy, other enforcement points.
                readonlyWorkspacePaths: readonlyWorkspacePolicy.readonlyPaths,
                filesystemBindings: [...mergeRuntimeFilesystemBindings(
                  [createUserFilesystemBinding(transformed.workspace, readonlyWorkspacePolicy, async (path) => {
                    // Local/sandboxed bundles expose a confined workspace (root
                    // `/workspace`) that is not a registered node workspace, so
                    // prefer the mode adapter's host storage root before the
                    // node-workspace registry lookup.
                    const root = transformed.storageRoot
                      ?? runtimeHost.getNodeWorkspaceHostRoot(transformed.workspace)
                    if (!root) throw new RuntimeReadonlyFilesystemPolicyError()
                    return await runtimeHost.resolveRealWorkspacePath(root, path)
                  })],
                  transformed.filesystemBindings,
                ) ?? []],
              }
            }
          : undefined,
        provisionRuntime: async ({ runtimeBundle }) => await runRuntimeProvisioning(runtimeBundle),
        resolveFilesystemBindings: async ({ requestId }) => {
          const callerBindings = await opts.getFilesystemBindings?.({
            workspaceId: verifiedClaim.workspaceScopeId,
            workspaceRoot,
            userId: verifiedClaim.authSubjectId,
            requestId,
          }) ?? []
          const packageRegistry = currentPackageResourceSnapshot?.registry
          const packageBinding = legacyStandaloneDefaultComposition && packageRegistry?.readonlyMounts.length
            ? await runtimeHost.createAgentResourceFilesystemBinding(
                AGENT_RESOURCES_FILESYSTEM_ID,
                packageRegistry.readonlyMounts,
              )
            : undefined
          return [...callerBindings, ...(packageBinding ? [packageBinding] : [])]
        },
      }
    },
    async resolveAuthorizedAgentRuntimeScope({
      authorizedScope,
      verifiedClaim,
      agentTypeId,
      intent,
      environment,
    }) {
      scopeIssuer.context(authorizedScope)
      const contribution = normalizedRuntimeContributions.get(agentTypeId)
      if (!contribution) throw new Error(`Agent runtime contribution was not compiled: ${agentTypeId}`)
      // Reload resolves one immutable package candidate before admission. The
      // same candidate drives digest, prompt, locator, binding, and commit.
      const stagedPackageResourceSnapshot = intent.operation === "reload"
        ? await resolvePackageResourceSnapshot()
        : undefined
      const getEffectivePackageResourceSnapshot = () =>
        stagedPackageResourceSnapshot ?? currentPackageResourceSnapshot

      const selectedSkillPaths = contribution.runtimePlugins.flatMap((plugin) =>
        (plugin.skills ?? []).map((skill) => join(runtimeLayout.skills, plugin.id, skill.name)),
      )
      const selectedSourceSkillPaths = contribution.runtimePlugins.flatMap((plugin) =>
        (plugin.skills ?? []).map((skill) => skill.source instanceof URL ? fileURLToPath(skill.source) : skill.source),
      )
      const selectedPluginIds = new Set(contribution.artifacts.map((artifact) => artifact.pluginId))
      const getAgentPackageResourceView = () => {
        const registry = getEffectivePackageResourceSnapshot()?.registry
        return registry ? selectAgentPackageResourceView(registry, {
          pluginIds: selectedPluginIds,
          includeAll: contribution.includeAllDiscoveredPluginResources,
        }) : undefined
      }
      const createAgentPackageBinding = async () => {
        const view = getAgentPackageResourceView()
        return view && view.readonlyMounts.length > 0
          ? await runtimeHost.createAgentResourceFilesystemBinding(
              AGENT_RESOURCES_FILESYSTEM_ID,
              view.readonlyMounts,
            )
          : undefined
      }
      const locateAgentPackageSkill = (filePath: string) => getAgentPackageResourceView()?.locateSkill(filePath)
      const resolvedBasePi = basePi
      const selectedPi = contribution.agentOptions.pi
      const staticPiResources = contribution.legacyStandaloneComposition
        ? {
            packages: compactPiPackages([
              workspacePackagePiPackage,
              ...(selectedPi?.packages ?? []),
              ...(basePi.packages ?? []).filter((entry) => entry !== workspacePackagePiPackage),
            ]),
            extensionPaths: uniqueStrings([
              ...(selectedPi?.extensionPaths ?? []),
              ...(basePi.extensionPaths ?? []),
            ]),
          }
        : {
            packages: compactPiPackages([
              ...(basePi.packages ?? []),
              ...(selectedPi?.packages ?? []),
            ]),
            extensionPaths: uniqueStrings([
              ...(basePi.extensionPaths ?? []),
              ...(selectedPi?.extensionPaths ?? []),
            ]),
          }
      const identityBaseExtraTools = contribution.legacyStandaloneComposition
        ? [...baseExtraTools, ...(pluginCollection.agentOptions.extraTools ?? [])]
        : baseExtraTools
      const baseBindingInputs = jsonIdentityValue({
        systemPromptAppend: contribution.legacyStandaloneComposition
          ? legacyStandaloneCompositionSystemPromptAppend ?? null
          : baseSystemPromptAppend ?? null,
        piHarnessPolicy: {
          noContextFiles: resolvedBasePi.noContextFiles ?? null,
          noSkills: resolvedBasePi.noSkills ?? null,
        },
        toolContractOrder: identityBaseExtraTools.map(toolContractDigest),
      }, "baseRuntimeBindingInputs")
      const getBaseHotResources = resolvedBasePi.getHotReloadableResources
      const getHotReloadableResources = getBaseHotResources
        || selectedSkillPaths.length > 0
        || getEffectivePackageResourceSnapshot()
        || contribution.includeAllDiscoveredPluginResources
        ? () => {
            const baseHot: Partial<WorkspacePluginPackagePiSnapshot> = getBaseHotResources?.() ?? {}
            const discovered = contribution.includeAllDiscoveredPluginResources
              ? getHotReloadablePiResources(getEffectivePackageResourceSnapshot()?.registry)
              : emptyPackageJsonPiSnapshot()
            const baseSkillPaths = (baseHot.additionalSkillPaths ?? []).filter((path) =>
              contribution.includeAllDiscoveredPluginResources || path !== runtimeLayout.skills,
            )
            const packageView = getAgentPackageResourceView()
            return {
              ...baseHot,
              ...discovered,
              additionalSkillPaths: uniqueStrings([
                ...baseSkillPaths,
                ...selectedSkillPaths,
                ...(packageView?.additionalSkillPaths ?? []),
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
      const baseDynamicPrompt = opts.systemPromptDynamic
      const loadSystemPromptAppend = baseDynamicPrompt || getHotReloadableResources || getEffectivePackageResourceSnapshot()
        ? async () => mergePromptContents([
            await baseDynamicPrompt?.(),
            getHotReloadableResources?.().systemPromptAppend,
            contribution.includeAllDiscoveredPluginResources ? aggregatePluginPrompts(boringAssetManager) : undefined,
            ...(getAgentPackageResourceView()?.systemPrompts ?? []),
          ])
        : undefined

      const semanticIdentityInput = {
        artifacts: contribution.artifacts,
        validatedConfig: contribution.validatedConfig,
        grants: contribution.grants,
        placementClassIdentity: resolvedMode,
        isolationMode: resolvedMode,
        toolContractDigests: contribution.toolContractDigests,
        provisioningIdentity: semanticProvisioningIdentity,
        bindingInputs: {
          sessionNamespace: "",
          base: baseBindingInputs,
          contribution: contribution.bindingInputs,
        },
      } as const
      const identity = createResolvedRuntimeScopeIdentity(semanticIdentityInput)
      const physicalBindingIdentity = identityDigest(canonicalIdentityJson({
        identity,
        placementIdentity: environment.placementIdentity,
        provisioningFingerprint: environment.provisioningFingerprint,
      }))
      const staticSystemPromptAppend = [baseSystemPromptAppend, contribution.agentOptions.systemPromptAppend]
        .filter((part): part is string => Boolean(part))
        .join("\n\n") || undefined
      const buildResourceDigestInput = async () => {
        const hotResources = getHotReloadableResources?.()
        // Provisioned runtime skill paths are outputs of applyReload. Hash the
        // admitted source paths instead so reload does not invalidate its own
        // post-effect resource fence.
        const packageRoots = getEffectivePackageResourceSnapshot()?.registry.handledPackageRoots ?? []
        const digestHotSkillPaths = (hotResources?.additionalSkillPaths ?? []).filter((path) =>
          !packageResourceHandlesPath(path, [runtimeLayout.skills, ...packageRoots]),
        )
        const additionalSkillPaths = uniqueStrings([
            ...(resolvedBasePi.additionalSkillPaths ?? []).map((path) =>
              path === runtimeUserSkillsPath ? hostUserSkillsPath : path,
            ),
            ...(selectedPi?.additionalSkillPaths ?? []),
            ...selectedSourceSkillPaths,
            ...digestHotSkillPaths,
          ])
        const packages = compactPiPackages([
            ...staticPiResources.packages,
            ...(hotResources?.packages ?? []),
            ...packageRoots.map((source) => ({ source })),
          ])
        const extensionPaths = uniqueStrings([
            ...staticPiResources.extensionPaths,
            ...(hotResources?.extensionPaths ?? []),
          ])
        const dynamicSystemPromptAppend = await loadSystemPromptAppend?.()
        return createPiResourceDigestInput({
          piCwd: workspaceRoot,
          noSkills: selectedPi?.noSkills ?? resolvedBasePi.noSkills,
          noContextFiles: selectedPi?.noContextFiles ?? resolvedBasePi.noContextFiles,
          resourceSets: [{
            promptParts: [staticSystemPromptAppend, dynamicSystemPromptAppend],
            additionalSkillPaths,
            packages,
            extensionPaths,
          }],
          authorizedRoots: uniqueStrings([
            workspaceRoot,
            ...defaultPluginPackagePaths,
            ...resolveBoringPluginDirs().map((source) => source.rootDir),
            runtimeLayout.skills,
            ...selectedSourceSkillPaths,
            ...builtInBoringPiSkillPaths,
            ...[localPiPackageRoot(workspacePackagePiPackage)]
              .filter((path): path is string => Boolean(path)),
            ...(getEffectivePackageResourceSnapshot()?.registry.handledPackageRoots ?? []),
            ...(opts.piResourceAuthorizedRoots ?? []),
          ]),
        })
      }
      const { resourceInputDigest, revalidateResourceInputs } = await createPiResourceDigestFence(buildResourceDigestInput)
      return {
        identity,
        physicalBindingIdentity,
        resourceInputDigest,
        ...(intent.operation === "reload" ? {
          async revalidateResourceInputs() {
            await assertAgentReloadAvailable(pluginCollection.agentReloadBlockers)
            await revalidateResourceInputs()
          },
        } : {}),
        sessionNamespace: "",
        pi: {
          ...resolvedBasePi,
          ...selectedPi,
          additionalSkillPaths: uniqueStrings([
            ...(resolvedBasePi.additionalSkillPaths ?? []),
            ...(selectedPi?.additionalSkillPaths ?? []),
          ]),
          packages: staticPiResources.packages,
          extensionPaths: staticPiResources.extensionPaths,
          ...(getHotReloadableResources ? { getHotReloadableResources } : {}),
          locateSkillResource: locateAgentPackageSkill,
        },
        extraTools: [
          ...baseExtraTools,
          ...(contribution.agentOptions.extraTools ?? []),
        ],
        includeFilesystemTools: opts.disableDefaultFileTools !== true,
        includeUploadTools: true,
        getFilesystemBindings: async ({ scope, sessionId, requestId }) => {
          const callerBindings = await opts.getFilesystemBindings?.({
            workspaceId: scope.workspaceScopeId,
            workspaceRoot,
            sessionId,
            userId: scope.authSubjectId,
            requestId,
          }) ?? []
          const packageBinding = await createAgentPackageBinding()
          return [...callerBindings, ...(packageBinding ? [packageBinding] : [])]
        },
        getSkillResourceSnapshot: async () => {
          const view = getAgentPackageResourceView()
          if (!view) return undefined
          const binding = await createAgentPackageBinding()
          return {
            generation: view.generation,
            managedSkills: view.managedSkills,
            locateSkill: binding ? view.locateSkill : () => undefined,
          }
        },
        ...(intent.operation === "reload"
          ? {
              async applyReload(input?: { runtimeBundle: RuntimeProvisionerContext["runtimeBundle"] }) {
                await assertAgentReloadAvailable(pluginCollection.agentReloadBlockers)
                if (input) await runRuntimeProvisioning(input.runtimeBundle)
                const result = await refreshWorkspaceAgentResources({
                  availabilityPrechecked: true,
                  packageResourceSnapshot: stagedPackageResourceSnapshot,
                })
                return result && {
                  diagnostics: result.diagnostics,
                  restartWarnings: result.restart_warnings,
                }
              },
            }
          : {}),
        systemPromptAppend: staticSystemPromptAppend,
        loadSystemPromptAppend,
      }
    },
  })
  const unregisterUiBridge = registerWorkspaceUiBridge(bridge)
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  let lifecycleTransferred = false
  app.addHook("onRequest", createAgentAuthMiddleware({
    authToken: opts.authToken,
    workspaceId: workspaceScopeId,
    publicPaths: ["/health", "/ready"],
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
  const authorizedScopeByRequest = new WeakMap<FastifyRequest, Promise<AuthorizedAgentScope>>()
  const authorizeAgentRequest = (request: FastifyRequest): Promise<AuthorizedAgentScope> => {
    let authorized = authorizedScopeByRequest.get(request)
    if (!authorized) {
      authorized = (async () => {
        const selectedWorkspaceId = trustedWorkspaceScopeId(request, workspaceScopeId, allowedWorkspaceSelectors)
        let authSubject = authenticatedRequestUserId(request) ?? "local"
        if (isAgentSessionRequest(request)) {
          const storageScopeHeader = request.headers["x-boring-storage-scope"]
          const defaultContext: WorkspacePiSessionRequestContext = {
            workspaceId: selectedWorkspaceId,
            storageScope: typeof storageScopeHeader === "string" && storageScopeHeader.length > 0
              ? storageScopeHeader
              : undefined,
            authSubject,
            requestId: request.id,
          }
          const contextResolver = opts.resolvePiSessionRequestContext
            ?? ((_: FastifyRequest, context: WorkspacePiSessionRequestContext) => context)
          const context = await contextResolver(request, defaultContext)
          authSubject = context.authSubject?.trim() || authSubject
        }
        return scopeIssuer.issue({
          claim: { workspaceScopeId: selectedWorkspaceId, authSubjectId: authSubject },
        })
      })()
      authorizedScopeByRequest.set(request, authorized)
    }
    return authorized
  }
  try {
    registerWorkspaceHealthRoutes(app, async (request) => await agentHost.acquireEnvironment({
      authorizedScope: await authorizeAgentRequest(request),
      intent: { kind: "http-route", requestId: request.id },
    }))
    await registerAgentHostEnvironmentRoutes(app, {
      created: agentHost,
      authorizeAgentRequest,
      runtimeHost,
      getWorkspaceHostRoot: async () => workspaceRoot,
    })
    await app.register(agentHost.registerDirectRoutes({
      authorizeAgentRequest,
      defaultSessionId: opts.sessionId ?? "default",
    }))
    lifecycleTransferred = true
    app.addHook("onClose", async () => {
      await runtimeBackendRegistry.close()
      unregisterUiBridge()
    })

    const directDispatcher: WorkspaceAgentDispatcherResolver = {
      async runWithWorkspaceAgent(input, run) {
        if (!allowedWorkspaceSelectors.has(input.context.workspaceId)) {
          throw Object.assign(new Error("workspace dispatcher scope is not allowed"), {
            code: "AGENT_SCOPE_DENIED",
            statusCode: 403,
          })
        }
        const authorizedScope = input.request
          ? await authorizeAgentRequest(input.request)
          : scopeIssuer.issue({
              claim: { workspaceScopeId, authSubjectId: input.context.userId.trim() },
            })
        return await agentHost.runWithWorkspaceAgent({ ...input, authorizedScope }, run)
      },
      async resolve() {
        throw new Error("unbounded workspace agent dispatcher access was removed; use runWithWorkspaceAgent")
      },
      async authorizeSession(context, ref, resolveOptions) {
        const scope = resolveOptions?.request
          ? await authorizeAgentRequest(resolveOptions.request)
          : scopeIssuer.issue({ claim: { workspaceScopeId, authSubjectId: context.userId.trim() } })
        await agentHost.gateway.readSessionState({ scope, ref })
      },
      async readSessionRunDetails(context, ref, detailKinds, resolveOptions) {
        if (detailKinds.length < 1 || detailKinds.length > 16 || detailKinds.some((kind) => !kind || kind.length > 128)) {
          throw new TypeError("invalid structured detail kinds")
        }
        const scope = resolveOptions?.request
          ? await authorizeAgentRequest(resolveOptions.request)
          : scopeIssuer.issue({ claim: { workspaceScopeId, authSubjectId: context.userId.trim() } })
        const snapshot = await agentHost.gateway.readSessionState({ scope, ref })
        return projectAuthorizedSessionRunDetails(snapshot.state.messages, detailKinds)
      },
    }
    workspaceAgentDispatcherResolver = directDispatcher
    opts.onWorkspaceAgentDispatcher?.(directDispatcher)
  } catch (error) {
    if (lifecycleTransferred) {
      try { await app.close() } catch {}
    } else {
      try { await agentHost.host.close() } catch {}
      try { await app.close() } catch {}
    }
    unregisterUiBridge()
    throw error
  }
  try {
    refreshBoringPluginDirs()
    await boringAssetManager.load()
    await runtimeBackendRegistry.reloadFromLoadedPlugins(boringAssetManager.inspectLoaded())
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
  } catch (error) {
    try { await app.close() } catch {}
    throw error
  }
}
