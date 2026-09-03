import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { defineServerPlugin } from '@hachej/boring-workspace/server'
import type { AgentTool, ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'

export const FACTORY_DELEGATE_PLUGIN_ID = 'factory-delegate'

/** Bump when this file's delegation behavior changes; hashed into the plugin's contentDigest. */
const DELEGATE_PLUGIN_VERSION = 'factory-delegate.v1.2026-09-03'

const DEFAULT_TIMEOUT_MS = 15 * 60_000
const POLL_INTERVAL_MS = 1_000
const BRIEF_MIN_LENGTH = 20
const BRIEF_MAX_LENGTH = 8_000

/**
 * Host-owned grant table: which seat may dispatch which other seat, and under
 * what tool name. Never derived from Agent-authored config or tool input.
 */
const DELEGATE_GRANTS: Readonly<Record<string, { readonly toolName: string; readonly targetAgentTypeId: string }>> = Object.freeze({
  'boring-orchestrator': Object.freeze({ toolName: 'dispatch_worker', targetAgentTypeId: 'boring-worker' }),
  'boring-worker': Object.freeze({ toolName: 'fresh_review', targetAgentTypeId: 'boring-reviewer' }),
})

export interface CreateFactoryDelegatePluginOptions {
  /** Host-owned workspace identity used on every in-process `app.inject` call. */
  readonly workspaceScopeId: string
  /** Deadline for the child session to go idle after one turn. Default 15 minutes. */
  readonly timeoutMs?: number
}

export interface FactoryDelegatePluginHandle {
  readonly plugin: ReturnType<typeof defineServerPlugin>
  /** Wire the live fastify app once `createWorkspaceAgentServer` resolves. */
  bind(app: FastifyInstance): void
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

class DelegateAbortedError extends Error {
  constructor() {
    super('delegation aborted')
    this.name = 'DelegateAbortedError'
  }
}

function textResult(details: Record<string, unknown>, isError: boolean): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError }
}

function invalidInputResult(message: string): ToolResult {
  return textResult({ code: 'INVALID_INPUT', message }, true)
}

function unboundResult(toolName: string): ToolResult {
  return textResult(
    { code: 'HOST_NOT_BOUND', message: `${toolName} is not bound to a running host` },
    true,
  )
}

function parseBrief(params: Record<string, unknown>): { brief: string; title?: string } | { error: string } {
  const brief = params.brief
  if (typeof brief !== 'string' || brief.length < BRIEF_MIN_LENGTH || brief.length > BRIEF_MAX_LENGTH) {
    return { error: `brief must be a string between ${BRIEF_MIN_LENGTH} and ${BRIEF_MAX_LENGTH} characters` }
  }
  const title = params.title
  if (title !== undefined && typeof title !== 'string') {
    return { error: 'title must be a string when provided' }
  }
  return { brief, title }
}

function lastAssistantText(messages: readonly { role: string; parts: readonly { type: string; text?: string }[] }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!
    if (message.role !== 'assistant') continue
    return message.parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim()
  }
  return ''
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DelegateAbortedError()
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(resolvePromise, ms)
    const onAbort = () => {
      clearTimeout(timer)
      rejectPromise(new DelegateAbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface DelegateSessionState {
  readonly summary?: { readonly turnCount?: number }
  readonly state?: {
    readonly status?: string
    readonly currentModel?: unknown
    readonly messages?: readonly { role: string; parts: readonly { type: string; text?: string }[] }[]
  }
}

function createDelegateTool(
  toolName: string,
  targetAgentTypeId: string,
  getApp: () => FastifyInstance | undefined,
  options: CreateFactoryDelegatePluginOptions,
): AgentTool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const workspaceHeader = { 'x-boring-workspace-id': options.workspaceScopeId }

  return {
    name: toolName,
    description: `Start a brand-new session of the ${targetAgentTypeId} seat with the given brief, wait for it to finish exactly one turn, and return only its final answer. The child never inherits this session's context, and its intermediate tool calls and messages are never exposed here.`,
    parameters: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          minLength: BRIEF_MIN_LENGTH,
          maxLength: BRIEF_MAX_LENGTH,
          description: 'Full task brief for the fresh child session. Must stand alone: the child has no memory of this conversation.',
        },
        title: {
          type: 'string',
          description: 'Optional short session title. The host appends this session id for traceability.',
        },
      },
      required: ['brief'],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const parsed = parseBrief(params)
      if ('error' in parsed) return invalidInputResult(parsed.error)
      const { brief, title } = parsed

      const app = getApp()
      if (!app) return unboundResult(toolName)

      const startedAt = new Date().toISOString()
      const parentSessionId = ctx.sessionId ?? 'unknown'
      const sessionTitle = `${title ?? 'Delegated'} ← ${parentSessionId.slice(0, 8)}`

      try {
        const createResponse = await app.inject({
          method: 'POST',
          url: `/api/v1/agents/${targetAgentTypeId}/sessions`,
          headers: workspaceHeader,
          payload: { requestId: randomUUID(), title: sessionTitle },
        })
        if (createResponse.statusCode !== 201) {
          return textResult(
            { code: 'CREATE_SESSION_FAILED', status: createResponse.statusCode, body: createResponse.body },
            true,
          )
        }
        const { sessionId } = createResponse.json<{ sessionId: string }>()

        const promptResponse = await app.inject({
          method: 'POST',
          url: `/api/v1/agents/${targetAgentTypeId}/sessions/${sessionId}/prompt`,
          headers: workspaceHeader,
          payload: {
            requestId: randomUUID(),
            clientNonce: randomUUID(),
            content: `Host context: your session id is ${sessionId} (use it as your br actor). Parent session: ${ctx.sessionId}.\n\n${brief}`,
            requireIdle: true,
          },
        })
        if (promptResponse.statusCode !== 202) {
          return textResult(
            { code: 'PROMPT_FAILED', delegationId: sessionId, status: promptResponse.statusCode, body: promptResponse.body },
            true,
          )
        }

        const deadline = Date.now() + timeoutMs
        let status: 'completed' | 'timeout' = 'timeout'
        let lastState: DelegateSessionState | undefined
        while (Date.now() < deadline) {
          if (ctx.abortSignal.aborted) throw new DelegateAbortedError()
          const stateResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/agents/${targetAgentTypeId}/sessions/${sessionId}/state`,
            headers: workspaceHeader,
          })
          if (stateResponse.statusCode === 200) {
            lastState = stateResponse.json<DelegateSessionState>()
            const turnCount = lastState.summary?.turnCount ?? 0
            if (lastState.state?.status === 'idle' && turnCount >= 1) {
              status = 'completed'
              break
            }
          }
          await sleep(POLL_INTERVAL_MS, ctx.abortSignal)
        }

        const finishedAt = new Date().toISOString()
        const model = lastState?.state?.currentModel
        const answer = lastAssistantText(lastState?.state?.messages ?? [])
        const details = {
          delegationId: sessionId,
          targetAgentTypeId,
          model,
          status,
          answer,
          provenance: {
            sessionId,
            agentTypeId: targetAgentTypeId,
            model,
            briefDigest: sha256(brief),
            startedAt,
            finishedAt,
          },
        }
        return textResult(details, false)
      } catch (error) {
        if (error instanceof DelegateAbortedError) {
          return textResult({ code: 'ABORTED', message: 'delegation aborted before the child session finished' }, true)
        }
        const message = error instanceof Error ? error.message : 'delegation failed'
        return textResult({ code: 'DELEGATE_FAILED', message }, true)
      }
    },
  }
}

export function createFactoryDelegatePlugin(
  options: CreateFactoryDelegatePluginOptions,
): FactoryDelegatePluginHandle {
  if (!options.workspaceScopeId.trim()) throw new TypeError('factory-delegate workspaceScopeId is required')

  let boundApp: FastifyInstance | undefined
  const getApp = () => boundApp

  const plugin = defineServerPlugin({
    id: FACTORY_DELEGATE_PLUGIN_ID,
    label: 'Factory delegation',
    contentDigest: sha256(DELEGATE_PLUGIN_VERSION),
    agentConfigContract: { keys: [] },
    agentToolFactory({ agentTypeId }) {
      const grant = DELEGATE_GRANTS[agentTypeId]
      if (!grant) return []
      return [createDelegateTool(grant.toolName, grant.targetAgentTypeId, getApp, options)]
    },
  })

  return {
    plugin,
    bind(app: FastifyInstance) {
      boundApp = app
    },
  }
}
