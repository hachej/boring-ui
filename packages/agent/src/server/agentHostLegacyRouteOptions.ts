import type { FastifyRequest } from 'fastify'
import type { BoringAgentRuntimePaths } from '@hachej/boring-sandbox/providers/node-workspace'
import type { AgentTool } from '../shared/tool'
import type { AuthorizedAgentScope, VerifiedAgentScopeClaim } from '../shared/gateway/types'
import type { AgentHarnessFactory } from '../shared/harness'
import type { TelemetrySink } from '../shared/telemetry'
import type { Workspace } from '../shared/workspace'
import type { AgentEffectAdmission } from '../core/piChatSessionService'
import type { ShareEntryStore } from '../shared/share-entry'
import type {
  RuntimeBundle,
  RuntimeFilesystemBinding,
  RuntimeModeAdapter,
  RuntimeModeId,
} from './runtime/mode'
import type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningResult } from './workspace/provisioning'
import type { PiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import type { ModelsRoutesOptions } from './http/routes/models'
import type { PiSessionRequestContextResolver } from './http/routes/piChat'
import type { ReloadHookResult } from './http/routes/reload'
import type { RuntimeEnvContribution } from './runtimeEnvContributions'
import type { AgentMeteringSink } from './pi-chat/metering'
import type { WorkspaceAgentDispatcherResolver } from './workspaceAgentDispatcher'
import type { WorkspaceAgentDispatcherContext } from '../shared/workspaceAgentDispatcher'
import type { CreatedAgentHost, ResolvedAgentRuntimeScope } from './agent-host/types'

export interface PrebuiltAgentHostRoutePolicy {
  /** The sole Host instance constructed by the embedding composition root. */
  readonly created: CreatedAgentHost
  /** Default Agent used by the legacy unaddressed route family. */
  readonly defaultAgentTypeId: string
  /**
   * App-owned capability issuer. The app may replace workspaceScopeId with its
   * canonical workspace/storage partition while retaining the normalized
   * runtime scope as private issuer context.
   */
  issueScope(input: {
    readonly claim: VerifiedAgentScopeClaim
    readonly runtimeScope: ResolvedAgentRuntimeScope
  }): AuthorizedAgentScope
}

export interface RegisterAgentRoutesOptions {
  /**
   * Reuse a Host created by the embedding composition root. Omission preserves
   * the historical wrapper behavior and constructs one legacy default Host.
   */
  agentHost?: PrebuiltAgentHostRoutePolicy
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  getTemplatePath?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
  }) => string | undefined | Promise<string | undefined>
  mode?: RuntimeModeId
  /** Supply a custom runtime adapter to plug in non-built-in sandbox/workspace modes. */
  runtimeModeAdapter?: RuntimeModeAdapter
  /** Provider/runtime values supplied by the embedding host. */
  runtimeHost?: AgentRuntimeHostOperations
  version?: string
  extraTools?: AgentTool[]
  /** When true, omit the six filesystem tools (read/write/edit/find/grep/ls). */
  disableDefaultFileTools?: boolean
  getExtraTools?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    workspaceFsCapability?: Workspace['fsCapability']
    authSubject?: string
  }) => AgentTool[] | Promise<AgentTool[]>
  systemPromptAppend?: string
  /** Optional dynamic system-prompt source forwarded to the harness. */
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
  getSystemPromptDynamic?: (ctx: {
    workspaceId: string
    workspaceRoot: string
  }) => string | undefined | Promise<string | undefined>
  /** Immutable host contribution captured once in the runtime binding scope. */
  getRuntimeScopeContribution?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
  }) => Readonly<{ identity: string; loadSystemPromptAppend?: () => Promise<string | undefined> }>
    | Promise<Readonly<{ identity: string; loadSystemPromptAppend?: () => Promise<string | undefined> }>>
  /** Override the default pi-backed harness with a custom agent runtime. */
  harnessFactory?: AgentHarnessFactory
  /** Optional pi adapter/runtime knobs used by the default harness. */
  pi?: PiHarnessOptions
  getPi?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
  }) => PiHarnessOptions | undefined | Promise<PiHarnessOptions | undefined>
  sessionNamespace?: string
  /** Optional explicit root for file-backed Pi chat transcript storage. */
  sessionRoot?: string
  /**
   * Trusted host-composition capability for contextless native Pi sessions.
   * Omitted/false fails closed regardless of runtime mode.
   */
  nativeSessionStartEnabled?: boolean
  /** Trusted host seam for resolving Pi HTTP session scope. */
  resolvePiSessionRequestContext?: PiSessionRequestContextResolver
  /** Optional best-effort telemetry sink supplied by an embedding host. */
  telemetry?: TelemetrySink
  /** Optional host admission called immediately before each agent effect. */
  admitEffect?: AgentEffectAdmission
  /** Generic request-aware model filtering seam. Hosts may filter per user/workspace. */
  filterModels?: ModelsRoutesOptions['filterModels']
  /** Generic per-request/per-run filesystem binding seam. Hosts may return user/session-filtered bindings. */
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
  /**
   * Optional billing sink for native Pi usage. Reserve happens before
   * accepted prompt/follow-up execution (fail closed), usage is recorded from
   * native assistant message_end events, and runs settle/release from native
   * terminal lifecycle. See AgentMeteringSink.
   */
  metering?: AgentMeteringSink
  /**
   * Enable user/global Pi extension auto-discovery from .pi/ and ~/.pi.
   * App/internal plugins should be passed through extraTools/pi instead.
   * Defaults to true for standalone agent compatibility.
   */
  externalPlugins?: boolean
  getSessionNamespace?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
    /** Verified actor id for trusted requestless dispatcher resolution. */
    userId?: string
  }) => string | undefined | Promise<string | undefined>
  registerHealthRoute?: boolean
  /**
   * Optional Lane W share-entry store (AR1-002/AR1-003, same-workspace
   * shareable links, `docs/issues/391/runtime-refactor/work/
   * AR1-shareable-artifacts/AR1-001-SPEC.md` §3). When supplied, mounts the
   * membership-gated `GET /a/:id` deep-link route. Omit to leave Lane W
   * entirely unmounted (no widening for hosts that don't use it yet).
   */
  shareEntryStore?: ShareEntryStore
  getWorkspaceId?: (request: FastifyRequest) => string | Promise<string>
  getWorkspaceRoot?: (workspaceId: string, request: FastifyRequest) => string | Promise<string>
  getTrustedWorkspaceRoot?: (ctx: WorkspaceAgentDispatcherContext) => string | Promise<string>
  /** Generic runtime env contributors. Agent stays workspace-neutral; hosts decide env names/values. */
  runtimeEnvContributions?: RuntimeEnvContribution[]
  /**
   * Optional runtime reconciliation hook. Callers own plugin discovery and may
   * call provisionWorkspaceRuntime() with the normalized structural inputs.
   * registerAgentRoutes only consumes the returned env/PATH/skill paths.
   */
  provisionRuntime?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    runtimeLayout: BoringAgentRuntimePaths
    provisioningAdapter?: WorkspaceProvisioningAdapter
    /** Already-created paired Workspace/Sandbox runtime for this binding. */
    runtimeBundle: RuntimeBundle
    request?: FastifyRequest
    /** Aborted when this binding retires; retirement still drains the task before provider disposal. */
    signal: AbortSignal
  }) => WorkspaceProvisioningResult | undefined | Promise<WorkspaceProvisioningResult | undefined>
  provisionWorkspace?: boolean
  /** Optional hook called before /api/v1/agent/reload reloads the harness. */
  beforeReload?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request: FastifyRequest
  }) => void | ReloadHookResult | undefined | Promise<void | ReloadHookResult | undefined>
  /**
   * Optional host callback returning current plugin/skill load diagnostics
   * for a workspace. Surfaced by the `plugin_diagnostics` agent tool so the
   * model can iterate on plugin/skill load errors after a /reload.
   */
  getPluginDiagnostics?: (args: {
    workspaceId: string
    workspaceRoot: string
  }) => Promise<Array<{ source: string; message: string; pluginId?: string }>>
  /**
   * Trusted in-process host composition seam. The resolver trusts caller-supplied
   * workspace/user context; callers must authorize that context before resolving.
   */
  onWorkspaceAgentDispatcher?: (resolver: WorkspaceAgentDispatcherResolver) => void
}

export interface AgentHostLegacyRouteScopePolicy {
  /** App-owned capability issuer for the already-created Host. */
  issueScope(input: {
    readonly claim: VerifiedAgentScopeClaim
    readonly runtimeScope: ResolvedAgentRuntimeScope
  }): AuthorizedAgentScope
  /** True only for the legacy wrapper whose Host admission calls admitEffect. */
  readonly gatewayUsesLegacyAdmission?: boolean
}

export type AgentHostLegacyRoutePolicyOptions =
  & Omit<RegisterAgentRoutesOptions, 'agentHost' | 'runtimeModeAdapter'>
  & { readonly runtimeModeAdapter: RuntimeModeAdapter }
