import type { FastifyInstance } from "fastify"
import type { AgentHarness } from "../../../shared/harness.js"

export interface ReloadRoutesOptions {
  harness: AgentHarness
  defaultSessionId: string
  beforeReload?: () => void | Promise<void>
}

interface ReloadBody {
  sessionId?: string
}

export function reloadRoutes(
  app: FastifyInstance,
  opts: ReloadRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.post<{ Body: ReloadBody }>("/api/v1/agent/reload", async (request, reply) => {
    if (!opts.harness.reloadSession) {
      return reply.status(501).send({ ok: false, error: "Agent harness does not support reload" })
    }

    const sessionId = request.body?.sessionId || opts.defaultSessionId
    try {
      await opts.beforeReload?.()
      const reloaded = await opts.harness.reloadSession(sessionId)
      return { ok: true, sessionId, reloaded }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(422).send({ ok: false, error: message })
    }
  })

  done()
}
