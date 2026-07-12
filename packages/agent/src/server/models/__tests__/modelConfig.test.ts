import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  'BORING_AGENT_INFOMANIAK_MODELS',
  'BORING_AGENT_INFOMANIAK_MODEL_NAME',
  'BORING_AGENT_INFOMANIAK_SUPPORTS_DEVELOPER_ROLE',
  'BORING_AGENT_INFOMANIAK_SUPPORTS_REASONING_EFFORT',
  'BORING_AGENT_INFOMANIAK_API_KEY_ENV',
  'BORING_AGENT_INFOMANIAK_API_KEY',
  'BORING_AGENT_CUSTOM_MODEL_PROVIDER',
  'BORING_AGENT_CUSTOM_MODEL_ID',
  'BORING_AGENT_CUSTOM_MODEL_BASE_URL',
  'BORING_AGENT_CUSTOM_MODEL_API_KEY_ENV',
  'BORING_AGENT_CUSTOM_MODEL_API_KEY',
  'INFOMANIAK_API_TOKEN',
  'HOME',
]

let previousEnv: Record<string, string | undefined>
let previousCwd: string
let tempDirs: string[] = []

beforeEach(() => {
  previousCwd = process.cwd()
  tempDirs = []
  previousEnv = {}
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key]
    delete process.env[key]
  }
  const home = mkdtempSync(join(tmpdir(), 'boring-model-config-home-'))
  tempDirs.push(home)
  process.env.HOME = home
})

afterEach(async () => {
  process.chdir(previousCwd)
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key]
    if (typeof previous === 'string') process.env[key] = previous
    else delete process.env[key]
  }
})

describe('agent model env config', () => {
  it('registers the launch Infomaniak OpenAI-compatible models from env', () => {
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
      { provider: 'infomaniak', id: 'moonshotai/Kimi-K2.6' },
      { provider: 'infomaniak', id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8' },
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
          id: 'moonshotai/Kimi-K2.6',
          name: 'moonshotai/Kimi-K2.6',
          reasoning: true,
          input: ['text'],
          maxTokens: 16384,
          contextWindow: 200000,
          compat: expect.objectContaining({ supportsDeveloperRole: false, supportsReasoningEffort: false }),
        },
        {
          id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8',
          name: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8',
          compat: expect.objectContaining({ supportsDeveloperRole: false, supportsReasoningEffort: false }),
        },
        {
          id: 'Qwen/Qwen3.5-122B-A10B-FP8',
          name: 'Qwen/Qwen3.5-122B-A10B-FP8',
          compat: expect.objectContaining({ supportsDeveloperRole: false, supportsReasoningEffort: false }),
        },
      ],
    })
    expect(readConfiguredDefaultModel()).toEqual({
      provider: 'infomaniak',
      id: 'Qwen/Qwen3.5-122B-A10B-FP8',
    })
  })

  it('registers provider apiKey values that resolve from env under pi-coding-agent\'s contract', () => {
    // Mirrors @mariozechner/pi-coding-agent@0.75.5's resolveConfigValue:
    // `config.startsWith('!') ? runCommand(config) : (process.env[config] ?? config)`.
    // It does NOT strip a leading "$" — a `$`-prefixed apiKey value resolves
    // to nothing and falls back to being sent as the literal Bearer token.
    // This test would have caught the INFOMANIAK_API_TOKEN 401 regression.
    function resolveLikePiCodingAgent(config: string, env: NodeJS.ProcessEnv): string {
      if (config.startsWith('!')) throw new Error('command-form apiKey not exercised by this test')
      return env[config] ?? config
    }

    process.env.BORING_AGENT_INFOMANIAK_PRODUCT_ID = '108321'
    process.env.BORING_AGENT_INFOMANIAK_MODEL = 'Qwen/Qwen3.5-122B-A10B-FP8'
    process.env.INFOMANIAK_API_TOKEN = 'super-secret-token'

    const registered: Array<{ provider: string; config: { apiKey?: string } }> = []
    const registry = {
      registerProvider(provider: string, config: unknown) {
        registered.push({ provider, config: config as { apiKey?: string } })
      },
    }

    registerConfiguredModelProviders(registry as never)

    const apiKeyConfig = registered[0]?.config.apiKey
    expect(apiKeyConfig).toBeDefined()
    const resolved = resolveLikePiCodingAgent(apiKeyConfig!, process.env)
    expect(resolved).toBe('super-secret-token')
    expect(resolved).not.toBe(apiKeyConfig) // sanity: value actually came from env, not passed through
  })

  it('supports encoded default model ids that contain colons', () => {
    process.env.BORING_AGENT_DEFAULT_MODEL =
      'amazon-bedrock:anthropic.claude-sonnet-4-6:0'

    expect(readConfiguredDefaultModel()).toEqual({
      provider: 'amazon-bedrock',
      id: 'anthropic.claude-sonnet-4-6:0',
    })
  })

  it('uses Pi default provider/model settings when env defaults are absent', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'boring-model-config-cwd-'))
    tempDirs.push(cwd)
    process.chdir(cwd)
    const home = process.env.HOME!
    await mkdir(join(home, '.pi', 'agent'), { recursive: true })
    await writeFile(
      join(home, '.pi', 'agent', 'settings.json'),
      JSON.stringify({ defaultProvider: 'openai-codex', defaultModel: 'gpt-5.4' }),
      'utf-8',
    )

    expect(readConfiguredDefaultModel()).toEqual({
      provider: 'openai-codex',
      id: 'gpt-5.4',
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
