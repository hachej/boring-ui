import type {
  AgentFleetCompiler,
  AgentHostAgentSpec,
  CompiledAgentHostAgentSpec,
} from '@hachej/boring-agent/server'

const DEFAULT_AGENT_MODEL = 'infomaniak:Qwen/Qwen3.5-122B-A10B-FP8'
const DUMMY_AGENT_MODEL = 'infomaniak:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8'
type AgentFleetCompileInput = Parameters<AgentFleetCompiler['compile']>[0]

function configuredModel(
  env: NodeJS.ProcessEnv,
  encodedName: string,
  providerName: string,
  modelName: string,
  fallback: string,
): string {
  const encoded = env[encodedName]?.trim()
  if (encoded) return encoded
  const provider = env[providerName]?.trim()
  const model = env[modelName]?.trim()
  return provider && model ? `${provider}:${model}` : fallback
}

const FULL_APP_AGENT_FLEET_COMPILER: AgentFleetCompiler = Object.freeze({
  async compile(
    { agents }: AgentFleetCompileInput,
  ): Promise<readonly CompiledAgentHostAgentSpec[]> {
    return agents
  },
})

export function createFullAppAgentFleetComposition(env: NodeJS.ProcessEnv = process.env): {
  readonly agents: readonly AgentHostAgentSpec[]
  readonly defaultAgentTypeId: string
  readonly fleetCompiler: AgentFleetCompiler
} {
  const infomaniakModel = env.BORING_AGENT_INFOMANIAK_MODEL?.trim()
  const defaultFallback = infomaniakModel
    ? `${env.BORING_AGENT_INFOMANIAK_PROVIDER?.trim() || 'infomaniak'}:${infomaniakModel}`
    : DEFAULT_AGENT_MODEL
  const defaultModel = configuredModel(
    env,
    'BORING_AGENT_DEFAULT_MODEL',
    'BORING_AGENT_DEFAULT_MODEL_PROVIDER',
    'BORING_AGENT_DEFAULT_MODEL_ID',
    defaultFallback,
  )
  const dummyModel = configuredModel(
    env,
    'BORING_AGENT_DUMMY_MODEL',
    'BORING_AGENT_DUMMY_MODEL_PROVIDER',
    'BORING_AGENT_DUMMY_MODEL_ID',
    DUMMY_AGENT_MODEL,
  )
  if (dummyModel === defaultModel) {
    throw new Error('full-app Wave 1 fleet requires distinct default and dummy models')
  }

  const agents = Object.freeze([
    Object.freeze({
      agentTypeId: 'default',
      definition: Object.freeze({
        label: 'Default',
        instructions: 'You are the default full-app workspace agent.',
      }),
      model: Object.freeze({ preferred: defaultModel }),
    }),
    Object.freeze({
      agentTypeId: 'dummy',
      definition: Object.freeze({
        label: 'Dummy',
        instructions: 'You are the lower-cost dummy full-app workspace agent.',
      }),
      model: Object.freeze({ preferred: dummyModel }),
    }),
  ] as const satisfies readonly AgentHostAgentSpec[])

  return Object.freeze({
    agents,
    defaultAgentTypeId: 'default',
    fleetCompiler: FULL_APP_AGENT_FLEET_COMPILER,
  })
}
