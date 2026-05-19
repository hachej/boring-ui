import type { FastifyInstance } from "fastify"
import type { AgentHarness } from "../../../shared/harness.js"
import type { PluginRestartWarning } from "../../../shared/agentPluginEvents.js"

export interface ReloadHookResult {
  /**
   * One per plugin that loaded successfully but whose server-side
   * surfaces (routes, agentTools) still hold pre-reload code. The
   * /api/v1/agent/reload response surfaces these so the chat UI can
   * render a "restart needed" banner without subscribing to SSE.
   */
  restart_warnings?: ReadonlyArray<PluginRestartWarning>
}

export interface ReloadRoutesOptions {
  harness: AgentHarness
  defaultSessionId: string
  /**
   * Called BEFORE the harness reloads its session. Optionally returns
   * `{ restart_warnings }` — surfaced verbatim on the /reload response
   * so the agent + chat UI can act on them. `void` / undefined return =
   * no warnings (backwards compatible).
   */
  beforeReload?: () =>
    | void
    | ReloadHookResult
    | undefined
    | Promise<void | ReloadHookResult | undefined>
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
      const hookResult = await opts.beforeReload?.()
      const reloaded = await opts.harness.reloadSession(sessionId)
      const restart_warnings = hookResult?.restart_warnings
      return {
        ok: true,
        sessionId,
        reloaded,
        ...(restart_warnings && restart_warnings.length > 0 ? { restart_warnings } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(422).send({ ok: false, error: message })
    }
  })

  done()
}
