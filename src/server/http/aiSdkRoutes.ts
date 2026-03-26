import type { FastifyInstance } from 'fastify'
import { createAnthropic } from '@ai-sdk/anthropic'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { resolveAgentSessionContext, resolveUiWorkspaceKey } from '../agent/sessionContext.js'
import { createAiSdkServerTools } from '../services/aiSdkTools.js'

const DEFAULT_MODEL = 'claude-3-5-haiku-latest'
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
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error == null) return 'unknown error'
  try {
    return JSON.stringify(error)
  } catch {
    return 'unknown error'
  }
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
    const result = streamText({
      model: anthropic(modelId as Parameters<typeof anthropic>[0]),
      system: buildAiSdkSystemPrompt(sessionContext.workspaceRoot),
      messages: await convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      }),
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
