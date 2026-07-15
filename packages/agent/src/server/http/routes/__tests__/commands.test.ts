import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AgentHarness } from '../../../../shared/harness'
import type { SessionCtx } from '../../../../shared/session'
import { ErrorCode } from '../../../../shared/error-codes'
import { commandsRoutes } from '../commands'

function fakeHarness(overrides: Partial<AgentHarness>): AgentHarness {
  return {
    id: 'commands-test',
    placement: 'server',
    sessions: {
      async list() { return [] },
      async create() {
        const now = new Date().toISOString()
        return { id: 'default', title: 'Default', createdAt: now, updatedAt: now, turnCount: 0 }
      },
      async rename(_ctx: SessionCtx, sessionId: string, title: string) {
        const now = new Date().toISOString()
        return { id: sessionId, title, createdAt: now, updatedAt: now, turnCount: 0 }
      },
      async load() {
        const now = new Date().toISOString()
        return { id: 'default', title: 'Default', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
      },
      async delete() {},
    },
    ...overrides,
  }
}

describe('commandsRoutes', () => {
  it('does not create command handles for unmaterialized browser drafts', async () => {
    const getSlashCommands = vi.fn(async () => [{ name: 'panel', source: 'extension' as const }])
    const executeSlashCommand = vi.fn(async () => {})
    const load = vi.fn(async () => { throw Object.assign(new Error('Session not found'), { code: ErrorCode.enum.SESSION_NOT_FOUND }) })
    const app = Fastify({ logger: false })
    await app.register(commandsRoutes, {
      harness: fakeHarness({
        browserDraftNative: true,
        sessions: { ...fakeHarness({}).sessions, load },
        getSlashCommands,
        executeSlashCommand,
      }),
      defaultSessionId: 'default',
      workdir: '/tmp/commands-test',
    })

    try {
      const list = await app.inject({ method: 'GET', url: '/api/v1/agent/commands?sessionId=brdraft_abcdefghijklmnop' })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual({ commands: [] })
      expect(getSlashCommands).not.toHaveBeenCalled()

      const execute = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/commands/execute?sessionId=brdraft_abcdefghijklmnop',
        payload: { name: 'panel', args: '' },
      })
      expect(execute.statusCode).toBe(404)
      expect(execute.json()).toMatchObject({ error: { code: ErrorCode.enum.SESSION_NOT_FOUND } })
      expect(executeSlashCommand).not.toHaveBeenCalled()
      expect(load).toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('loads browser-draft commands after materialization', async () => {
    const getSlashCommands = vi.fn(async () => [{ name: 'panel', source: 'extension' as const }])
    const app = Fastify({ logger: false })
    await app.register(commandsRoutes, {
      harness: fakeHarness({
        browserDraftNative: true,
        sessions: {
          ...fakeHarness({}).sessions,
          async load(_ctx: SessionCtx, sessionId: string) {
            const now = new Date().toISOString()
            return { id: sessionId, title: 'Materialized draft', createdAt: now, updatedAt: now, turnCount: 1, materialized: true }
          },
        },
        getSlashCommands,
      }),
      defaultSessionId: 'default',
      workdir: '/tmp/commands-test',
    })

    try {
      const list = await app.inject({ method: 'GET', url: '/api/v1/agent/commands?sessionId=brdraft_abcdefghijklmnop' })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual({ commands: [{ name: 'panel', source: 'extension' }] })
      expect(getSlashCommands).toHaveBeenCalledWith('brdraft_abcdefghijklmnop', expect.objectContaining({ storageScope: 'default' }))
    } finally {
      await app.close()
    }
  })

  it('surfaces browser-draft session-store failures during command discovery', async () => {
    const getSlashCommands = vi.fn(async () => [{ name: 'panel', source: 'extension' as const }])
    const app = Fastify({ logger: false })
    await app.register(commandsRoutes, {
      harness: fakeHarness({
        browserDraftNative: true,
        sessions: {
          ...fakeHarness({}).sessions,
          async load() { throw new Error('session store unavailable') },
        },
        getSlashCommands,
      }),
      defaultSessionId: 'default',
      workdir: '/tmp/commands-test',
    })

    try {
      const list = await app.inject({ method: 'GET', url: '/api/v1/agent/commands?sessionId=brdraft_abcdefghijklmnop' })
      expect(list.statusCode).toBe(500)
      expect(list.json()).toEqual({ commands: [], error: 'session store unavailable' })
      expect(getSlashCommands).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('allows command execution when an installed metering sink is disabled', async () => {
    const executeSlashCommand = vi.fn(async () => {})
    const app = Fastify({ logger: false })
    await app.register(commandsRoutes, {
      harness: fakeHarness({
        getSlashCommands: vi.fn(async () => [{ name: 'panel', source: 'extension' as const }]),
        executeSlashCommand,
      }),
      defaultSessionId: 'default',
      workdir: '/tmp/commands-test',
      metering: { isEnabled: () => false },
    })

    try {
      const execute = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/commands/execute?sessionId=default',
        payload: { name: 'panel', args: '' },
      })
      expect(execute.statusCode).toBe(200)
      expect(execute.json()).toEqual({ ok: true })
      expect(executeSlashCommand).toHaveBeenCalledWith('default', 'panel', '', expect.objectContaining({ workdir: '/tmp/commands-test' }))
    } finally {
      await app.close()
    }
  })

  it('rejects extension command execution when metering is configured', async () => {
    const executeSlashCommand = vi.fn(async () => {})
    const app = Fastify({ logger: false })
    await app.register(commandsRoutes, {
      harness: fakeHarness({
        getSlashCommands: vi.fn(async () => [{ name: 'panel', source: 'extension' as const }]),
        executeSlashCommand,
      }),
      defaultSessionId: 'default',
      workdir: '/tmp/commands-test',
      metering: {},
    })

    try {
      const execute = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/commands/execute?sessionId=default',
        payload: { name: 'panel', args: '' },
      })
      expect(execute.statusCode).toBe(409)
      expect(execute.json()).toMatchObject({ error: { code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND } })
      expect(executeSlashCommand).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('lists commands but rejects command execution when metering is configured', async () => {
    const piSessionPrompt = vi.fn(async () => {})
    const executeSlashCommand = vi.fn(async () => {
      await piSessionPrompt()
    })
    const getSlashCommands = vi.fn(async () => [{ name: 'plan', source: 'prompt' as const }])
    const app = Fastify({ logger: false })
    await app.register(commandsRoutes, {
      harness: fakeHarness({ getSlashCommands, executeSlashCommand }),
      defaultSessionId: 'default',
      workdir: '/tmp/commands-test',
      metering: {},
    })

    try {
      const list = await app.inject({ method: 'GET', url: '/api/v1/agent/commands?sessionId=default' })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual({ commands: [{ name: 'plan', source: 'prompt' }] })

      const execute = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/commands/execute?sessionId=default',
        payload: { name: 'plan', args: 'ship it' },
      })
      expect(execute.statusCode).toBe(409)
      expect(execute.json()).toEqual({
        error: {
          code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND,
          message: 'Slash command execution is disabled while metering is configured.',
          details: { command: 'plan' },
        },
      })
      expect(executeSlashCommand).not.toHaveBeenCalled()
      expect(piSessionPrompt).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
