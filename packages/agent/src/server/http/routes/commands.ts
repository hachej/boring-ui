import type { FastifyInstance } from 'fastify'
import type { AgentHarness, AgentSlashCommandSummary } from '../../../shared/harness'

export interface CommandsRoutesOptions {
  harness: AgentHarness
  defaultSessionId: string
  workdir: string
}

function normalizeSessionId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
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
      const commands: ReadonlyArray<AgentSlashCommandSummary> = await opts.harness.getSlashCommands?.(sessionId, {
        abortSignal: new AbortController().signal,
        workdir: opts.workdir,
      }) ?? []
      return reply.code(200).send({ commands })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ commands: [], error: message })
    }
  })

  done()
}
