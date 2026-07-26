import type {
  AgentFleetCompiler,
  AgentHostAgentSpec,
  CompiledAgentHostAgentSpec,
} from './types'
import { ErrorCode } from '../../shared/error-codes'

export const AgentFleetCompilationErrorCode = {
  AGENT_FLEET_PLUGIN_UNKNOWN: ErrorCode.enum.AGENT_FLEET_PLUGIN_UNKNOWN,
  AGENT_FLEET_CONFIG_BINDING_UNKNOWN: ErrorCode.enum.AGENT_FLEET_CONFIG_BINDING_UNKNOWN,
  AGENT_FLEET_MODEL_POLICY_UNCOMPILED: ErrorCode.enum.AGENT_FLEET_MODEL_POLICY_UNCOMPILED,
} as const

export type AgentFleetCompilationErrorCode =
  (typeof AgentFleetCompilationErrorCode)[keyof typeof AgentFleetCompilationErrorCode]

export class AgentFleetCompilationError extends Error {
  readonly code: AgentFleetCompilationErrorCode
  readonly details: Readonly<Record<string, string>>

  constructor(
    code: AgentFleetCompilationErrorCode,
    message: string,
    details: Readonly<Record<string, string>>,
  ) {
    super(message)
    this.name = 'AgentFleetCompilationError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

export interface AgentFleetPluginBindingContract {
  readonly id: string
  readonly configKeys?: readonly string[]
}

export interface CreateValidatingAgentFleetCompilerOptions {
  readonly plugins: readonly AgentFleetPluginBindingContract[]
  readonly compiler?: AgentFleetCompiler
  /**
   * Keeps Core's existing fail-closed policy when it has no app compiler.
   * This is not model allowlist validation.
   */
  readonly requireCompilerForModelPolicy?: boolean
}

function validateConfigBinding(
  agentTypeId: string,
  pluginName: string,
  config: unknown,
  allowedKeys: ReadonlySet<string>,
): void {
  if (config === undefined || config === null) return
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new AgentFleetCompilationError(
      AgentFleetCompilationErrorCode.AGENT_FLEET_CONFIG_BINDING_UNKNOWN,
      `Agent fleet plugin config must be an object: ${pluginName}`,
      { agentTypeId, pluginId: pluginName },
    )
  }
  for (const key of Object.keys(config)) {
    if (allowedKeys.has(key)) continue
    throw new AgentFleetCompilationError(
      AgentFleetCompilationErrorCode.AGENT_FLEET_CONFIG_BINDING_UNKNOWN,
      `unknown Agent fleet plugin config binding: ${pluginName}.${key}`,
      { agentTypeId, pluginId: pluginName, configKey: key },
    )
  }
}

/**
 * The one reusable fleet binding-validation funnel. Apps supply only their
 * already-resolved plugin contracts and optional stricter policy compiler.
 */
export function createValidatingAgentFleetCompiler(
  options: CreateValidatingAgentFleetCompilerOptions,
): AgentFleetCompiler {
  const plugins = new Map(options.plugins.map((plugin) => [
    plugin.id,
    new Set(plugin.configKeys ?? []),
  ]))

  const validateBindings = (agents: readonly AgentHostAgentSpec[]): void => {
    for (const agent of agents) {
      if ('legacyDefault' in agent) continue
      for (const plugin of agent.plugins ?? []) {
        const configKeys = plugins.get(plugin.name)
        if (!configKeys) {
          throw new AgentFleetCompilationError(
            AgentFleetCompilationErrorCode.AGENT_FLEET_PLUGIN_UNKNOWN,
            `unknown Agent fleet plugin: ${plugin.name}`,
            { agentTypeId: agent.agentTypeId, pluginId: plugin.name },
          )
        }
        validateConfigBinding(agent.agentTypeId, plugin.name, plugin.config, configKeys)
      }
      if (agent.model !== undefined && options.requireCompilerForModelPolicy && !options.compiler) {
        throw new AgentFleetCompilationError(
          AgentFleetCompilationErrorCode.AGENT_FLEET_MODEL_POLICY_UNCOMPILED,
          `Agent model policy requires an app fleet compiler: ${agent.agentTypeId}`,
          { agentTypeId: agent.agentTypeId },
        )
      }
    }
  }

  return {
    async compile({ agents }) {
      validateBindings(agents)
      const compiled: readonly CompiledAgentHostAgentSpec[] = options.compiler
        ? await options.compiler.compile({ agents })
        : agents
      validateBindings(compiled)
      return compiled
    },
  }
}
