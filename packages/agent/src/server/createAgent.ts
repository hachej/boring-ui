import { HarnessPiChatService } from './pi-chat/harnessPiChatService'
import type { EventStreamStore } from './events/eventStreamStore'
import type { AgentMeteringSink } from './pi-chat/metering'
import type { AgentHarness, AgentHarnessFactoryInput } from '../shared/harness'
import type { Workspace } from '../shared/workspace'
import type {
  Agent,
  AgentConfig,
} from '../shared/events'
import type { SessionStore } from '../shared/session'
import { createPureRuntimeCwd } from './runtime/pureRuntime'
import type { InputAssetIntakeDecision } from '../core/inputAssetIntake'
import { createAgentRuntimeBridge as createCoreAgentRuntimeBridge } from '../core/createAgent'

const DEFAULT_WORKDIR = ''

interface AgentRuntime {
  harness: AgentHarness
  sessionStore: SessionStore
  service: HarnessPiChatService
  dispose?(): Promise<void> | void
}

export interface AgentRuntimeAdapterView {
  harness: AgentHarness
  sessionStore: SessionStore
  service: unknown
}

export interface CreateAgentRuntimeBridgeOptions {
  /**
   * RuntimeModeAdapter.dispose() is adapter-global. Request-scoped route
   * bindings dispose their facade per binding and close the shared adapter once
   * from the profile onClose hook.
   */
  disposeRuntime?: boolean
  harness?: {
    runtimeCwd?: string
  }
  service?: {
    workdir?: string
    workspace?: Workspace
    eventStore?: EventStreamStore
  }
}

export interface AgentRuntimeBridge {
  agent: Agent
  getRuntime(): Promise<AgentRuntimeAdapterView>
  currentRuntime(): Promise<AgentRuntimeAdapterView> | undefined
}

export function createAgent(config: AgentConfig): Agent {
  return createAgentRuntimeBridge(config).agent
}

export function createAgentRuntimeBridge(
  config: AgentConfig,
  options: CreateAgentRuntimeBridgeOptions = {},
): AgentRuntimeBridge {
  if (config.sessions && !config.harnessFactory) {
    throw new Error('createAgent sessions override requires a harnessFactory that uses the same SessionStore')
  }

  const bridge = createCoreAgentRuntimeBridge({
    ...config,
    runtimeFactory: (input) => createRuntime(config, options, input.inputAssetIntake),
  })
  const coreAgent = bridge.agent
  return {
    ...bridge,
    agent: {
      ...coreAgent,
      async dispose() {
        const runtimeLoaded = bridge.currentRuntime() !== undefined
        try {
          await coreAgent.dispose()
        } finally {
          if (!runtimeLoaded && config.runtime !== 'none') await config.runtime.dispose?.()
        }
      },
    },
  }
}

async function createRuntime(
  config: AgentConfig,
  options: CreateAgentRuntimeBridgeOptions,
  inputAssetIntake: InputAssetIntakeDecision,
): Promise<AgentRuntime> {
  const pureRuntimeCwd = config.runtime === 'none'
    ? await createPureRuntimeCwd(config.sessionStorageRoot)
    : undefined
  const harnessInput: AgentHarnessFactoryInput = {
    tools: config.tools ?? [],
    cwd: pureRuntimeCwd ?? config.workdir ?? DEFAULT_WORKDIR,
    runtimeCwd: pureRuntimeCwd ?? options.harness?.runtimeCwd ?? options.service?.workdir ?? config.workdir,
    sessionStorageCwd: pureRuntimeCwd ? DEFAULT_WORKDIR : undefined,
    systemPromptAppend: config.systemPromptAppend,
    systemPromptDynamic: config.systemPromptDynamic,
    sessionRoot: config.sessionStorageRoot,
    telemetry: config.telemetry,
  }
  const harness = config.harnessFactory
    ? await config.harnessFactory(harnessInput)
    : await createDefaultPiHarness(config, harnessInput)
  const sessionStore = config.sessions ?? harness.sessions
  const runtimeDispose = config.runtime !== 'none' && options.disposeRuntime !== false
    ? config.runtime.dispose?.bind(config.runtime)
    : undefined
  return {
    harness,
    sessionStore,
    service: new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: pureRuntimeCwd ?? options.service?.workdir ?? config.workdir ?? DEFAULT_WORKDIR,
      workspace: options.service?.workspace,
      eventStore: options.service?.eventStore,
      inputAssetIntake,
      metering: config.metering as AgentMeteringSink | undefined,
    }),
    ...(runtimeDispose ? { dispose: runtimeDispose } : {}),
  }
}

async function createDefaultPiHarness(config: AgentConfig, input: AgentHarnessFactoryInput): Promise<AgentHarness> {
  const piHarness = await import('./harness/pi-coding-agent/createHarness')
  return piHarness.createPiCodingAgentHarness({
    ...input,
    ...(config.runtime === 'none'
      ? { pi: piHarness.withPurePiHarnessDefaults() }
      : {}),
  })
}
