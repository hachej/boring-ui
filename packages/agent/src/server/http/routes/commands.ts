import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AgentHarness, AgentSlashCommandSummary } from '../../../shared/harness'

export type CommandsRoutesOptions = {
  harness: AgentHarness
  defaultSessionId: string
  workdir: string
} | {
  defaultSessionId: string
  getHarness: (request: FastifyRequest) => AgentHarness | Promise<AgentHarness>
  getWorkdir: (request: FastifyRequest) => string | Promise<string>
}

function normalizeSessionId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function resolveHarness(opts: CommandsRoutesOptions, request: FastifyRequest): AgentHarness | Promise<AgentHarness> {
  return 'getHarness' in opts ? opts.getHarness(request) : opts.harness
}

function resolveWorkdir(opts: CommandsRoutesOptions, request: FastifyRequest): string | Promise<string> {
  return 'getWorkdir' in opts ? opts.getWorkdir(request) : opts.workdir
}

export function commandsRoutes(
  app: FastifyInstance,
  opts: CommandsRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.get('/api/v1/agent/commands', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>
      const sessionId = normalizeSessionId(query.sessionId, opts.defaultSessionId)
      const [harness, workdir] = await Promise.all([
        resolveHarness(opts, request),
        resolveWorkdir(opts, request),
      ])
      const commands: ReadonlyArray<AgentSlashCommandSummary> = await harness.getSlashCommands?.(sessionId, {
        abortSignal: new AbortController().signal,
        workdir,
      }) ?? []
      return reply.code(200).send({ commands })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ commands: [], error: message })
    }
  })

  app.post('/api/v1/agent/commands/execute', async (request, reply) => {
    try {
      const [harness, workdir] = await Promise.all([
        resolveHarness(opts, request),
        resolveWorkdir(opts, request),
      ])
      if (!harness.executeSlashCommand) {
        return reply.code(501).send({ error: 'Command execution not supported by this harness.' })
      }
      const query = request.query as Record<string, unknown>
      const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {}
      const sessionId = normalizeSessionId(query.sessionId, opts.defaultSessionId)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const args = typeof body.args === 'string' ? body.args : ''
      if (!name) return reply.code(400).send({ error: 'name body field is required' })
      await harness.executeSlashCommand(sessionId, name, args, {
        abortSignal: new AbortController().signal,
        workdir,
      })
      return reply.code(200).send({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ error: message })
    }
  })

  done()
}
