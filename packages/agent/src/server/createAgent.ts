import { createAgentRuntimeBridge as createCoreAgentRuntimeBridge } from '../core/createAgent'
import type { AgentCoreRuntime } from '../core/createAgent'
import type { AgentEffectAdmission } from '../core/piChatSessionService'
import { ErrorCode } from '../shared/error-codes'
import type { Agent, AgentConfig } from '../shared/events'
import type { AgentHarness, AgentHarnessFactoryInput } from '../shared/harness'
import type { SessionStore } from '../shared/session'
import type { Workspace } from '../shared/workspace'
import type { EventStreamStore } from './events/eventStreamStore'
import { HarnessPiChatService } from './pi-chat/harnessPiChatService'
import type { AgentMeteringSink } from './pi-chat/metering'

const DEFAULT_WORKDIR = ''

interface AgentRuntime extends AgentCoreRuntime {
  harness: AgentHarness
  sessionStore: SessionStore
  service: HarnessPiChatService
}

export interface AgentRuntimeAdapterView {
  harness: AgentHarness
  sessionStore: SessionStore
  service: unknown
}

export interface CreateAgentRuntimeBridgeOptions {
  harness?: {
    runtimeCwd?: string
    nativeSessionStartEnabled?: boolean
  }
  service?: {
    admitEffect?: AgentEffectAdmission
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
  assertRuntimeAdapter(config.runtime)
  if (config.sessions && !config.harnessFactory) {
    throw new Error('createAgent sessions override requires a harnessFactory that uses the same SessionStore')
  }

  return createCoreAgentRuntimeBridge({
    runtimeFactory: () => createRuntime(config, options),
    admitEffect: options.service?.admitEffect,
    readiness: config.readiness,
    readinessRequirements: config.readinessRequirements,
  })
}

async function createRuntime(
  config: AgentConfig,
  options: CreateAgentRuntimeBridgeOptions,
): Promise<AgentRuntime> {
  const harnessFactory = config.harnessFactory ?? (await import('./harness/pi-coding-agent/createHarness')).createPiCodingAgentHarness
  const harnessInput: AgentHarnessFactoryInput = {
    tools: config.tools ?? [],
    cwd: config.workdir ?? DEFAULT_WORKDIR,
    runtimeCwd: options.harness?.runtimeCwd ?? options.service?.workdir ?? config.workdir,
    nativeSessionStartEnabled: options.harness?.nativeSessionStartEnabled,
    systemPromptAppend: config.systemPromptAppend,
    systemPromptDynamic: config.systemPromptDynamic,
    sessionRoot: config.sessionStorageRoot,
    telemetry: config.telemetry,
  }
  const harness = await harnessFactory(harnessInput)
  const sessionStore = config.sessions ?? harness.sessions
  return {
    harness,
    sessionStore,
    service: new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: options.service?.workdir ?? config.workdir ?? DEFAULT_WORKDIR,
      workspace: options.service?.workspace,
      eventStore: options.service?.eventStore,
      metering: config.metering as AgentMeteringSink | undefined,
    }),
  }
}

function assertRuntimeAdapter(runtime: unknown): asserts runtime is AgentConfig['runtime'] {
  if (
    typeof runtime !== 'object' ||
    runtime === null ||
    typeof (runtime as { id?: unknown }).id !== 'string' ||
    (runtime as { id: string }).id.trim().length === 0 ||
    (
      (runtime as { dispose?: unknown }).dispose !== undefined &&
      typeof (runtime as { dispose?: unknown }).dispose !== 'function'
    )
  ) {
    throw stableAgentError(
      ErrorCode.enum.CONFIG_INVALID,
      'createAgent requires a runtime adapter with a non-empty id',
    )
  }
}

function stableAgentError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
