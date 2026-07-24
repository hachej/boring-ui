import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
  buildUploadAgentTools,
  type HarnessRuntimeProvisioningOptions,
  type ToolReadinessCheck,
} from '@hachej/boring-bash/agent'
import type { Agent, AgentConfig } from '../../shared/events'
import type { AgentCoreHarnessFactory, AgentHarness, AgentHarnessFactory } from '../../shared/harness'
import type { AgentTool } from '../../shared/tool'
import type { SessionStore } from '../../shared/session'
import { collectToolReadinessRequirements, createAgentReadinessFromTracker } from '../agentReadiness'
import {
  createAgentRuntimeBridge,
  type CreateAgentRuntimeBridgeOptions,
} from '../createAgent'
import { withPiHarnessDefaults } from '../harness/pi-coding-agent/createHarness'
import type { HarnessPiChatService } from '../pi-chat/harnessPiChatService'
import type { ReadyStatusTracker } from '../runtime/readyStatus'
import { createRuntimeReadyStatusTracker } from '../runtime/modeReadiness'
import { getOptionalRuntimeBundleStorageRoot, type RuntimeBundle } from '../runtime/mode'
import type { AgentEffectAdmission } from '../../core/piChatSessionService'
import type {
  CompiledAgentHostAgentSpec,
  CreateAgentHostOptions,
  ResolvedAgentRuntimeScope,
} from './types'
import type { EnvironmentProvisioningSnapshot } from './environmentLease'
import { sessionNamespaceForAgent } from './sessionInventory'

export interface AgentCompositionToolGroups {
  readonly standardTools: AgentTool[]
  readonly extraTools: AgentTool[]
  readonly pluginTools: readonly { readonly pluginName: string; readonly tools: AgentTool[] }[]
}

/**
 * Internal-only inputs used by the legacy wrappers to project their frozen
 * route/app policies onto the canonical Host construction sequence. They are
 * contributions to the sequence below, never an alternate composition path.
 */
export interface AgentCompositionCompatibility {
  readonly transformRuntimeBundle?: (runtimeBundle: RuntimeBundle) => RuntimeBundle | Promise<RuntimeBundle>
  readonly harnessRuntime?: HarnessRuntimeProvisioningOptions
  readonly includeFilesystemTools?: boolean
  readonly includeUploadTools?: boolean
  readonly additionalStandardTools?: readonly AgentTool[]
  readonly resolveExtraTools?: (runtimeBundle: RuntimeBundle) => readonly AgentTool[] | Promise<readonly AgentTool[]>
  readonly pluginTools?: readonly { readonly pluginName: string; readonly tools: AgentTool[] }[]
  readonly finalizeTools?: (groups: AgentCompositionToolGroups) => AgentTool[]
  readonly getFilesystemBindings?: (ctx: {
    readonly sessionId?: string
    readonly workspaceId?: string
    readonly userId?: string
    readonly userEmail?: string
    readonly userEmailVerified?: boolean
    readonly requestId?: string
  }) => import('../runtime/mode').RuntimeFilesystemBinding[] | undefined | Promise<import('../runtime/mode').RuntimeFilesystemBinding[] | undefined>
  readonly readyTracker?: ReadyStatusTracker
  readonly checkReadiness?: ToolReadinessCheck
  readonly harnessFactory?: AgentHarnessFactory
  readonly sessionDir?: string
  readonly admitEffect?: AgentEffectAdmission
}

export type CompatibilityResolvedAgentRuntimeScope = Omit<ResolvedAgentRuntimeScope, 'environment'> & {
  readonly environment: ResolvedAgentRuntimeScope['environment'] & {
    /** Frozen legacy adapter-create context not present in the canonical DTO. */
    readonly compatibilityModeContext?: Partial<Parameters<CreateAgentHostOptions['runtimeModeAdapter']['create']>[0]>
  }
  readonly compatibility?: AgentCompositionCompatibility
}

export interface BuildAgentCompositionInput {
  readonly agent: CompiledAgentHostAgentSpec
  readonly workspaceScopeId: string
  readonly runtimeScope: CompatibilityResolvedAgentRuntimeScope
  readonly runtimeBundle: RuntimeBundle
  readonly environmentProvisioning?: EnvironmentProvisioningSnapshot
  readonly options: Pick<
    CreateAgentHostOptions,
    'runtimeModeAdapter' | 'runtimeHost' | 'sessionRoot' | 'telemetry' | 'metering' | 'harnessFactory'
  >
  readonly observeSessionEvent?: (sessionId: string, event: import('../../shared/chat').PiChatEvent) => void
}

export interface BuiltAgentComposition {
  readonly agent: Agent
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
  const compatibility = runtimeScope.compatibility
  const runtimeBundle = compatibility?.transformRuntimeBundle
    ? await compatibility.transformRuntimeBundle(input.runtimeBundle)
    : input.runtimeBundle
  const bashRuntimeBundle = {
    ...runtimeBundle,
    storageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
  }
  const standardTools: AgentTool[] = [
    ...buildHarnessAgentTools(bashRuntimeBundle, compatibility?.harnessRuntime ?? (
      input.environmentProvisioning
        ? {
            getCurrent: () => ({
              env: { ...input.environmentProvisioning!.env },
              pathEntries: [...input.environmentProvisioning!.pathEntries],
            }),
          }
        : undefined
    )),
    ...(compatibility?.includeFilesystemTools === false ? [] : buildFilesystemAgentTools(bashRuntimeBundle, {
      getFilesystemBindings: compatibility?.getFilesystemBindings
        ?? (runtimeScope.getFilesystemBindings
          ? async (ctx) => [...await runtimeScope.getFilesystemBindings!({
              scope: {
                workspaceScopeId: input.workspaceScopeId,
                authSubjectId: ctx.userId ?? '',
              },
              sessionId: ctx.sessionId,
              requestId: ctx.requestId ?? '',
            }) ?? []]
          : undefined),
    })),
    ...(compatibility?.includeUploadTools ? buildUploadAgentTools(bashRuntimeBundle) : []),
    ...(compatibility?.additionalStandardTools ?? []),
  ]
  const groups: AgentCompositionToolGroups = {
    standardTools,
    extraTools: [
      ...(runtimeScope.extraTools ?? []),
      ...(await compatibility?.resolveExtraTools?.(runtimeBundle) ?? []),
    ],
    pluginTools: compatibility?.pluginTools ?? [],
  }
  const tools = compatibility?.finalizeTools
    ? compatibility.finalizeTools(groups)
    : [...groups.standardTools, ...groups.extraTools, ...groups.pluginTools.flatMap((plugin) => plugin.tools)]

  const readyTracker = compatibility?.readyTracker
    ?? createRuntimeReadyStatusTracker(options.runtimeModeAdapter, { harnessReady: true })
  const pi = withPiHarnessDefaults({
    ...runtimeScope.pi,
    additionalSkillPaths: [
      ...(input.environmentProvisioning?.skillPaths ?? []),
      ...(runtimeScope.pi?.additionalSkillPaths ?? []),
    ],
  })
  const baseHarnessFactory = compatibility?.harnessFactory ?? options.harnessFactory
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

  const config: AgentConfig = {
    runtime: options.runtimeModeAdapter,
    tools,
    readiness: createAgentReadinessFromTracker({
      requirements: collectToolReadinessRequirements(tools),
      tracker: readyTracker,
      checkReadiness: compatibility?.checkReadiness,
    }),
    harnessFactory: (baseHarnessFactory
      ? async (factoryInput) => baseHarnessFactory({
          ...factoryInput,
          sessionRoot: options.sessionRoot,
          sessionNamespace: configuredNamespace,
          sessionDir: compatibility?.sessionDir ?? factoryInput.sessionDir,
        })
      : async (factoryInput) => {
          const { createPiCodingAgentHarness } = await import('../harness/pi-coding-agent/createHarness')
          return createPiCodingAgentHarness({
            ...factoryInput,
            pi,
            sessionRoot: options.sessionRoot,
            sessionNamespace: configuredNamespace,
            sessionDir: compatibility?.sessionDir ?? factoryInput.sessionDir,
          })
        }) as AgentCoreHarnessFactory,
    systemPromptAppend: staticPromptAppend,
    systemPromptDynamic: runtimeScope.loadSystemPromptAppend,
    telemetry: options.telemetry,
    metering: options.metering,
    sessionStorageRoot: options.sessionRoot,
    workdir: runtimeScope.environment.workspaceRoot,
  }
  const bridgeOptions: CreateAgentRuntimeBridgeOptions = {
    service: {
      admitEffect: compatibility?.admitEffect,
      workdir: runtimeBundle.workspace.root,
      workspace: runtimeBundle.workspace,
      onEvent: input.observeSessionEvent,
    },
  }
  const bridge = createAgentRuntimeBridge(config, bridgeOptions)
  const runtime = await bridge.getRuntime()
  let disposed: Promise<void> | undefined

  return {
    agent: bridge.agent,
    harness: runtime.harness,
    sessionStore: runtime.sessionStore,
    service: runtime.service as HarnessPiChatService,
    tools,
    runtimeBundle,
    readyTracker,
    runtimeScopeIdentity: runtimeScope.identity,
    dispose() {
      disposed ??= bridge.agent.dispose()
      return disposed
    },
  }
}
