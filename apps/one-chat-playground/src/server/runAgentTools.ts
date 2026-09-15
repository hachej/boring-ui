import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AgentGateway,
  AgentTool,
  AuthorizedAgentScope,
} from '@hachej/boring-agent/shared'

import {
  assertValidSlug,
  noteIntent,
  readIntent,
  setIntentStatus,
  systemClock,
  type Clock,
  type IntentFile,
} from './memoryFiles.js'
import type { SessionTracker } from './reloadTools.js'
import type { StageBus } from './stageBus.js'
import { formatSystemEvent } from './systemEvents.js'

export const BUILDER_AGENT_TYPE_ID = 'builder'
export const DOCUMENTER_AGENT_TYPE_ID = 'documenter'
export const BUILDER_STAGES = ['mockup', 'build'] as const
export type BuilderStage = (typeof BUILDER_STAGES)[number]

const NEW_SURFACE_PATTERN = /\b(?:app|application|screen|page|dashboard|view|portal|workspace|tracker|list|track|manage|organize)\b/i
const BUILT_HISTORY_PATTERN = /\bBuilder(?: build)?:/i

/** Default omitted stages without making callers reproduce intent-history rules. */
export function defaultBuilderStage(intent: Pick<IntentFile, 'status' | 'body' | 'agreement'>): BuilderStage {
  const hasBuiltHistory = intent.status === 'built'
    || intent.status === 'kept'
    || BUILT_HISTORY_PATTERN.test(intent.body)
  return !hasBuiltHistory && NEW_SURFACE_PATTERN.test(intent.agreement ?? '') ? 'mockup' : 'build'
}

function humanIntentTitle(slug: string): string {
  const words = slug.replace(/-/g, ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

function mockupUrl(appBaseUrl: string | undefined, slug: string): string {
  const relative = `mockups/${slug}.html`
  return appBaseUrl ? new URL(relative, appBaseUrl).href : `/${relative}`
}

async function verifyMockup(workspaceRoot: string, slug: string): Promise<void> {
  const relative = path.posix.join('public', 'mockups', `${slug}.html`)
  let body: string
  try {
    body = await readFile(path.join(workspaceRoot, relative), 'utf8')
  } catch {
    throw new Error(`${relative} was not created`)
  }
  for (const required of [/<html(?:\s|>)/i, /<\/html>/i, /<head(?:\s|>)/i, /<\/head>/i, /<body(?:\s|>)/i, /<\/body>/i]) {
    if (!required.test(body)) throw new Error(`${relative} is not a complete HTML page`)
  }
}

function sketchSummary(summary: string): string {
  if (/^Sketch ready[.!]?\s*$/i.test(summary)) {
    return 'Sketch ready. The agreed screen is shown with realistic example data.'
  }
  if (/^Sketch ready\b/i.test(summary)) return summary
  return `Sketch ready. ${summary || 'The agreed screen is shown with realistic example data.'}`
}

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
        displayContent: '',
      })
    } else {
      await connection.send({
        kind: 'followup',
        requestId,
        clientNonce: requestId,
        clientSeq: Date.now(),
        content: options.prompt,
        displayContent: '',
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
  /** User-visible sketch/build milestones. Documenter and maintenance work never emit here. */
  readonly activityBus?: StageBus
  /** The browser-reachable app URL also given to the stage tools. */
  readonly appBaseUrl?: string
  readonly now?: Clock
  readonly log?: (message: string) => void
}): AgentTool[] {
  const now = options.now ?? systemClock
  let builderRunning = false

  const runBuilder: AgentTool = {
    name: 'run_builder',
    description: 'Start a fresh builder for an agreed intent. Choose "mockup" for one static sketch or "build" for the working app. If omitted, a never-built new app or screen is sketched first; other changes build immediately. It returns as soon as it starts, and only one builder can run at a time.',
    parameters: {
      type: 'object',
      properties: {
        slug: SLUG_PARAM,
        stage: {
          type: 'string',
          enum: [...BUILDER_STAGES],
          description: 'Use "mockup" for the static sketch and "build" for the working change.',
        },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    async execute(params) {
      try {
        assertValidSlug(params.slug)
        const slug = params.slug
        if (builderRunning) return text('a builder is already running')
        const gateway = options.getGateway()
        if (!gateway) return text('The builder is not ready yet.', true)
        const intent = await readIntent(options.workspaceRoot, slug)
        if (!intent?.agreement) return text(`Intent ${slug} must be agreed before building.`, true)
        if (params.stage !== undefined && !BUILDER_STAGES.includes(params.stage as BuilderStage)) {
          return text(`Stage must be one of: ${BUILDER_STAGES.join(', ')}.`, true)
        }
        const stage = (params.stage as BuilderStage | undefined) ?? defaultBuilderStage(intent)
        const mockupRelativePath = `public/mockups/${slug}.html`
        const activity = {
          slug,
          label: intent.title ?? slug.replace(/-/g, ' '),
          stage,
          startedAt: new Date().toISOString(),
        } as const

        builderRunning = true
        try {
          if (stage === 'build') await setIntentStatus(options.workspaceRoot, slug, 'building')
          options.activityBus?.emit({ type: 'activity.started', ...activity })
          const run = await startFreshRun({
            gateway,
            scope: options.scope,
            agentTypeId: BUILDER_AGENT_TYPE_ID,
            title: `${stage === 'mockup' ? 'Sketch' : 'Build'} ${slug}`,
            prompt: stage === 'mockup'
              ? `Create the MOCKUP for intent ${slug}. Write only ${mockupRelativePath}.`
              : `BUILD intent ${slug}. Match the approved sketch at ${mockupRelativePath} when it exists.`,
          })
          void run.completion.then(async ({ summary, status }) => {
            options.activityBus?.emit({ type: 'activity.verifying', ...activity })
            let finalSummary = summary || `could not, because the builder session ended with ${status}`
            if (stage === 'mockup') {
              try {
                await verifyMockup(options.workspaceRoot, slug)
              } catch (error) {
                finalSummary = `could not, because ${error instanceof Error ? error.message : String(error)}`
                await noteIntent(options.workspaceRoot, slug, `Builder mockup: ${finalSummary}`, now)
                await setIntentStatus(options.workspaceRoot, slug, 'agreed')
                options.activityBus?.emit({ type: 'activity.done', ...activity })
                await postToColleague({
                  gateway,
                  scope: options.scope,
                  sessions: options.sessions,
                  prompt: `[system event] The builder could not finish the sketch for intent ${slug}: ${finalSummary}. Tell the user plainly and offer to try the sketch again.`,
                  log: options.log,
                })
                return
              }
              finalSummary = sketchSummary(finalSummary)
              await noteIntent(options.workspaceRoot, slug, `Builder mockup: ${finalSummary}`, now)
              await setIntentStatus(options.workspaceRoot, slug, 'sketched')
              options.activityBus?.emit({ type: 'activity.done', ...activity })
              await postToColleague({
                gateway,
                scope: options.scope,
                sessions: options.sessions,
                prompt: formatSystemEvent({
                  kind: 'mockup-finished',
                  slug,
                  summary: finalSummary,
                  url: mockupUrl(options.appBaseUrl, slug),
                  title: `Sketch: ${intent.title ?? humanIntentTitle(slug)}`,
                }),
                log: options.log,
              })
              return
            }

            await noteIntent(options.workspaceRoot, slug, `Builder build: ${finalSummary}`, now)
            await setIntentStatus(options.workspaceRoot, slug, 'built')
            options.activityBus?.emit({ type: 'activity.done', ...activity })
            await postToColleague({
              gateway,
              scope: options.scope,
              sessions: options.sessions,
              prompt: formatSystemEvent({ kind: 'builder-finished', slug, summary: finalSummary }),
              log: options.log,
            })
          }).catch((error) => {
            // No colleague turn will arrive to clear a terminal milestone on this
            // path, so do not leave stale work visible indefinitely.
            options.activityBus?.emit({ type: 'activity.clear' })
            options.log?.(`builder completion failed for ${slug}: ${String(error)}`)
          }).finally(() => {
            builderRunning = false
          })
          return text(`started ${stage}`)
        } catch (error) {
          options.activityBus?.emit({ type: 'activity.done', ...activity })
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
