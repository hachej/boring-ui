import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { AgentGateway, AgentTool, AuthorizedAgentScope, Workspace } from '@hachej/boring-agent/shared'

import { assertValidSlug, noteIntent, readIntent, setIntentStatus, systemClock, type Clock, type IntentFile } from './memoryFiles.js'
import type { AppLifecycle } from './appLifecycle.js'
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
  const hasBuiltHistory = intent.status === 'built' || intent.status === 'kept' || BUILT_HISTORY_PATTERN.test(intent.body)
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

async function verifyMockup(workspace: Workspace, slug: string): Promise<void> {
  const relative = path.posix.join('public', 'mockups', `${slug}.html`)
  let body: string
  try {
    body = await workspace.readFile(relative)
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
  return {
    content: [{ type: 'text', text: body }],
    ...(isError ? { isError: true } : {}),
  }
}

function assistantText(message: { readonly parts: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

interface FreshRun {
  readonly completion: Promise<{
    summary: string
    status: 'ok' | 'aborted' | 'error'
  }>
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
  const connection = await options.gateway.connectSession({
    scope: options.scope,
    ref,
  })
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
  const state = await options.gateway.readSessionState({
    scope: options.scope,
    ref,
  })
  const connection = await options.gateway.connectSession({
    scope: options.scope,
    ref,
  })
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
  readonly workspace: Workspace
  readonly scope: AuthorizedAgentScope
  readonly getGateway: () => AgentGateway | undefined
  readonly sessions: SessionTracker
  /** User-visible sketch/build milestones. Documenter and maintenance work never emit here. */
  readonly activityBus?: StageBus
  /** Browser-reachable accepted and isolated candidate URLs. */
  readonly appBaseUrl?: string
  readonly candidateBaseUrl?: string
  readonly lifecycle?: AppLifecycle
  readonly candidateScope?: (intentSlug: string) => AuthorizedAgentScope
  readonly now?: Clock
  readonly log?: (message: string) => void
}): AgentTool[] {
  const now = options.now ?? systemClock
  let builderRunning = false

  const runBuilder: AgentTool = {
    name: 'run_builder',
    description:
      'Start a fresh builder for an agreed intent in an isolated candidate. Choose "mockup" for one static sketch or "build" for the working app. It returns as soon as the builder starts. The host checks the candidate before the user can see it and makes at most three attempts.',
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
    async execute(params, ctx) {
      try {
        assertValidSlug(params.slug)
        const slug = params.slug
        if (builderRunning) return text('a builder is already running')
        const gateway = options.getGateway()
        if (!gateway) return text('The builder is not ready yet.', true)
        const intent = await readIntent(options.workspace, slug)
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
        let builderScope = options.scope
        if (options.lifecycle) {
          await options.lifecycle.prepareCandidate({
            intentSlug: slug,
            intentTitle: intent.title ?? humanIntentTitle(slug),
            sessionId: ctx.sessionId ?? options.sessions.current() ?? 'unknown',
            model: `${process.env.BORING_AGENT_DEFAULT_MODEL_PROVIDER ?? 'unknown'}/${process.env.BORING_AGENT_DEFAULT_MODEL_ID ?? 'unknown'}`,
          })
          builderScope = options.candidateScope?.(slug) ?? options.scope
        }

        builderRunning = true
        try {
          if (stage === 'build') await setIntentStatus(options.workspace, slug, 'building')
          options.activityBus?.emit({ type: 'activity.started', ...activity })

          const attempt = async (number: number, priorFailure?: string): Promise<void> => {
            const prompt = priorFailure
              ? `FIX intent ${slug} in this isolated candidate. Attempt ${number} of 3. Verification failed: ${priorFailure}`
              : stage === 'mockup'
                ? `Create the MOCKUP for intent ${slug} in this isolated candidate. Write ${mockupRelativePath}.`
                : `BUILD intent ${slug} in this isolated candidate. Match ${mockupRelativePath} when it exists and write one smoke check per agreement shall-line.`
            try {
              const run = await startFreshRun({
              gateway,
              scope: builderScope,
              agentTypeId: BUILDER_AGENT_TYPE_ID,
              title: `${stage === 'mockup' ? 'Sketch' : 'Build'} ${slug} (${number}/3)`,
              prompt,
            })
            const completion = await run.completion
            if (completion.status !== 'ok') throw new Error(completion.summary || `builder session ended with ${completion.status}`)
              options.activityBus?.emit({ type: 'activity.verifying', ...activity })
              const verified = options.lifecycle
                ? await options.lifecycle.verifyCandidate(slug, stage)
                : (stage === 'mockup'
                    ? await verifyMockup(options.workspace, slug).then(() => ({ previewUrl: options.appBaseUrl ?? '/' }))
                    : { previewUrl: options.appBaseUrl ?? '/' })
              const finalSummary = stage === 'mockup' ? sketchSummary(completion.summary) : completion.summary
              const previewUrl = stage === 'mockup'
                ? mockupUrl(verified.previewUrl, slug)
                : verified.previewUrl
              options.activityBus?.emit({
                type: 'stage.show',
                what: 'page',
                url: previewUrl,
                title: stage === 'mockup' ? `Sketch: ${intent.title ?? humanIntentTitle(slug)}` : `Preview: ${intent.title ?? humanIntentTitle(slug)}`,
                label: 'preview',
              })
              await noteIntent(options.workspace, slug, `Builder ${stage}: ${finalSummary}`, now)
              await setIntentStatus(options.workspace, slug, stage === 'mockup' ? 'sketched' : 'built')
              options.activityBus?.emit({ type: 'activity.done', ...activity })
              await postToColleague({
                gateway,
                scope: options.scope,
                sessions: options.sessions,
                prompt: formatSystemEvent(stage === 'mockup'
                  ? {
                      kind: 'mockup-finished',
                      slug,
                      summary: finalSummary,
                      url: previewUrl,
                      title: `Sketch: ${intent.title ?? humanIntentTitle(slug)}`,
                    }
                  : {
                      kind: 'builder-finished',
                      slug,
                      summary: finalSummary,
                      url: previewUrl,
                      title: `Preview: ${intent.title ?? humanIntentTitle(slug)}`,
                    }),
                log: options.log,
              })
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error)
              if (number < 3) {
                options.log?.(`builder verification attempt ${number} failed for ${slug}: ${reason}`)
                await attempt(number + 1, reason)
                return
              }
              throw error
            }
          }

          void attempt(1)
            .catch(async (error) => {
              const reason = error instanceof Error ? error.message : String(error)
              const finalSummary = `could not, because ${reason.split('\n')[0]}`
              await noteIntent(options.workspace, slug, `Builder ${stage}: ${finalSummary}`, now).catch(() => undefined)
              await setIntentStatus(options.workspace, slug, 'agreed').catch(() => undefined)
              options.activityBus?.emit({ type: 'activity.done', ...activity })
              await postToColleague({
                gateway,
                scope: options.scope,
                sessions: options.sessions,
                prompt: `[system event] The builder could not finish intent ${slug}: ${finalSummary}. Tell the user plainly in one sentence.`,
                log: options.log,
              })
            })
            .catch((error) => {
              options.activityBus?.emit({ type: 'activity.clear' })
              options.log?.(`builder completion failed for ${slug}: ${String(error)}`)
            })
            .finally(() => {
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
        summary: {
          type: 'string',
          description: "The builder's short final summary.",
        },
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
        void run.completion
          .then(({ summary: answer, status }) => {
            options.log?.(`documenter finished ${params.slug} (${status}): ${answer || '(no final text)'}`)
          })
          .catch((error) => {
            options.log?.(`documenter completion failed for ${params.slug}: ${String(error)}`)
          })
        return text('started')
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true)
      }
    },
  }

  const lifecycleTool = (
    name: string,
    description: string,
    parameters: AgentTool['parameters'],
    run: (params: Record<string, unknown>, ctx: { sessionId?: string }) => Promise<{ ok: boolean; message: string; intentSlug?: string }>,
  ): AgentTool => ({
    name,
    description,
    parameters,
    async execute(params, ctx) {
      if (!options.lifecycle) return text('Change history is not available yet.', true)
      try {
        const result = await run(params, ctx)
        if (result.ok && (name === 'keep_change' || name === 'discard_change' || name === 'undo_change') && options.appBaseUrl) {
          options.activityBus?.emit({ type: 'stage.show', what: 'app', url: options.appBaseUrl, title: 'Your app' })
        }
        return text(result.message, !result.ok)
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true)
      }
    },
  })

  const keepChange = lifecycleTool(
    'keep_change',
    'Keep the verified preview as the accepted app. Call only after the user says keep.',
    { type: 'object', properties: { slug: SLUG_PARAM }, required: ['slug'], additionalProperties: false },
    async (params) => {
      assertValidSlug(params.slug)
      return options.lifecycle!.keepChange(params.slug)
    },
  )
  const discardChange = lifecycleTool(
    'discard_change',
    'Leave the accepted app as it was and remove the current preview. Call when the user says leave it as it was.',
    { type: 'object', properties: { slug: SLUG_PARAM }, required: ['slug'], additionalProperties: false },
    async (params) => {
      assertValidSlug(params.slug)
      return options.lifecycle!.discardChange(params.slug)
    },
  )
  const undoChange = lifecycleTool(
    'undo_change',
    'Take back a kept change without restoring or deleting user data. Omit slug to take back the last kept change.',
    { type: 'object', properties: { slug: SLUG_PARAM }, additionalProperties: false },
    async (params, ctx) => {
      if (params.slug !== undefined) assertValidSlug(params.slug)
      return options.lifecycle!.undoChange({
        ...(typeof params.slug === 'string' ? { slug: params.slug } : {}),
        sessionId: ctx.sessionId ?? options.sessions.current() ?? 'unknown',
        model: `${process.env.BORING_AGENT_DEFAULT_MODEL_PROVIDER ?? 'unknown'}/${process.env.BORING_AGENT_DEFAULT_MODEL_ID ?? 'unknown'}`,
      })
    },
  )
  const showVersion: AgentTool = {
    name: 'show_version',
    description: 'Show a previous kept version read-only, using throwaway data. Choose a commit or intent name.',
    parameters: {
      type: 'object',
      properties: {
        commit: { type: 'string', description: 'The exact previous version identifier.' },
        slug: SLUG_PARAM,
      },
      additionalProperties: false,
    },
    async execute(params) {
      if (!options.lifecycle) return text('Previous versions are not available yet.', true)
      try {
        if (params.slug !== undefined) assertValidSlug(params.slug)
        const preview = await options.lifecycle.showVersion({
          ...(typeof params.commit === 'string' ? { commit: params.commit } : {}),
          ...(typeof params.slug === 'string' ? { slug: params.slug } : {}),
        })
        options.activityBus?.emit({
          type: 'stage.show',
          what: 'page',
          url: preview.url,
          title: 'Previous version',
          label: 'version',
          versionLabel: preview.label,
        })
        return text('Showing that previous version. Nothing you do there is saved.')
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true)
      }
    },
  }

  return [runBuilder, runDocumenter, keepChange, discardChange, undoChange, showVersion]
}
