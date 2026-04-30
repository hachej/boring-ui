import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readConfiguredDefaultModel,
  registerConfiguredModelProviders,
} from '../modelConfig.js'

const ENV_KEYS = [
  'BORING_AGENT_DEFAULT_MODEL',
  'BORING_AGENT_DEFAULT_MODEL_PROVIDER',
  'BORING_AGENT_DEFAULT_MODEL_ID',
  'BORING_AGENT_INFOMANIAK_PROVIDER',
  'BORING_AGENT_INFOMANIAK_PRODUCT_ID',
  'BORING_AGENT_INFOMANIAK_BASE_URL',
  'BORING_AGENT_INFOMANIAK_MODEL',
  'BORING_AGENT_INFOMANIAK_MODEL_NAME',
  'BORING_AGENT_INFOMANIAK_API_KEY_ENV',
  'BORING_AGENT_INFOMANIAK_API_KEY',
  'BORING_AGENT_CUSTOM_MODEL_PROVIDER',
  'BORING_AGENT_CUSTOM_MODEL_ID',
  'BORING_AGENT_CUSTOM_MODEL_BASE_URL',
  'BORING_AGENT_CUSTOM_MODEL_API_KEY_ENV',
  'BORING_AGENT_CUSTOM_MODEL_API_KEY',
  'INFOMANIAK_API_TOKEN',
]

let previousEnv: Record<string, string | undefined>

beforeEach(() => {
  previousEnv = {}
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key]
    if (typeof previous === 'string') process.env[key] = previous
    else delete process.env[key]
  }
})

describe('agent model env config', () => {
  it('registers Infomaniak OpenAI-compatible model from env', () => {
    process.env.BORING_AGENT_INFOMANIAK_PRODUCT_ID = '108321'
    process.env.BORING_AGENT_INFOMANIAK_MODEL = 'Qwen/Qwen3.5-122B-A10B-FP8'
    process.env.INFOMANIAK_API_TOKEN = 'test-token'

    const registered: Array<{ provider: string; config: unknown }> = []
    const registry = {
      registerProvider(provider: string, config: unknown) {
        registered.push({ provider, config })
      },
    }

    expect(registerConfiguredModelProviders(registry as never)).toEqual([
      { provider: 'infomaniak', id: 'Qwen/Qwen3.5-122B-A10B-FP8' },
    ])
    expect(registered).toHaveLength(1)
    expect(registered[0]?.provider).toBe('infomaniak')
    expect(registered[0]?.config).toMatchObject({
      baseUrl: 'https://api.infomaniak.com/2/ai/108321/openai/v1',
      apiKey: 'INFOMANIAK_API_TOKEN',
      api: 'openai-completions',
      models: [
        {
          id: 'Qwen/Qwen3.5-122B-A10B-FP8',
          name: 'Qwen/Qwen3.5-122B-A10B-FP8',
          reasoning: true,
          input: ['text'],
          maxTokens: 16384,
          contextWindow: 200000,
        },
      ],
    })
    expect(readConfiguredDefaultModel()).toEqual({
      provider: 'infomaniak',
      id: 'Qwen/Qwen3.5-122B-A10B-FP8',
    })
  })

  it('supports encoded default model ids that contain colons', () => {
    process.env.BORING_AGENT_DEFAULT_MODEL =
      'amazon-bedrock:anthropic.claude-sonnet-4-6:0'

    expect(readConfiguredDefaultModel()).toEqual({
      provider: 'amazon-bedrock',
      id: 'anthropic.claude-sonnet-4-6:0',
    })
  })

  it('does not register partial custom provider config', () => {
    process.env.BORING_AGENT_CUSTOM_MODEL_PROVIDER = 'custom'
    process.env.BORING_AGENT_CUSTOM_MODEL_ID = 'model'

    const registry = {
      registerProvider() {
        throw new Error('should not register')
      },
    }

    expect(registerConfiguredModelProviders(registry as never)).toEqual([])
    expect(readConfiguredDefaultModel()).toBeUndefined()
  })
})
