import { watch, type FSWatcher } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { AgentTool } from '@hachej/boring-agent/shared'

export const EXTENSIONS_RELATIVE_PATH = path.join('.pi', 'extensions')

function text(body: string, isError = false): Awaited<ReturnType<AgentTool['execute']>> {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) }
}

/**
 * The agent grows its own toolset by writing a Pi extension into the
 * workspace's `.pi/extensions/` and asking the host to reload. The reload
 * goes through the host's own route (`POST /api/v1/agents/:id/reload`) so it
 * is the same operation the CLI's `/reload` performs: resource loader +
 * running Pi session, no restart.
 */
export interface ReloadOptions {
  readonly agentTypeId: string
  /** Lazy: the Fastify app is created after the tools are. */
  readonly getApp: () => FastifyInstance | undefined
  /**
   * The live chat session to reload. Without it the host reloads a session
   * called "default", which is not the user's, and reports `reloaded: false`.
   */
  readonly sessions: SessionTracker
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

/** Wraps tools so every execution records its session id for the watcher. */
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
    payload: { requestId, sessionId },
  })
  const body = response.body
  options.log?.(`reload (${reason}): ${response.statusCode} ${body.slice(0, 300)}`)
  if (response.statusCode >= 300) return { ok: false, summary: `Reload failed (${response.statusCode}): ${body.slice(0, 500)}` }
  return { ok: true, summary: body.slice(0, 2000) }
}

export function createReloadTool(options: ReloadOptions): AgentTool {
  return {
    name: 'reload_my_tools',
    description:
      'Load the tools you just added or changed under .pi/extensions/ into this conversation, without any restart. Call it right after writing or editing an extension file, and confirm to the user only what the result reports.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_params, ctx) {
      options.sessions.remember(ctx.sessionId)
      const result = await requestReload(options, 'tool', ctx.sessionId)
      return text(result.ok ? `Reloaded. ${result.summary}` : result.summary, !result.ok)
    },
  }
}

/** Debounced auto-reload when anything under .pi/extensions changes. */
export function watchExtensions(options: ReloadOptions & { readonly workspaceRoot: string }): () => void {
  const dir = path.join(options.workspaceRoot, EXTENSIONS_RELATIVE_PATH)
  let watcher: FSWatcher | null = null
  let timer: NodeJS.Timeout | null = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void requestReload(options, 'watcher').catch((error) => options.log?.(`reload watcher error: ${String(error)}`))
    }, 600)
  }
  void mkdir(dir, { recursive: true }).then(() => {
    try {
      watcher = watch(dir, { persistent: false, recursive: true }, schedule)
      watcher.on('error', () => {})
    } catch {
      // Recursive watch unsupported: the agent still has reload_my_tools.
    }
  })
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}
