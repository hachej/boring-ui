import { createHash } from 'node:crypto'
import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
} from '@hachej/boring-bash/agent'
import type { Agent } from '../../shared/events'
import type { AgentCoreHarnessFactory, AgentHarness } from '../../shared/harness'
import type { AgentTool } from '../../shared/tool'
import type { SessionStore } from '../../shared/session'
import { collectToolReadinessRequirements, createAgentReadinessFromTracker } from '../agentReadiness'
import { createAgentRuntimeBridge } from '../createAgent'
import { withPiHarnessDefaults } from '../harness/pi-coding-agent/createHarness'
import type { HarnessPiChatService } from '../pi-chat/harnessPiChatService'
import { createRuntimeReadyStatusTracker } from '../runtime/modeReadiness'
import { getOptionalRuntimeBundleStorageRoot, type RuntimeBundle } from '../runtime/mode'
import type {
  CompiledAgentHostAgentSpec,
  CreateAgentHostOptions,
  ResolvedAgentRuntimeScope,
} from './types'

export interface BuildAgentCompositionInput {
  readonly agent: CompiledAgentHostAgentSpec
  readonly workspaceScopeId: string
  readonly runtimeScope: ResolvedAgentRuntimeScope
  readonly runtimeBundle: RuntimeBundle
  readonly options: Pick<
    CreateAgentHostOptions,
    'runtimeModeAdapter' | 'runtimeHost' | 'sessionRoot' | 'telemetry' | 'metering' | 'harnessFactory'
  >
}

export interface BuiltAgentComposition {
  readonly agent: Agent
  readonly harness: AgentHarness
  readonly sessionStore: SessionStore
  readonly service: HarnessPiChatService
  readonly tools: readonly AgentTool[]
  readonly runtimeScopeIdentity: string
  dispose(): Promise<void>
}

function safeScopeSegment(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 20)
}

/**
 * The one Agent-owned runtime assembly funnel. Callers resolve policy and
 * Environment inputs; this function alone builds tools, the harness bridge,
 * Pi chat service, and session store in their dependency order.
 */
export async function buildAgentComposition(
  input: BuildAgentCompositionInput,
): Promise<BuiltAgentComposition> {
  const { runtimeScope, runtimeBundle, options } = input
  const bashRuntimeBundle = {
    ...runtimeBundle,
    storageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
  }
  const tools: AgentTool[] = [
    ...buildHarnessAgentTools(bashRuntimeBundle),
    ...buildFilesystemAgentTools(bashRuntimeBundle, {
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
    }),
    ...(runtimeScope.extraTools ?? []),
  ]

  const readyTracker = createRuntimeReadyStatusTracker(options.runtimeModeAdapter, {
    harnessReady: true,
  })
  const pi = withPiHarnessDefaults(runtimeScope.pi)
  const baseHarnessFactory = options.harnessFactory
  const configured = !('legacyDefault' in input.agent)
  const configuredNamespace = configured
    ? [
        input.agent.agentTypeId,
        safeScopeSegment(input.workspaceScopeId),
        runtimeScope.sessionNamespace,
      ].filter(Boolean).join('--')
    : runtimeScope.sessionNamespace
  const authoredInstructions = configured
    ? input.agent.definition.instructions
    : undefined
  const staticPromptAppend = [authoredInstructions, runtimeScope.systemPromptAppend]
    .filter((part): part is string => Boolean(part))
    .join('\n\n') || undefined

  const bridge = createAgentRuntimeBridge({
    runtime: options.runtimeModeAdapter,
    tools,
    readiness: createAgentReadinessFromTracker({
      requirements: collectToolReadinessRequirements(tools),
      tracker: readyTracker,
    }),
    harnessFactory: (baseHarnessFactory
      ? async (factoryInput) => baseHarnessFactory({
          ...factoryInput,
          sessionRoot: options.sessionRoot,
          sessionNamespace: configuredNamespace,
        })
      : async (factoryInput) => {
          const { createPiCodingAgentHarness } = await import('../harness/pi-coding-agent/createHarness')
          return createPiCodingAgentHarness({
            ...factoryInput,
            pi,
            sessionRoot: options.sessionRoot,
            sessionNamespace: configuredNamespace,
          })
        }) as AgentCoreHarnessFactory,
    systemPromptAppend: staticPromptAppend,
    systemPromptDynamic: runtimeScope.loadSystemPromptAppend,
    telemetry: options.telemetry,
    metering: options.metering,
    sessionStorageRoot: options.sessionRoot,
    workdir: runtimeScope.environment.workspaceRoot,
  }, {
    service: {
      workdir: runtimeBundle.workspace.root,
      workspace: runtimeBundle.workspace,
    },
  })
  const runtime = await bridge.getRuntime()
  let disposed: Promise<void> | undefined

  return {
    agent: bridge.agent,
    harness: runtime.harness,
    sessionStore: runtime.sessionStore,
    service: runtime.service as HarnessPiChatService,
    tools,
    runtimeScopeIdentity: runtimeScope.identity,
    dispose() {
      disposed ??= bridge.agent.dispose()
      return disposed
    },
  }
}
