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
  RuntimeFilesystemBinding,
  RuntimeModeAdapter,
} from '../runtime/mode'
import type { AgentRuntimeHostOperations } from '../runtime/runtimeHost'
import type { WorkspaceProvisioningResult } from '../workspace/provisioning'
import type { PiHarnessOptions } from '../harness/pi-coding-agent/createHarness'

export type AgentGatewayEffect =
  | 'session.create'
  | 'session.rename'
  | 'session.delete'
  | 'session.prompt'
  | 'session.followup'
  | 'session.interrupt'
  | 'session.stop'
  | 'session.queue.clear'

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

export type AgentRequestFailure =
  | { readonly kind: 'gateway'; readonly error: AgentGatewayErrorDTO }
  | {
      /** Server-only compatibility envelope; never returned by AgentGateway. */
      readonly kind: 'legacy-admission'
      readonly code: string
      readonly statusCode: 500
      readonly message: string
      readonly details?: JsonValue
    }
  | {
      /** Server-only observed legacy service failure; never returned by AgentGateway. */
      readonly kind: 'legacy-service'
      readonly name: string
      readonly message: string
      readonly code?: string
      readonly statusCode?: number
      readonly retryable?: boolean
      readonly details?: JsonValue
    }

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
  prepare(key: AgentRequestKey, digest: string): Promise<AgentRequestLedgerRecord>
  acceptAdmission(key: AgentRequestKey, admissionReceipt: string): Promise<void>
  beginEffect(key: AgentRequestKey): Promise<void>
  reject(key: AgentRequestKey, failure: AgentRequestFailure): Promise<void>
  complete(key: AgentRequestKey, receipt: JsonValue): Promise<void>
  markOutcomeUnknown(key: AgentRequestKey, error: AgentGatewayErrorDTO): Promise<void>
  read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined>
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
  }
  readonly plugins?: readonly {
    /** Canonical app-preflighted plugin ID. */
    readonly name: string
    readonly config?: JsonValue
  }[]
  readonly model?: {
    readonly preferred?: string
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
}

export interface AgentFleetCompiler {
  compile(input: {
    readonly agents: readonly AgentHostAgentSpec[]
  }): Promise<readonly CompiledAgentHostAgentSpec[]>
}

export interface ResolvedEnvironmentScope {
  readonly placementIdentity: string
  readonly workspaceRoot: string
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
  readonly environment: ResolvedEnvironmentScope
  readonly sessionNamespace: string
  readonly pi?: PiHarnessOptions
  readonly extraTools?: readonly AgentTool[]
  readonly getFilesystemBindings?: (input: {
    readonly scope: VerifiedAgentScopeClaim
    readonly sessionId?: string
    readonly requestId: string
  }) => Promise<readonly RuntimeFilesystemBinding[] | undefined>
  readonly systemPromptAppend?: string
  readonly loadSystemPromptAppend?: () => Promise<string | undefined>
}

export interface AgentHostHttpProjectionOptions {
  readonly authorizeRequest: (
    request: FastifyRequest,
  ) => Promise<AuthorizedAgentScope>
  readonly defaultAgentTypeId: string
  readonly legacyPiChatAliases?: boolean
}

export interface AgentHostDescription {
  readonly hostId: string
  readonly agents: readonly {
    readonly agentTypeId: string
    readonly label: string
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
  readonly resolveRuntimeScope: (input: {
    readonly agentTypeId: string
    readonly scope: AuthorizedAgentScope
  }) => Promise<ResolvedAgentRuntimeScope>
  readonly telemetry?: TelemetrySink
  readonly metering?: AgentMeteringSink
  readonly requestLedger?: AgentRequestLedger
  readonly requestRetentionMs?: number
  readonly effectAdmission?: AgentEffectAdmission
  readonly shutdownGraceMs?: number
  readonly harnessFactory?: AgentHarnessFactory
}

export interface CreatedAgentHost {
  readonly host: AgentHostHandle
  readonly gateway: AgentGateway
  registerRoutes(options: AgentHostHttpProjectionOptions): FastifyPluginAsync
}
