import { randomUUID } from 'node:crypto'

import type {
  AgentGateway,
  AgentTool,
  AuthorizedAgentScope,
} from '@hachej/boring-agent/shared'

import { assertValidSlug, noteIntent, readIntent, setIntentStatus, systemClock, type Clock } from './memoryFiles.js'
import type { SessionTracker } from './reloadTools.js'
import { formatSystemEvent } from './systemEvents.js'

export const BUILDER_AGENT_TYPE_ID = 'builder'
export const DOCUMENTER_AGENT_TYPE_ID = 'documenter'

function text(body: string, isError = false): Awaited<ReturnType<AgentTool['execute']>> {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) }
}

function assistantText(message: { readonly parts: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.type === 'text' ? part.text : '')
    .join('\n')
    .trim()
}

interface FreshRun {
  readonly completion: Promise<{ summary: string; status: 'ok' | 'aborted' | 'error' }>
}

async function startFreshRun(options: {
  readonly gateway: AgentGateway
  readonly scope: AuthorizedAgentScope
  readonly agentTypeId: string
  readonly title: string
  readonly prompt: string
}): Promise<FreshRun> {
  const requestId = `one-chat:${options.agentTypeId}:${randomUUID()}`
  const ref = await options.gateway.createSession({
    scope: options.scope,
    agentTypeId: options.agentTypeId,
    requestId,
    title: options.title,
  })
  const connection = await options.gateway.connectSession({ scope: options.scope, ref })
  try {
    await connection.send({
      kind: 'prompt',
      requestId,
      clientNonce: requestId,
      content: options.prompt,
    })
  } catch (error) {
    await connection.close()
    throw error
  }

  const completion = (async () => {
    let summary = ''
    let status: 'ok' | 'aborted' | 'error' = 'error'
    try {
      for await (const envelope of connection.events) {
        const event = envelope.event
        if (event.type === 'message-end' && event.final.role === 'assistant') {
          summary = assistantText(event.final)
        }
        if (event.type === 'agent-end' && event.willRetry !== true) {
          status = event.status
          break
        }
      }
      return { summary, status }
    } finally {
      await connection.close()
    }
  })()
  return { completion }
}

async function postToColleague(options: {
  readonly gateway: AgentGateway
  readonly scope: AuthorizedAgentScope
  readonly sessions: SessionTracker
  readonly prompt: string
  readonly log?: (message: string) => void
}): Promise<void> {
  const sessionId = options.sessions.current()
  if (!sessionId) {
    options.log?.('builder completion: no live colleague session; skipped system event')
    return
  }
  const ref = { agentTypeId: 'default', sessionId }
  const state = await options.gateway.readSessionState({ scope: options.scope, ref })
  const connection = await options.gateway.connectSession({ scope: options.scope, ref })
  const requestId = `one-chat:system-event:${randomUUID()}`
  try {
    if (state.summary.status === 'idle' || state.summary.status === 'error') {
      await connection.send({
        kind: 'prompt',
        requestId,
        clientNonce: requestId,
        content: options.prompt,
      })
    } else {
      await connection.send({
        kind: 'followup',
        requestId,
        clientNonce: requestId,
        clientSeq: Date.now(),
        content: options.prompt,
      })
    }
  } finally {
    await connection.close()
  }
}

const SLUG_PARAM = {
  type: 'string',
  description: 'The agreed intent name, in lowercase words joined by hyphens.',
} as const

export function createRunAgentTools(options: {
  readonly workspaceRoot: string
  readonly scope: AuthorizedAgentScope
  readonly getGateway: () => AgentGateway | undefined
  readonly sessions: SessionTracker
  readonly now?: Clock
  readonly log?: (message: string) => void
}): AgentTool[] {
  const now = options.now ?? systemClock
  let builderRunning = false

  const runBuilder: AgentTool = {
    name: 'run_builder',
    description: 'Start a fresh builder for an agreed intent. It works separately and this call returns as soon as it has started. Only one build can run at a time.',
    parameters: {
      type: 'object',
      properties: { slug: SLUG_PARAM },
      required: ['slug'],
      additionalProperties: false,
    },
    async execute(params) {
      try {
        assertValidSlug(params.slug)
        const slug = params.slug
        if (builderRunning) return text('a build is already running')
        const gateway = options.getGateway()
        if (!gateway) return text('The builder is not ready yet.', true)
        const intent = await readIntent(options.workspaceRoot, slug)
        if (!intent?.agreement) return text(`Intent ${slug} must be agreed before building.`, true)

        builderRunning = true
        try {
          await setIntentStatus(options.workspaceRoot, slug, 'building')
          const run = await startFreshRun({
            gateway,
            scope: options.scope,
            agentTypeId: BUILDER_AGENT_TYPE_ID,
            title: `Build ${slug}`,
            prompt: `Build intent ${slug}`,
          })
          void run.completion.then(async ({ summary, status }) => {
            const finalSummary = summary || `could not, because the builder session ended with ${status}`
            await noteIntent(options.workspaceRoot, slug, `Builder: ${finalSummary}`, now)
            await setIntentStatus(options.workspaceRoot, slug, 'built')
            await postToColleague({
              gateway,
              scope: options.scope,
              sessions: options.sessions,
              prompt: formatSystemEvent({ kind: 'builder-finished', slug, summary: finalSummary }),
              log: options.log,
            })
          }).catch((error) => {
            options.log?.(`builder completion failed for ${slug}: ${String(error)}`)
          }).finally(() => {
            builderRunning = false
          })
          return text('started')
        } catch (error) {
          builderRunning = false
          throw error
        }
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true)
      }
    },
  }

  const runDocumenter: AgentTool = {
    name: 'run_documenter',
    description: 'Start a fresh documenter after a builder finishes. It records the finished app description separately and returns immediately.',
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        summary: { type: 'string', description: 'The builder\'s short final summary.' },
      },
      required: ['slug', 'summary'],
      additionalProperties: false,
    },
    async execute(params) {
      try {
        assertValidSlug(params.slug)
        const summary = typeof params.summary === 'string' ? params.summary.trim() : ''
        if (!summary) throw new Error('A builder summary is required.')
        const gateway = options.getGateway()
        if (!gateway) return text('The documenter is not ready yet.', true)
        const run = await startFreshRun({
          gateway,
          scope: options.scope,
          agentTypeId: DOCUMENTER_AGENT_TYPE_ID,
          title: `Document ${params.slug}`,
          prompt: `Document intent ${params.slug}. Diff summary: ${summary}`,
        })
        void run.completion.then(({ summary: answer, status }) => {
          options.log?.(`documenter finished ${params.slug} (${status}): ${answer || '(no final text)'}`)
        }).catch((error) => {
          options.log?.(`documenter completion failed for ${params.slug}: ${String(error)}`)
        })
        return text('started')
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true)
      }
    },
  }

  return [runBuilder, runDocumenter]
}
