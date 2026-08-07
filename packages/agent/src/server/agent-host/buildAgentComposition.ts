import { join } from 'node:path'
import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
  buildUploadAgentTools,
} from '@hachej/boring-bash/agent'
import { createLogger } from '@hachej/boring-bash/server'
import type { AgentCoreHarnessFactory, AgentHarness, AgentHarnessFactory } from '../../shared/harness'
import type { AgentTool } from '../../shared/tool'
import type { SessionStore } from '../../shared/session'
import { withPiHarnessDefaults } from '../harness/pi-coding-agent/createHarness'
import { parseEncodedModelSelection } from '../models/modelConfig'
import { HarnessPiChatService } from '../pi-chat/harnessPiChatService'
import type { ReadyStatusTracker } from '../runtime/readyStatus'
import { createRuntimeReadyStatusTracker } from '../runtime/modeReadiness'
import { getOptionalRuntimeBundleStorageRoot, type RuntimeBundle } from '../runtime/mode'
import { openDatabase, type OpenDatabaseResult } from '../events/sqlStorage'
import { SqliteEventStreamStore, type EventStreamStore } from '../events/eventStreamStore'
import { safeCapture, type TelemetrySink } from '../../shared/telemetry'
import { ErrorCode } from '../../shared/error-codes'
import type {
  CompiledAgentHostAgentSpec,
  CreateAgentHostOptions,
  ResolvedAgentRuntimeScope,
} from './types'
import type { EnvironmentProvisioningSnapshot } from './environmentLease'
import { sessionNamespaceForAgent } from './sessionInventory'

/**
 * Flag-gated durable event streaming. When set (`1`/`true`), production
 * composition constructs a {@link SqliteEventStreamStore} on the host
 * session-root volume so `HarnessPiChatService` can resume live streams
 * across process restarts. Absent (default), behavior is byte-identical to
 * pre-durability composition: no store, in-memory streaming only.
 */
export const DURABLE_STREAM_ENV_FLAG = 'BORING_CHAT_DURABLE_STREAM'
export const EVENT_STORE_FILE_NAME = '.agent-event-stream.sqlite'

const logger = createLogger('agent-durable-stream')

export interface DurableStreamReadinessSnapshot {
  readonly mode: 'disabled' | 'active' | 'failed'
  readonly reason: string | null
  readonly storagePath: string | null
  readonly counts: {
    readonly streams: number
    readonly events: number
  }
}

export interface DurableEventStoreDecision {
  readonly opened?: { store: EventStreamStore; close: () => void }
  snapshot(): DurableStreamReadinessSnapshot
}

export function isDurableStreamEnabled(): boolean {
  const raw = process.env[DURABLE_STREAM_ENV_FLAG]
  return raw === '1' || raw === 'true'
}

/**
 * Opens (or creates) the durable event-stream SQLite database under the same
 * durable-volume root convention as session storage (AGENTS.md hard rule 9):
 * `sessionRoot` (the host's `BORING_AGENT_SESSION_ROOT`-derived path) when
 * set, else the HOST-side storage root resolved via
 * `getOptionalRuntimeBundleStorageRoot` — the same accessor already used
 * twelve lines above this call for `bashRuntimeBundle`. This deliberately
 * never falls back to `runtimeBundle.workspace.root`: in sandbox runtime
 * mode that is an IN-SANDBOX (guest) path, and writing the durable store
 * there would either fail invisibly or, worse, silently land the "durable"
 * store inside an ephemeral guest filesystem that vanishes with the sandbox.
 * If neither a session root nor a host storage root is resolvable, this
 * fails closed: no store is opened, a stable-coded diagnostic is reported,
 * and callers fall back to in-memory streaming rather than ever writing to
 * a guest path or crashing boot.
 */
export function openDurableEventStore(input: {
  readonly sessionRoot?: string
  readonly hostStorageRoot?: string
  readonly telemetry?: TelemetrySink
}): { store: EventStreamStore; close: () => void } | undefined {
  return decideDurableEventStore({ ...input, enabled: true }).opened
}

export function decideDurableEventStore(input: {
  readonly enabled: boolean
  readonly sessionRoot?: string
  readonly hostStorageRoot?: string
  readonly telemetry?: TelemetrySink
}): DurableEventStoreDecision {
  if (!input.enabled) {
    return {
      snapshot: () => ({
        mode: 'disabled',
        reason: `${DURABLE_STREAM_ENV_FLAG} is not enabled`,
        storagePath: null,
        counts: { streams: 0, events: 0 },
      }),
    }
  }

  const root = input.sessionRoot ?? input.hostStorageRoot
  if (!root) {
    const reason = 'No sessionRoot and no host storage root available; refusing to fall back to a sandbox/guest path.'
    reportEventStoreOpenFailure(input.telemetry, '(no host-resolvable root)', reason)
    return failedDurableEventStoreDecision(null, reason)
  }
  const path = join(root, EVENT_STORE_FILE_NAME)
  let opened: OpenDatabaseResult | undefined
  try {
    opened = openDatabase(path)
    let operationFailure: string | undefined
    const store = observeEventStoreFailures(
      new SqliteEventStreamStore(opened.sql, opened.runTransaction),
      (error) => { operationFailure ??= error instanceof Error ? error.message : String(error) },
    )
    return {
      opened: { store, close: () => opened!.db.close() },
      snapshot() {
        try {
          const streamRow = opened!.sql.exec('SELECT COUNT(*) AS count FROM boring_event_streams').toArray()[0]
          const eventRow = opened!.sql.exec('SELECT COUNT(*) AS count FROM boring_event_stream_entries').toArray()[0]
          return {
            mode: operationFailure ? 'failed' : 'active',
            reason: operationFailure ?? null,
            storagePath: path,
            counts: {
              streams: Number(streamRow?.count ?? 0),
              events: Number(eventRow?.count ?? 0),
            },
          }
        } catch (error) {
          return {
            mode: 'failed',
            reason: operationFailure ?? (error instanceof Error ? error.message : String(error)),
            storagePath: path,
            counts: { streams: 0, events: 0 },
          }
        }
      },
    }
  } catch (error) {
    try { opened?.db.close() } catch {}
    const reason = error instanceof Error ? error.message : String(error)
    reportEventStoreOpenFailure(input.telemetry, path, reason)
    return failedDurableEventStoreDecision(path, reason)
  }
}

function observeEventStoreFailures(
  store: EventStreamStore,
  onFailure: (error: unknown) => void,
): EventStreamStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver) as unknown
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        try {
          const result = Reflect.apply(member, target, args) as unknown
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            return Promise.resolve(result).catch((error) => {
              onFailure(error)
              throw error
            })
          }
          return result
        } catch (error) {
          onFailure(error)
          throw error
        }
      }
    },
  })
}

function failedDurableEventStoreDecision(
  storagePath: string | null,
  reason: string,
): DurableEventStoreDecision {
  return {
    snapshot: () => ({
      mode: 'failed',
      reason,
      storagePath,
      counts: { streams: 0, events: 0 },
    }),
  }
}

function reportEventStoreOpenFailure(telemetry: TelemetrySink | undefined, path: string, message: string): void {
  if (!telemetry) return
  safeCapture(telemetry, {
    name: 'agent.event-store.open-failed',
    properties: {
      code: ErrorCode.enum.EVENT_STORE_OPEN_FAILED,
      path,
      message,
    },
  })
}

export interface BuildAgentCompositionInput {
  readonly agent: CompiledAgentHostAgentSpec
  readonly workspaceScopeId: string
  readonly runtimeScope: ResolvedAgentRuntimeScope
  readonly runtimeBundle: RuntimeBundle
  readonly environmentProvisioning?: EnvironmentProvisioningSnapshot
  readonly options: Pick<
    CreateAgentHostOptions,
    'runtimeModeAdapter' | 'runtimeHost' | 'sessionRoot' | 'telemetry' | 'metering' | 'harnessFactory'
  >
  readonly observeSessionEvent?: (sessionId: string, event: import('../../shared/chat').PiChatEvent) => void
}

export interface BuiltAgentComposition {
  readonly harness: AgentHarness
  readonly sessionStore: SessionStore
  readonly service: HarnessPiChatService
  readonly tools: readonly AgentTool[]
  readonly runtimeBundle: RuntimeBundle
  readonly readyTracker: ReadyStatusTracker
  readonly durableStreamReadiness: DurableStreamReadinessSnapshot
  readonly runtimeScopeIdentity: string
  dispose(): Promise<void>
}

/**
 * The one Agent-owned runtime assembly funnel. Callers resolve policy and
 * Environment inputs; this function alone builds tools, the harness bridge,
 * Pi chat service, and session store in their dependency order.
 */
export async function buildAgentComposition(
  input: BuildAgentCompositionInput,
): Promise<BuiltAgentComposition> {
  const { runtimeScope, options } = input
  const runtimeBundle = input.runtimeBundle
  const bashRuntimeBundle = {
    ...runtimeBundle,
    storageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
  }
  const standardTools: AgentTool[] = [
    ...buildHarnessAgentTools(bashRuntimeBundle, input.environmentProvisioning
      ? {
          getCurrent: () => ({
            env: { ...input.environmentProvisioning!.env },
            pathEntries: [...input.environmentProvisioning!.pathEntries],
          }),
        }
      : undefined),
    ...(runtimeScope.includeFilesystemTools === false ? [] : buildFilesystemAgentTools(bashRuntimeBundle, {
      getFilesystemBindings: runtimeScope.getFilesystemBindings
          ? async (ctx) => [...await runtimeScope.getFilesystemBindings!({
              scope: {
                workspaceScopeId: input.workspaceScopeId,
                authSubjectId: ctx.userId ?? '',
              },
              sessionId: ctx.sessionId,
              requestId: ctx.requestId ?? '',
            }) ?? []]
          : undefined,
    })),
    ...(runtimeScope.includeUploadTools ? buildUploadAgentTools(bashRuntimeBundle) : []),
  ]
  const tools = [...standardTools, ...(runtimeScope.extraTools ?? [])]

  const readyTracker = createRuntimeReadyStatusTracker(options.runtimeModeAdapter, { harnessReady: true })
  const encodedPreferredModel = 'legacyDefault' in input.agent
    ? undefined
    : input.agent.model?.preferred
  const pi = withPiHarnessDefaults({
    ...runtimeScope.pi,
    defaultModel: parseEncodedModelSelection(encodedPreferredModel) ?? runtimeScope.pi?.defaultModel,
    strictModelResolution: encodedPreferredModel === undefined
      ? runtimeScope.pi?.strictModelResolution
      : true,
    additionalSkillPaths: [
      ...(input.environmentProvisioning?.skillPaths ?? []),
      ...(runtimeScope.pi?.additionalSkillPaths ?? []),
    ],
  })
  const baseHarnessFactory = options.harnessFactory
  const configured = !('legacyDefault' in input.agent)
  const configuredNamespace = sessionNamespaceForAgent(
    input.agent,
    input.workspaceScopeId,
    runtimeScope.sessionNamespace,
  )
  const authoredInstructions = configured
    ? input.agent.definition.instructions
    : undefined
  const staticPromptAppend = [authoredInstructions, runtimeScope.systemPromptAppend]
    .filter((part): part is string => Boolean(part))
    .join('\n\n') || undefined

  const harnessFactory = (baseHarnessFactory
      ? async (factoryInput) => baseHarnessFactory({
          ...factoryInput,
          sessionRoot: options.sessionRoot,
          sessionNamespace: configuredNamespace,
          sessionDir: runtimeScope.sessionDir ?? factoryInput.sessionDir,
        })
      : async (factoryInput) => {
          const { createPiCodingAgentHarness } = await import('../harness/pi-coding-agent/createHarness')
          return createPiCodingAgentHarness({
            ...factoryInput,
            pi,
            sessionRoot: options.sessionRoot,
            sessionNamespace: configuredNamespace,
            sessionDir: runtimeScope.sessionDir ?? factoryInput.sessionDir,
          })
        }) as AgentCoreHarnessFactory
  const harness = await harnessFactory({
    tools,
    cwd: runtimeScope.environment.workspaceRoot,
    runtimeCwd: runtimeBundle.workspace.root,
    systemPromptAppend: staticPromptAppend,
    systemPromptDynamic: runtimeScope.loadSystemPromptAppend,
    sessionRoot: options.sessionRoot,
    telemetry: options.telemetry,
  })
  const sessionStore = harness.sessions
  const durableEventStore = decideDurableEventStore({
    enabled: isDurableStreamEnabled(),
    sessionRoot: options.sessionRoot,
    hostStorageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
    telemetry: options.telemetry,
  })
  logger.info('durable stream boot decision', { ...durableEventStore.snapshot() })
  const service = new HarnessPiChatService({
    harness,
    sessionStore,
    workdir: runtimeBundle.workspace.root,
    workspace: runtimeBundle.workspace,
    onEvent: input.observeSessionEvent,
    attachmentUrl: ({ sessionId, messageId, index }) =>
      `/api/v1/agents/${encodeURIComponent(input.agent.agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(messageId)}/${index}`,
    metering: options.metering,
    eventStore: durableEventStore.opened?.store,
  })
  let disposed: Promise<void> | undefined

  return {
    harness,
    sessionStore,
    service,
    tools,
    runtimeBundle,
    readyTracker,
    get durableStreamReadiness() {
      return durableEventStore.snapshot()
    },
    runtimeScopeIdentity: runtimeScope.identity,
    dispose() {
      disposed ??= service.dispose().finally(() => durableEventStore.opened?.close())
      return disposed
    },
  }
}
