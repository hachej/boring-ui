import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_ERROR_CODES } from '../../../../shared/credentials/errors.js'
import { createConfiguredModelRuntime } from '../../../models/modelRuntime.js'
import { modelsRoutes, type VerifiedModelRequestActor } from '../models.js'

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
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key]
    if (typeof previous === 'string') process.env[key] = previous
    else delete process.env[key]
  }
})

describe('modelsRoutes', () => {
  function actorCatalog() {
    return createConfiguredModelRuntime({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    })
  }

  function configureInfomaniakModels() {
    process.env.BORING_AGENT_INFOMANIAK_PRODUCT_ID = '108321'
    process.env.BORING_AGENT_INFOMANIAK_MODEL = 'Qwen/Qwen3.5-122B-A10B-FP8'
    process.env.INFOMANIAK_API_TOKEN = 'test-token'
  }

  it('uses configured launch models as an allowlist', async () => {
    configureInfomaniakModels()

    const app = Fastify({ logger: false })
    await app.register(modelsRoutes)
    await app.ready()

    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })
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

  it('applies request-aware model filters without mutating cached model summaries', async () => {
    configureInfomaniakModels()
    const seenLengths: number[] = []
    const firstLabels: string[] = []
    const app = Fastify({ logger: false })
    await app.register(modelsRoutes, {
      filterModels: vi.fn(async (_ctx, models, defaultModel) => {
        seenLengths.push(models.length)
        firstLabels.push(models[0]?.label ?? '')
        ;(models[0] as { label?: string } | undefined)!.label = 'mutated by test callback'
        return {
          models: models.filter((model: { id: string }) => model.id === 'Qwen/Qwen3.5-122B-A10B-FP8'),
          defaultModel,
        }
      }),
    })
    await app.ready()

    try {
      const first = await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })
      const second = await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })

      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(200)
      expect(first.json().models).toHaveLength(1)
      expect(second.json().models).toHaveLength(1)
      expect(seenLengths.every((length) => length > 1)).toBe(true)
      expect(firstLabels.every((label) => !label.includes('mutated'))).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('resolves actor catalogs only after authorization with distinct verified users', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network access') }))
    const authorizedActors = [
      Object.freeze({ workspaceId: 'workspace-a', userId: 'user-a', executionClass: 'request-attached-interactive' as const }),
      Object.freeze({ workspaceId: 'workspace-a', userId: 'user-b', executionClass: 'request-attached-interactive' as const }),
    ]
    const authorizeRequest = vi.fn(async () => authorizedActors.shift()!)
    const resolveModelCatalog = vi.fn(async (_actor: VerifiedModelRequestActor) => actorCatalog())
    const filterContexts: Array<{ workspaceId?: string; userId?: string; executionClass?: string }> = []
    const app = Fastify({ logger: false })
    await app.register(modelsRoutes, {
      authorizeRequest,
      resolveModelCatalog,
      filterModels: async (ctx, models, defaultModel) => {
        filterContexts.push(ctx)
        return { models, defaultModel }
      },
    })
    await app.ready()

    try {
      await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })
      await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })

      expect(resolveModelCatalog.mock.calls.map(([actor]) => actor)).toEqual([
        expect.objectContaining({ workspaceId: 'workspace-a', userId: 'user-a', executionClass: 'request-attached-interactive' }),
        expect.objectContaining({ workspaceId: 'workspace-a', userId: 'user-b', executionClass: 'request-attached-interactive' }),
      ])
      expect(resolveModelCatalog.mock.invocationCallOrder[0]).toBeGreaterThan(authorizeRequest.mock.invocationCallOrder[0]!)
      expect(resolveModelCatalog.mock.invocationCallOrder[1]).toBeGreaterThan(authorizeRequest.mock.invocationCallOrder[1]!)
      expect(filterContexts).toEqual([
        expect.objectContaining({ workspaceId: 'workspace-a', userId: 'user-a', executionClass: 'request-attached-interactive' }),
        expect.objectContaining({ workspaceId: 'workspace-a', userId: 'user-b', executionClass: 'request-attached-interactive' }),
      ])
    } finally {
      await app.close()
    }
  })

  it('returns a stable authority code when actor-aware authorization yields no actor', async () => {
    const resolveModelCatalog = vi.fn(async (_actor: VerifiedModelRequestActor) => actorCatalog())
    const app = Fastify({ logger: false })
    await app.register(modelsRoutes, {
      authorizeRequest: async () => undefined,
      resolveModelCatalog,
    })
    await app.ready()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toMatchObject({ code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID })
      expect(resolveModelCatalog).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('does not construct an actor catalog when authorization is denied', async () => {
    const resolveModelCatalog = vi.fn(async (_actor: VerifiedModelRequestActor) => actorCatalog())
    const app = Fastify({ logger: false })
    await app.register(modelsRoutes, {
      authorizeRequest: async () => { throw new Error('denied') },
      resolveModelCatalog,
    })
    await app.ready()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })
      expect(response.statusCode).toBe(500)
      expect(resolveModelCatalog).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('uses the first available filtered model when the configured default is denied', async () => {
    configureInfomaniakModels()
    const app = Fastify({ logger: false })
    await app.register(modelsRoutes, {
      filterModels: async (_ctx, models) => ({
        models: models.filter((model: { id: string }) => model.id !== 'Qwen/Qwen3.5-122B-A10B-FP8'),
      }),
    })
    await app.ready()

    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/agents/default/models' })
      expect(res.statusCode).toBe(200)
      expect(res.json().defaultModel).toEqual({ provider: 'infomaniak', id: 'moonshotai/Kimi-K2.6' })
      expect(res.json().models.some((model: { id: string }) => model.id === 'Qwen/Qwen3.5-122B-A10B-FP8')).toBe(false)
    } finally {
      await app.close()
    }
  })
})
