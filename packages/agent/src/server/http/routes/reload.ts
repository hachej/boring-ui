import type { FastifyInstance } from "fastify"
import type { AgentHarness } from "../../../shared/harness.js"
import type { PluginRestartWarning } from "../../../shared/agentPluginEvents.js"

export interface ReloadHookDiagnostic {
  source: string
  message: string
  pluginId?: string
}

export interface ReloadHookResult {
  /**
   * One per plugin that loaded successfully but whose server-side
   * surfaces (routes, agentTools) still hold pre-reload code. The
   * /api/v1/agent/reload response surfaces these so the chat UI can
   * render a "restart needed" banner without subscribing to SSE.
   */
  restart_warnings?: ReadonlyArray<PluginRestartWarning>
  /** Non-fatal plugin reload diagnostics to surface to the caller/UI. */
  diagnostics?: ReadonlyArray<ReloadHookDiagnostic>
}

export interface ReloadRoutesOptions {
  harness: AgentHarness
  defaultSessionId: string
  /**
   * Called BEFORE the harness reloads its session. Optionally returns
   * `{ restart_warnings, diagnostics }` — surfaced verbatim on the /reload
   * response so the agent + chat UI can act on them. `void` / undefined
   * return = no warnings (backwards compatible).
   */
  beforeReload?: () =>
    | void
    | ReloadHookResult
    | undefined
    | Promise<void | ReloadHookResult | undefined>
  /**
   * Called with the combined diagnostics (hook + harness resource
   * diagnostics) after a reload, so a host can stash them for the
   * `plugin_diagnostics` tool to replay to the agent.
   */
  onDiagnostics?: (diagnostics: ReloadHookDiagnostic[]) => void
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
      const diagnostics: ReloadHookDiagnostic[] = [
        ...(hookResult?.diagnostics ?? []),
        ...(opts.harness.getResourceDiagnostics?.(sessionId) ?? []).map((d) => ({
          source: d.source,
          // The harness already folds the path into the message.
          message: d.message,
        })),
      ]
      if (!reloaded) {
        diagnostics.push({
          source: "reload",
          message: "No live agent session to reload yet — changes apply to the next session.",
        })
      }
      opts.onDiagnostics?.(diagnostics)
      return {
        ok: true,
        sessionId,
        reloaded,
        ...(restart_warnings && restart_warnings.length > 0 ? { restart_warnings } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(422).send({ ok: false, error: message })
    }
  })

  done()
}
