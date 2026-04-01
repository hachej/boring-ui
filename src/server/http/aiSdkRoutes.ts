import type { FastifyInstance } from 'fastify'
import { createAnthropic } from '@ai-sdk/anthropic'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage, type ModelMessage } from 'ai'
import { resolveAgentSessionContext, resolveUiWorkspaceKey } from '../agent/sessionContext.js'
import { createAiSdkServerTools } from '../services/aiSdkTools.js'

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const SYSTEM_PROMPT = [
  'You are an Agent integrated into Boring UI.',
  'Do not claim to be Claude Code.',
  'Be concise, accurate, and action-oriented.',
].join(' ')

function buildAiSdkSystemPrompt(workspaceRoot: string): string {
  return [
    SYSTEM_PROMPT,
    `Workspace root: ${workspaceRoot}.`,
    'Prefer structured tools first: read_file, write_file, list_dir, search_files, git_status, git_diff.',
    'Use run_command or the start_command/read_command_output/cancel_command flow only when shell access is truly needed.',
    'If UI bridge tools are available, use them to open files or inspect tabs instead of describing UI actions abstractly.',
  ].join(' ')
}

function readAnthropicApiKey(): string | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  return apiKey || null
}

function readModelId(): string {
  return process.env.AI_SDK_ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL
}

function formatStreamError(error: unknown): string {
  if (error instanceof Error) {
    // Include cause chain for debugging
    const msg = error.message || 'unknown error'
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof Error) return `${msg}: ${cause.message}`
    return msg
  }
  if (typeof error === 'string' && error.trim()) return error
  if (error == null) return 'unknown error'
  try {
    return JSON.stringify(error)
  } catch {
    return 'unknown error'
  }
}

/**
 * Remove tool-call parts from assistant messages that don't have a matching
 * tool-result in the next user/tool message. Anthropic's API requires every
 * tool_use block to have a corresponding tool_result.
 */
function stripOrphanedToolCalls(messages: ModelMessage[]): ModelMessage[] {
  // Collect all tool-result IDs across the conversation
  const toolResultIds = new Set<string>()
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === 'tool-result' && 'toolCallId' in part) {
        toolResultIds.add(part.toolCallId)
      }
    }
  }

  // Filter assistant messages to remove tool-call parts without matching results
  return messages.map((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg

    const filtered = msg.content.filter((part) => {
      if (part.type === 'tool-call' && 'toolCallId' in part) {
        return toolResultIds.has(part.toolCallId)
      }
      return true
    })

    // If all content was tool calls that got stripped, add a placeholder text
    if (filtered.length === 0) {
      return { ...msg, content: [{ type: 'text' as const, text: '(tool call omitted)' }] }
    }

    return filtered.length === msg.content.length ? msg : { ...msg, content: filtered }
  })
}

export async function registerAiSdkRoutes(app: FastifyInstance): Promise<void> {
  app.post('/agent/chat', async (request, reply) => {
    const apiKey = readAnthropicApiKey()
    if (!apiKey) {
      return reply.code(503).send({
        error: 'config',
        code: 'ANTHROPIC_API_KEY_REQUIRED',
        message: 'ANTHROPIC_API_KEY is required when agent.runtime=ai-sdk.',
      })
    }

    const body = (request.body as ({ messages?: UIMessage[] } & Record<string, unknown>) | null) || {}
    const messages = Array.isArray(body?.messages) ? body.messages : []
    if (messages.length === 0) {
      return reply.code(400).send({
        error: 'validation',
        code: 'MESSAGES_REQUIRED',
        message: 'messages must be a non-empty array',
      })
    }

    const anthropic = createAnthropic({ apiKey })
    const modelId = readModelId()
    const sessionContext = resolveAgentSessionContext(
      app.config,
      body,
      request.headers['x-workspace-id'] as string | undefined,
    )
    const uiWorkspaceKey = resolveUiWorkspaceKey(
      app.config,
      body,
      request.headers['x-workspace-id'] as string | undefined,
    )
    const rawModelMessages = await convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
    })

    // Strip incomplete tool calls — Anthropic requires every tool_use to have
    // a matching tool_result. convertToModelMessages with ignoreIncompleteToolCalls
    // only suppresses the validation error but keeps orphaned tool-call parts.
    const modelMessages = stripOrphanedToolCalls(rawModelMessages)

    const result = streamText({
      model: anthropic(modelId as Parameters<typeof anthropic>[0]),
      system: buildAiSdkSystemPrompt(sessionContext.workspaceRoot),
      messages: modelMessages,
      tools: createAiSdkServerTools({
        workspaceRoot: sessionContext.workspaceRoot,
        uiWorkspaceKey,
      }),
      stopWhen: stepCountIs(6),
    })

    reply.hijack()
    result.pipeUIMessageStreamToResponse(reply.raw, {
      originalMessages: messages,
      onError: formatStreamError,
    })
    return reply
  })
}
