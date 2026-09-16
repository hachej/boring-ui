import type { FastifyInstance } from 'fastify'
import type { AgentTool } from '@hachej/boring-agent/shared'

function text(body: string, isError = false): Awaited<ReturnType<AgentTool['execute']>> {
  return {
    content: [{ type: 'text', text: body }],
    ...(isError ? { isError: true } : {}),
  }
}

export interface ReloadOptions {
  readonly agentTypeId: string
  /** Lazy: the Fastify app is created after the tools are. */
  readonly getApp: () => FastifyInstance | undefined
  /** The live chat session to reload. */
  readonly sessions: SessionTracker
  readonly requestHeaders?: Readonly<Record<string, string>>
  readonly log?: (message: string) => void
}

/** Remembers the most recent session any of this app's tools ran in. */
export interface SessionTracker {
  current(): string | undefined
  remember(sessionId: string | undefined): void
}

export function createSessionTracker(): SessionTracker {
  let current: string | undefined
  return {
    current: () => current,
    remember(sessionId) {
      if (sessionId) current = sessionId
    },
  }
}

/** Wraps tools so every execution records its session id for reload routing. */
export function trackSessions(tools: readonly AgentTool[], tracker: SessionTracker): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    async execute(params, ctx) {
      tracker.remember(ctx.sessionId)
      return tool.execute(params, ctx)
    },
  }))
}

export async function requestReload(
  options: ReloadOptions,
  reason: string,
  sessionId: string | undefined = options.sessions.current(),
): Promise<{ ok: boolean; summary: string }> {
  const app = options.getApp()
  if (!app) return { ok: false, summary: 'The host is not ready yet.' }
  if (!sessionId) return { ok: false, summary: 'No live conversation to reload yet.' }
  const requestId = `reload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${encodeURIComponent(options.agentTypeId)}/reload`,
    headers: options.requestHeaders,
    payload: { requestId, sessionId },
  })
  const body = response.body
  options.log?.(`reload (${reason}): ${response.statusCode} ${body.slice(0, 300)}`)
  if (response.statusCode >= 300)
    return {
      ok: false,
      summary: `Reload failed (${response.statusCode}): ${body.slice(0, 500)}`,
    }
  return { ok: true, summary: body.slice(0, 2000) }
}

export function createReloadTool(options: ReloadOptions): AgentTool {
  return {
    name: 'reload_my_tools',
    description:
      'Reload the declarative tools under agent/tools into this conversation. Call it immediately after writing or editing a tool manifest and script, then use the new tool once before telling the user it works.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_params, ctx) {
      options.sessions.remember(ctx.sessionId)
      if (!ctx.sessionId) return text('No live conversation to reload.', true)
      // Pi replaces the extension runtime that is delivering this call. Return
      // first, then reload once the current tool result is no longer in flight.
      const sessionId = ctx.sessionId
      setTimeout(() => {
        void requestReload(options, 'tool', sessionId).then((result) => {
          if (!result.ok) options.log?.(`deferred reload failed: ${result.summary}`)
        })
      }, 250)
      return text('Reloading now. Use the new capability next; if it is missing, correct its manifest and reload again.')
    },
  }
}
