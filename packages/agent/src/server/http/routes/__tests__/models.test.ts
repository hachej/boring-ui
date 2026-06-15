import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { modelsRoutes } from '../models.js'

const ENV_KEYS = [
  'BORING_AGENT_DEFAULT_MODEL',
  'BORING_AGENT_DEFAULT_MODEL_PROVIDER',
  'BORING_AGENT_DEFAULT_MODEL_ID',
  'BORING_AGENT_INFOMANIAK_PROVIDER',
  'BORING_AGENT_INFOMANIAK_PRODUCT_ID',
  'BORING_AGENT_INFOMANIAK_BASE_URL',
  'BORING_AGENT_INFOMANIAK_MODEL',
  'BORING_AGENT_INFOMANIAK_MODELS',
  'BORING_AGENT_INFOMANIAK_API_KEY_ENV',
  'BORING_AGENT_INFOMANIAK_API_KEY',
  'INFOMANIAK_API_TOKEN',
  'HOME',
]

let previousEnv: Record<string, string | undefined>

beforeEach(() => {
  previousEnv = {}
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.HOME = join(tmpdir(), 'boring-model-routes-home-test')
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key]
    if (typeof previous === 'string') process.env[key] = previous
    else delete process.env[key]
  }
})

describe('modelsRoutes', () => {
  it('uses configured launch models as an allowlist', async () => {
    process.env.BORING_AGENT_INFOMANIAK_PRODUCT_ID = '108321'
    process.env.BORING_AGENT_INFOMANIAK_MODEL = 'Qwen/Qwen3.5-122B-A10B-FP8'
    process.env.INFOMANIAK_API_TOKEN = 'test-token'

    const app = Fastify({ logger: false })
    await app.register(modelsRoutes)
    await app.ready()

    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/agent/models' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.defaultModel).toEqual({
        provider: 'infomaniak',
        id: 'Qwen/Qwen3.5-122B-A10B-FP8',
      })
      expect(body.models).toEqual([
        expect.objectContaining({
          provider: 'infomaniak',
          id: 'moonshotai/Kimi-K2.6',
          available: true,
        }),
        expect.objectContaining({
          provider: 'infomaniak',
          id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8',
          available: true,
        }),
        expect.objectContaining({
          provider: 'infomaniak',
          id: 'Qwen/Qwen3.5-122B-A10B-FP8',
          available: true,
        }),
      ])
    } finally {
      await app.close()
    }
  })
})
