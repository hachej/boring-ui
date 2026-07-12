import { ErrorCode } from '../../shared/error-codes'
import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import type { PiChatSessionService, PiSessionRequestContext } from '../../core/piChatSessionService'
import {
  MANAGE_SESSIONS_DEFAULT_LIMIT,
  MANAGE_SESSIONS_MAX_LIMIT,
  parseManageSessionsInput,
} from '../sessionManagement'

export interface ManageSessionsToolOptions {
  getService: () => PiChatSessionService | Promise<PiChatSessionService | undefined> | undefined
}

export function createManageSessionsTool(options: ManageSessionsToolOptions): AgentTool {
  return {
    name: 'manage_sessions',
    description: 'Search authorized Pi sessions, rename the current or an authorized session, or delete an authorized session with confirmation.',
    promptSnippet: 'Use manage_sessions to search sessions, rename this session, or delete another session when explicitly confirmed.',
    parameters: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: {
            action: { const: 'search' },
            query: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: MANAGE_SESSIONS_MAX_LIMIT, default: MANAGE_SESSIONS_DEFAULT_LIMIT },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
          required: ['action'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'rename' },
            sessionId: { type: 'string', minLength: 1, maxLength: 128, description: 'Optional; defaults to the current executing session.' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
          },
          required: ['action', 'title'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'delete' },
            sessionId: { type: 'string', minLength: 1, maxLength: 128, description: 'Required; the current executing session is rejected.' },
            confirm: { const: true },
          },
          required: ['action', 'sessionId', 'confirm'],
          additionalProperties: false,
        },
      ],
    },
    async execute(params, ctx) {
      try {
        const service = await options.getService()
        if (!service?.manageSessions) {
          throw Object.assign(new Error('session management service is unavailable'), {
            code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
            retryable: true,
          })
        }
        const input = parseManageSessionsInput(params)
        const result = await service.manageSessions(toSessionRequestContext(ctx), input, {
          executingSessionId: ctx.sessionId,
        })
        return jsonToolResult(result)
      } catch (error) {
        return errorToolResult(error)
      }
    },
  }
}

function toSessionRequestContext(ctx: ToolExecContext): PiSessionRequestContext {
  return {
    workspaceId: ctx.workspaceId,
    authSubject: ctx.userId,
    authEmail: ctx.userEmail,
    authEmailVerified: ctx.userEmailVerified,
    requestId: ctx.requestId ?? ctx.toolCallId,
  }
}

function jsonToolResult(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    details: value,
  }
}

function errorToolResult(error: unknown): ToolResult {
  const code = ErrorCode.safeParse((error as { code?: unknown })?.code)
  const details = {
    code: code.success ? code.data : ErrorCode.enum.TOOL_EXECUTION_ERROR,
    message: error instanceof Error ? error.message : 'manage_sessions failed',
    retryable: (error as { retryable?: unknown })?.retryable === true ? true : undefined,
    details: (error as { details?: unknown })?.details,
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: details }) }],
    isError: true,
    details,
  }
}
