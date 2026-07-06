import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AgentHarness } from '../../../../shared/harness'
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
