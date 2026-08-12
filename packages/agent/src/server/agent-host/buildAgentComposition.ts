import { join } from 'node:path'
import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
  buildUploadAgentTools,
} from '@hachej/boring-bash/agent'
import type { AgentCoreHarnessFactory, AgentHarness, AgentHarnessFactory } from '../../shared/harness'
import type { AgentTool } from '../../shared/tool'
import type { SessionStore } from '../../shared/session'
import { withPiHarnessDefaults } from '../harness/pi-coding-agent/createHarness'
import { parseEncodedModelSelection } from '../models/modelConfig'
import { HarnessPiChatService } from '../pi-chat/harnessPiChatService'
import type { ReadyStatusTracker } from '../runtime/readyStatus'
import { createRuntimeReadyStatusTracker } from '../runtime/modeReadiness'
import { getOptionalRuntimeBundleStorageRoot, type RuntimeBundle, type RuntimeFilesystemBinding } from '../runtime/mode'
import { AGENT_KNOWLEDGE_FILESYSTEM_ID } from '../../shared/skill-resource'
import { mergeRuntimeFilesystemBindings } from '../runtime/filesystemBindings'
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
 * If the store cannot be opened while the durable-stream flag is on —
 * because neither a session root nor a host storage root is resolvable, or
 * because `openDatabase` fails at the resolved path — this fails LOUDLY:
 * a stable-coded telemetry diagnostic is reported and a
 * {@link DurableStreamUnavailableError} (code `DURABLE_STREAM_UNAVAILABLE`,
 * carrying the underlying cause) is thrown so boot aborts. The operator
 * asked for durability; silently degrading to in-memory streaming would
 * betray that. Flag off = this function is never called and behavior is
 * byte-identical to pre-durability composition.
 */
export function openDurableEventStore(input: {
  readonly sessionRoot?: string
  readonly hostStorageRoot?: string
  readonly telemetry?: TelemetrySink
}): { store: EventStreamStore; close: () => void } {
  const root = input.sessionRoot ?? input.hostStorageRoot
  if (!root) {
    const reason = 'No sessionRoot and no host storage root available; refusing to fall back to a sandbox/guest path.'
    reportEventStoreOpenFailure(input.telemetry, '(no host-resolvable root)', reason)
    throw new DurableStreamUnavailableError('(no host-resolvable root)', reason)
  }
  const path = join(root, EVENT_STORE_FILE_NAME)
  let opened: OpenDatabaseResult
  try {
    opened = openDatabase(path)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    reportEventStoreOpenFailure(input.telemetry, path, reason)
    throw new DurableStreamUnavailableError(path, reason, error)
  }
  return {
    store: new SqliteEventStreamStore(opened.sql, opened.runTransaction),
    close: () => opened.db.close(),
  }
}

/**
 * Boot-time failure: `BORING_CHAT_DURABLE_STREAM` is enabled but the durable
 * event-stream store could not be opened. Thrown instead of silently falling
 * back to in-memory streaming.
 */
export class DurableStreamUnavailableError extends Error {
  readonly code = ErrorCode.enum.DURABLE_STREAM_UNAVAILABLE

  constructor(path: string, reason: string, cause?: unknown) {
    super(`${DURABLE_STREAM_ENV_FLAG} is enabled but the durable event-stream store could not be opened at ${path}: ${reason}`, cause === undefined ? undefined : { cause })
    this.name = 'DurableStreamUnavailableError'
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
  // Agent-carried knowledge (`knowledge/` inside the definition package)
  // becomes a readonly, agent-scoped filesystem binding. Built here — the
  // one Agent-owned assembly funnel — so every host (workspace, core, CLI hub)
  // gets it without per-host wiring, and sibling agents never see it. A
  // declared-but-unmountable knowledge folder fails this agent's composition
  // closed.
  const knowledgeRootDir = 'legacyDefault' in input.agent
    ? undefined
    : input.agent.knowledge?.rootDir
  let knowledgeBinding: RuntimeFilesystemBinding | undefined
  if (knowledgeRootDir !== undefined) {
    const runtimeHostOperations = options.runtimeHost ?? runtimeBundle.runtimeHost
    if (!runtimeHostOperations) {
      throw Object.assign(
        new Error('agent knowledge requires runtime host filesystem-binding operations'),
        { code: ErrorCode.enum.CONFIG_INVALID },
      )
    }
    knowledgeBinding = Object.freeze({
      ...await runtimeHostOperations.createAgentResourceFilesystemBinding(
        AGENT_KNOWLEDGE_FILESYSTEM_ID,
        [{ logicalRoot: '/', sourceRoot: knowledgeRootDir }],
      ),
    })
  }
  const scopedKnowledgeBinding = knowledgeBinding
  // Request-scoped bindings REPLACE the bundle defaults at the tool layer, so
  // the bundle's own bindings must be merged back in (host policy intersecting
  // any same-id request binding) before appending the agent-scoped knowledge
  // filesystem — same merge seam as origin/feat/1107-s1-discovery.
  const getFilesystemBindings = runtimeScope.getFilesystemBindings || scopedKnowledgeBinding
    ? async (ctx: { sessionId?: string; userId?: string; requestId?: string }) => [
        ...mergeRuntimeFilesystemBindings(
          runtimeBundle.filesystemBindings,
          [
            ...await runtimeScope.getFilesystemBindings?.({
              scope: {
                workspaceScopeId: input.workspaceScopeId,
                authSubjectId: ctx.userId ?? '',
              },
              sessionId: ctx.sessionId,
              requestId: ctx.requestId ?? '',
            }) ?? [],
            ...(scopedKnowledgeBinding ? [scopedKnowledgeBinding] : []),
          ],
        ) ?? [],
      ]
    : undefined
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
      getFilesystemBindings,
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
  const durableEventStore = isDurableStreamEnabled()
    ? openDurableEventStore({
        sessionRoot: options.sessionRoot,
        hostStorageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
        telemetry: options.telemetry,
      })
    : undefined
  const service = new HarnessPiChatService({
    harness,
    sessionStore,
    workdir: runtimeBundle.workspace.root,
    workspace: runtimeBundle.workspace,
    onEvent: input.observeSessionEvent,
    attachmentUrl: ({ sessionId, messageId, index }) =>
      `/api/v1/agents/${encodeURIComponent(input.agent.agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(messageId)}/${index}`,
    metering: options.metering,
    eventStore: durableEventStore?.store,
  })
  let disposed: Promise<void> | undefined

  return {
    harness,
    sessionStore,
    service,
    tools,
    runtimeBundle,
    readyTracker,
    runtimeScopeIdentity: runtimeScope.identity,
    dispose() {
      disposed ??= service.dispose().finally(() => durableEventStore?.close())
      return disposed
    },
  }
}
