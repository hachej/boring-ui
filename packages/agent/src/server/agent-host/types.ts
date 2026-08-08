import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type {
  AgentGateway,
  AgentGatewayErrorDTO,
  AgentScopeVerifier,
  AgentSessionRef,
  AgentTool,
  AuthorizedAgentScope,
  JsonValue,
  VerifiedAgentScopeClaim,
} from '../../shared/index'
import type { AgentHarnessFactory } from '../../shared/harness'
import type { TelemetrySink } from '../../shared/telemetry'
import type { AgentMeteringSink } from '../pi-chat/metering'
import type {
  RuntimeBundle,
  RuntimeFilesystemBinding,
  RuntimeModeAdapter,
} from '../runtime/mode'
import type { AgentRuntimeHostOperations } from '../runtime/runtimeHost'
import type { WorkspaceProvisioningResult } from '../workspace/provisioning'
import type { PiHarnessOptions } from '../harness/pi-coding-agent/createHarness'
import type { AgentCapabilityReadiness } from '../runtime/readyStatus'
import type { Workspace } from '../../shared/workspace'
import type { FileSearch } from '../../shared/file-search'
import type {
  LeaseBoundWorkspaceAgent,
  WorkspaceAgentDirectRunInput,
  WorkspaceAgentDispatcherContext,
} from '../../shared/workspaceAgentDispatcher'
import type { AgentSkillResourceSnapshot } from '../http/routes/skills'

export type { LeaseBoundWorkspaceAgent } from '../../shared/workspaceAgentDispatcher'

export type AgentGatewayEffect =
  | 'session.create'
  | 'session.rename'
  | 'session.delete'
  | 'session.prompt'
  | 'session.followup'
  | 'session.interrupt'
  | 'session.stop'
  | 'session.queue.clear'
  | 'agent.reload'
  | 'session.command.execute'

export type AgentRequestTarget =
  | { readonly kind: 'agent'; readonly agentTypeId: string }
  | { readonly kind: 'session'; readonly ref: AgentSessionRef }

export interface AgentRequestKey {
  readonly workspaceScopeId: string
  readonly authSubjectId: string
  readonly operation: AgentGatewayEffect
  readonly target: AgentRequestTarget
  readonly requestId: string
}

export interface AgentStableServiceErrorDTO {
  readonly statusCode: number
  readonly error: {
    readonly code: string
    readonly message: string
    readonly retryable?: boolean
  }
}

export type AgentRequestFailure =
  | { readonly kind: 'gateway'; readonly error: AgentGatewayErrorDTO }
  | { readonly kind: 'service'; readonly error: AgentStableServiceErrorDTO }

export interface AgentRequestLedgerRecordBase {
  readonly key: AgentRequestKey
  readonly digest: string
  readonly updatedAt: number
}

export type AgentRequestLedgerRecord =
  | (AgentRequestLedgerRecordBase & { readonly state: 'pending-admission' })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'admission-accepted'
      readonly admissionReceipt: string
    })
  | (AgentRequestLedgerRecordBase & { readonly state: 'in-flight' })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'rejected'
      readonly failure: AgentRequestFailure
    })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'completed'
      readonly receipt: JsonValue
    })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'outcome-unknown'
      readonly error: AgentGatewayErrorDTO
    })

export interface AgentRequestLedger {
  /** Direct production projections require transactional durable ownership. */
  readonly durability: 'durable-transactional' | 'in-memory'
  /** Atomic compare-and-create across every process sharing the durable store. */
  prepare(key: AgentRequestKey, digest: string): Promise<AgentRequestLedgerPrepareResult>
  /** All transitions are compare-and-swap against the exact allowed prior state. */
  acceptAdmission(key: AgentRequestKey, admissionReceipt: string): Promise<void>
  beginEffect(key: AgentRequestKey): Promise<void>
  reject(key: AgentRequestKey, failure: AgentRequestFailure): Promise<void>
  complete(key: AgentRequestKey, receipt: JsonValue): Promise<void>
  markOutcomeUnknown(key: AgentRequestKey, error: AgentGatewayErrorDTO): Promise<void>
  read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined>
  close?(): void | Promise<void>
}

export interface AgentRequestLedgerPrepareResult {
  readonly ownership: 'created' | 'existing'
  readonly record: AgentRequestLedgerRecord
}

export type AgentEffectAdmissionResult =
  | { readonly type: 'accepted'; readonly admissionReceipt: string }
  | { readonly type: 'rejected'; readonly error: AgentGatewayErrorDTO }
  | { readonly type: 'retryable'; readonly error: AgentGatewayErrorDTO }

export interface AgentEffectAdmission {
  /** Must be idempotent and reconcilable on the complete ledger key. */
  admit(input: {
    readonly key: AgentRequestKey
    readonly digest: string
    readonly scope: VerifiedAgentScopeClaim
    readonly operation: AgentGatewayEffect
    readonly target: AgentRequestTarget
  }): Promise<AgentEffectAdmissionResult>
}

export interface ConfiguredAgentHostAgentSpec {
  readonly agentTypeId: string
  readonly definition: {
    readonly instructions: string
    readonly label: string
    readonly version?: string
    /**
     * Computed identity of the compiled definition (instructions + knowledge
     * bytes). The digest, not the version string, is the definition identity.
     */
    readonly digest?: string
  }
  /**
   * Optional agent-carried knowledge shipped inside the definition package.
   * Composition mounts it as a readonly, agent-scoped filesystem binding
   * with provenance `agent-definition`; absent = no binding.
   */
  readonly knowledge?: {
    /** Host path of the package's `knowledge/` folder. */
    readonly rootDir: string
  }
  readonly plugins?: readonly {
    /** Canonical app-preflighted plugin ID. */
    readonly name: string
    readonly config?: JsonValue
  }[]
  readonly model?: {
    readonly preferred?: string
    /** RESERVED / NOT ENFORCED. Per-turn token-limit enforcement is future work. */
    readonly maxTokensPerTurn?: number
  }
}

export interface LegacyDefaultAgentHostSpec {
  readonly agentTypeId: 'default'
  readonly legacyDefault: true
}

export type AgentHostAgentSpec =
  | ConfiguredAgentHostAgentSpec
  | LegacyDefaultAgentHostSpec

/**
 * Server-only compiler output. App-specific validated handles may be attached,
 * but the Host revalidates the complete agent ID set before freezing it.
 */
export type CompiledAgentHostAgentSpec = AgentHostAgentSpec & {
  readonly resolvedPolicy?: Readonly<Record<string, unknown>>
  /** Required when resolvedPolicy contains opaque/non-JSON runtime handles. */
  readonly resolvedPolicyDigest?: string
}

export interface AgentFleetCompiler {
  compile(input: {
    readonly agents: readonly AgentHostAgentSpec[]
  }): Promise<readonly CompiledAgentHostAgentSpec[]>
}

export interface ResolvedEnvironmentScope {
  readonly placementIdentity: string
  readonly workspaceRoot: string
  /** Physical provider workspace identifier; defaults to the verified storage scope. */
  readonly runtimeWorkspaceId?: string
  readonly templatePath?: string
  readonly provisioningFingerprint: string
  readonly provisionRuntime?: (input: {
    readonly runtimeBundle: Awaited<ReturnType<RuntimeModeAdapter['create']>>
    readonly signal: AbortSignal
  }) => Promise<WorkspaceProvisioningResult | undefined>
}

export interface ResolvedAgentRuntimeScope {
  /** Complete app-canonicalized PL1 composition identity. */
  readonly identity: string
  /** Stable physical binding slot, independent of semantic resource revisions. */
  readonly physicalBindingIdentity?: string
  /** Canonical digest of the immutable plugin/resource inputs used by reload. */
  readonly resourceInputDigest?: string
  /**
   * Side-effect-free fence for path-backed reload resources. The Host invokes
   * it after classification, immediately before the effect, and after every
   * awaited apply/load stage so a successful receipt always matches the
   * resourceInputDigest recorded in the ledger.
   */
  readonly revalidateResourceInputs?: () => Promise<void>
  readonly environment: ResolvedEnvironmentScope
  readonly sessionNamespace: string
  readonly pi?: PiHarnessOptions
  readonly extraTools?: readonly AgentTool[]
  readonly includeFilesystemTools?: boolean
  readonly includeUploadTools?: boolean
  readonly sessionDir?: string
  readonly reloadMetadata?: {
    readonly diagnostics?: ReadonlyArray<{ readonly source: string; readonly message: string; readonly pluginId?: string }>
    readonly restartWarnings?: ReadonlyArray<{ readonly id: string; readonly surfaces: readonly string[]; readonly message: string }>
  }
  /**
   * Host-internal reload mutation. Candidate identity fields above must be
   * resolved without mutating plugin, backend, or runtime resource state.
   * The Host invokes this callback only after durable ownership, admission,
   * immutable identity classification, and the binding operation fence.
   */
  readonly applyReload?: (input: { readonly runtimeBundle: RuntimeBundle }) => Promise<{
    readonly diagnostics?: ReadonlyArray<{ readonly source: string; readonly message: string; readonly pluginId?: string }>
    readonly restartWarnings?: ReadonlyArray<{ readonly id: string; readonly surfaces: readonly string[]; readonly message: string }>
  } | undefined>
  readonly getFilesystemBindings?: (input: {
    readonly scope: VerifiedAgentScopeClaim
    readonly sessionId?: string
    readonly requestId: string
  }) => Promise<readonly RuntimeFilesystemBinding[] | undefined>
  /**
   * Skill-resource locator/catalog snapshot for the current reload
   * generation. Threaded through the capability-projection layer so
   * `/skills` can resolve package-managed skill locators without going
   * through the legacy path-shaped `additionalSkillPaths` hot-reload API.
   */
  readonly getSkillResourceSnapshot?: (input: {
    readonly scope: VerifiedAgentScopeClaim
    readonly sessionId?: string
    readonly requestId: string
  }) => Promise<AgentSkillResourceSnapshot | undefined>
  readonly systemPromptAppend?: string
  readonly loadSystemPromptAppend?: () => Promise<string | undefined>
}

export interface AuthorizedEnvironmentIntent {
  readonly kind: 'http-route' | 'dispatcher' | 'agent-binding'
  readonly requestId: string
}

export interface AgentHostEnvironmentScope extends ResolvedEnvironmentScope {
  /** App-owned environment decoration applied once to the canonical provider generation. */
  readonly transformRuntimeBundle?: (
    runtimeBundle: RuntimeBundle,
  ) => RuntimeBundle | Promise<RuntimeBundle>
  /** Evaluated for every authorized operation; never cached as placement authority. */
  readonly resolveFilesystemBindings?: (input: {
    readonly verifiedClaim: VerifiedAgentScopeClaim
    readonly requestId: string
  }) => Promise<readonly RuntimeFilesystemBinding[] | undefined>
}

export interface AgentHostEnvironmentLease {
  readonly workspace: Workspace
  readonly gitWorkspace: Workspace
  readonly fileSearch: FileSearch
  readonly filesystemBindings?: readonly RuntimeFilesystemBinding[]
  readonly readiness: Readonly<AgentCapabilityReadiness>
  readonly signal: AbortSignal
  release(): void
}

export interface AgentHostDispatcherRunInput extends WorkspaceAgentDirectRunInput {
  readonly authorizedScope: AuthorizedAgentScope
  readonly request?: FastifyRequest
}

export interface AgentHostDirectProjectionOptions {
  readonly authorizeAgentRequest: (
    request: FastifyRequest,
  ) => Promise<AuthorizedAgentScope>
  readonly filterModels?: import('../http/routes/models').ModelsRoutesOptions['filterModels']
  readonly sessionChangesTracker?: import('../http/sessionChangesTracker').SessionChangesTracker
  readonly defaultSessionId?: string
}

export interface AgentHostDescription {
  readonly hostId: string
  readonly agents: readonly {
    readonly agentTypeId: string
    readonly label: string
    /** Computed definition identity digest (instructions + knowledge bytes), when the spec carries one. */
    readonly definitionDigest?: string
  }[]
  readonly draining: boolean
}

export interface AgentHostHandle {
  readonly hostId: string
  describe(): Promise<AgentHostDescription>
  drain(): Promise<void>
  close(): Promise<void>
}

export interface CreateAgentHostOptions {
  readonly agents: readonly AgentHostAgentSpec[]
  readonly fleetCompiler: AgentFleetCompiler
  readonly hostId?: string
  readonly scopeVerifier: AgentScopeVerifier
  readonly runtimeModeAdapter: RuntimeModeAdapter
  readonly runtimeHost?: AgentRuntimeHostOperations
  readonly sessionRoot?: string
  readonly resolveAuthorizedEnvironmentScope?: (input: {
    readonly authorizedScope: AuthorizedAgentScope
    readonly verifiedClaim: VerifiedAgentScopeClaim
    readonly intent: AuthorizedEnvironmentIntent
  }) => Promise<AgentHostEnvironmentScope>
  readonly resolveAuthorizedAgentRuntimeScope?: (input: {
    readonly authorizedScope: AuthorizedAgentScope
    readonly verifiedClaim: VerifiedAgentScopeClaim
    readonly agentTypeId: string
    readonly intent: AuthorizedEnvironmentIntent & {
      readonly kind: 'agent-binding'
      readonly operation: 'new-binding' | 'existing-session' | 'reload'
      readonly sessionId?: string
    }
    readonly environment: AgentHostEnvironmentScope
  }) => Promise<Omit<ResolvedAgentRuntimeScope, 'environment'>>
  readonly telemetry?: TelemetrySink
  readonly metering?: AgentMeteringSink
  readonly requestLedger?: AgentRequestLedger
  /** Durable effect ledger path, independent of transcript/session storage. */
  readonly requestLedgerPath?: string
  /** Explicit test/dev opt-in for an in-memory ledger. */
  readonly inMemoryRequestLedgerMode?: 'test' | 'development'
  readonly requestRetentionMs?: number
  readonly effectAdmission?: AgentEffectAdmission
  readonly shutdownGraceMs?: number
  readonly harnessFactory?: AgentHarnessFactory
}

export interface CreatedAgentHost {
  readonly host: AgentHostHandle
  readonly gateway: AgentGateway
  registerDirectRoutes(options: AgentHostDirectProjectionOptions): FastifyPluginAsync
  acquireEnvironment(input: {
    readonly authorizedScope: AuthorizedAgentScope
    readonly intent: AuthorizedEnvironmentIntent
  }): Promise<AgentHostEnvironmentLease>
  runWithWorkspaceAgent(
    input: AgentHostDispatcherRunInput,
    run: (binding: LeaseBoundWorkspaceAgent) => Promise<void>,
  ): Promise<void>
}
