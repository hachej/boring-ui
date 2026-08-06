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
import { getOptionalRuntimeBundleStorageRoot, type RuntimeBundle } from '../runtime/mode'
import { composeRuntimeAndGovernanceFilesystemBindings } from '../runtime/filesystemBindings'
import type {
  CompiledAgentHostAgentSpec,
  CreateAgentHostOptions,
  ResolvedAgentRuntimeScope,
} from './types'
import type { EnvironmentProvisioningSnapshot } from './environmentLease'
import { sessionNamespaceForAgent } from './sessionInventory'

/**
 * Internal-only escape hatch for legacy/compat callers that need to bypass a
 * piece of the canonical composition sequence (for example, tests that don't
 * wire a full `runtimeModeAdapter` and must supply their own `readyTracker`).
 * Never populated by the Host's own resolution path.
 */
export interface AgentCompositionCompatibility {
  readonly readyTracker?: ReadyStatusTracker
}

export interface BuildAgentCompositionInput {
  readonly agent: CompiledAgentHostAgentSpec
  readonly workspaceScopeId: string
  readonly runtimeScope: ResolvedAgentRuntimeScope & { readonly compatibility?: AgentCompositionCompatibility }
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
  // Reject a runtime-declared duplicate binding before any tool/harness
  // startup work — a misconfigured runtime bundle must fail closed rather
  // than let a later binding silently shadow an earlier one.
  const runtimeBundle = input.runtimeBundle.filesystemBindings
    ? {
        ...input.runtimeBundle,
        filesystemBindings: [...composeRuntimeAndGovernanceFilesystemBindings(
          input.runtimeBundle.filesystemBindings,
          undefined,
        ).bindings],
      }
    : input.runtimeBundle
  const bashRuntimeBundle = {
    ...runtimeBundle,
    storageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
  }
  const resolveGovernanceBindings = runtimeScope.getFilesystemBindings
    ? async (ctx: { readonly sessionId?: string; readonly userId?: string; readonly requestId?: string }) => [
        ...await runtimeScope.getFilesystemBindings!({
          scope: {
            workspaceScopeId: input.workspaceScopeId,
            authSubjectId: ctx.userId ?? '',
          },
          sessionId: ctx.sessionId,
          requestId: ctx.requestId ?? '',
        }) ?? [],
      ]
    : undefined
  const getFilesystemBindings = resolveGovernanceBindings
    ? async (ctx: Parameters<NonNullable<typeof resolveGovernanceBindings>>[0]) => [
        ...composeRuntimeAndGovernanceFilesystemBindings(
          runtimeBundle.filesystemBindings,
          await resolveGovernanceBindings(ctx),
        ).bindings,
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

  const readyTracker = runtimeScope.compatibility?.readyTracker
    ?? createRuntimeReadyStatusTracker(options.runtimeModeAdapter, { harnessReady: true })
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
  const service = new HarnessPiChatService({
    harness,
    sessionStore,
    workdir: runtimeBundle.workspace.root,
    workspace: runtimeBundle.workspace,
    onEvent: input.observeSessionEvent,
    attachmentUrl: ({ sessionId, messageId, index }) =>
      `/api/v1/agents/${encodeURIComponent(input.agent.agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(messageId)}/${index}`,
    metering: options.metering,
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
      disposed ??= service.dispose()
      return disposed
    },
  }
}
