import { randomUUID } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import type { PiExtensionFactory } from '@hachej/boring-agent/server'
import type { AgentGateway, AuthorizedAgentScope } from '@hachej/boring-agent/shared'

import type { SessionTracker } from './reloadTools.js'

const POLL_MS = 250
const IDLE_TIMEOUT_MS = 2 * 60_000

/** Headless Pi has no built-in `/compact`; bridge the Host command route to its SDK context. */
export function createCompactCommandExtension(log?: (message: string) => void): PiExtensionFactory {
  return (pi) => {
    pi.registerCommand('compact', {
      description: 'Compact this session with optional focus instructions.',
      handler: async (args, ctx) => {
        const before = ctx.getContextUsage()?.tokens
        // Pi's command context deliberately starts compaction in the background.
        // Returning now lets the Host record a known successful dispatch; the
        // callbacks carry the real completion result without an ambiguous effect.
        ctx.compact({
          customInstructions: args.trim() || undefined,
          onComplete: (result) => log?.(
            `compaction complete: context ${before ?? 'unknown'} -> ${result.estimatedTokensAfter ?? 'unknown'} tokens (summarized ${result.tokensBefore})`,
          ),
          onError: (error) => log?.(`compaction did not run: ${error.message}; context ${before ?? 'unknown'} tokens`),
        })
      },
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Compact only after the agreement turn settles; manual compaction aborts an active turn. */
export async function compactAfterAgreement(options: {
  readonly app: FastifyInstance
  readonly gateway: AgentGateway
  readonly scope: AuthorizedAgentScope
  readonly sessions: SessionTracker
  readonly slug: string
  readonly requestHeaders?: Readonly<Record<string, string>>
  readonly log?: (message: string) => void
}): Promise<void> {
  const sessionId = options.sessions.current()
  if (!sessionId) {
    options.log?.(`compaction skipped for ${options.slug}: no live colleague session`)
    return
  }
  const ref = { agentTypeId: 'default', sessionId }
  const deadline = Date.now() + IDLE_TIMEOUT_MS
  let before = await options.gateway.readSessionState({ scope: options.scope, ref })
  while (before.summary.status !== 'idle' && Date.now() < deadline) {
    await sleep(POLL_MS)
    before = await options.gateway.readSessionState({ scope: options.scope, ref })
  }
  if (before.summary.status !== 'idle') {
    options.log?.(`compaction skipped for ${options.slug}: colleague session did not become idle`)
    return
  }

  const instruction = `Keep: the pointer to agent/intents/${options.slug}.md, the agreed summary, and the user's standing preferences. Drop the interview questions and answers.`
  const response = await options.app.inject({
    method: 'POST',
    url: '/api/v1/agents/default/commands/execute',
    headers: options.requestHeaders,
    payload: {
      requestId: `compact:${randomUUID()}`,
      sessionId,
      name: 'compact',
      args: instruction,
    },
  })
  options.log?.(
    `compaction dispatched for ${options.slug}: ${response.statusCode}; ${before.state.messages.length} transcript messages; ${response.body.slice(0, 300)}`,
  )
  if (response.statusCode >= 300) {
    throw new Error(`compaction failed (${response.statusCode}): ${response.body.slice(0, 500)}`)
  }
}
