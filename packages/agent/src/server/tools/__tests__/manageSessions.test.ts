import { describe, expect, test, vi } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import type { ManageSessionsInput, ManageSessionsOptions, ManageSessionsResult, PiChatSessionService, PiSessionRequestContext } from '../../../core/piChatSessionService'
import { createManageSessionsTool } from '../manageSessions'

const abortSignal = new AbortController().signal

function toolCtx(overrides: Record<string, unknown> = {}) {
  return {
    abortSignal,
    toolCallId: 'tool-1',
    sessionId: 'current-session',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    requestId: 'request-a',
    ...overrides,
  } as any
}

class FakeManageService implements Partial<PiChatSessionService> {
  readonly calls: Array<{ ctx: PiSessionRequestContext; input: ManageSessionsInput; options?: ManageSessionsOptions }> = []
  result: ManageSessionsResult = {
    action: 'search',
    sessions: [],
    limit: 10,
    offset: 0,
    count: 0,
  }

  async manageSessions(ctx: PiSessionRequestContext, input: ManageSessionsInput, options?: ManageSessionsOptions): Promise<ManageSessionsResult> {
    this.calls.push({ ctx, input, options })
    return this.result
  }
}

describe('manage_sessions tool', () => {
  test('uses the shared service with auth context and current-session default for rename', async () => {
    const service = new FakeManageService()
    service.result = {
      action: 'rename',
      session: { id: 'current-session', title: 'Renamed', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', turnCount: 0 },
    }
    const tool = createManageSessionsTool({ getService: () => service as unknown as PiChatSessionService })

    const result = await tool.execute({ action: 'rename', title: 'Renamed' }, toolCtx())

    expect(result.isError).toBeUndefined()
    expect(service.calls).toEqual([
      {
        ctx: {
          workspaceId: 'workspace-a',
          authSubject: 'user-a',
          authEmail: undefined,
          authEmailVerified: undefined,
          requestId: 'request-a',
        },
        input: { action: 'rename', title: 'Renamed' },
        options: { executingSessionId: 'current-session' },
      },
    ])
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ action: 'rename', session: { id: 'current-session' } })
  })

  test('rejects invalid delete input before reaching the service', async () => {
    const service = new FakeManageService()
    const manageSessions = vi.spyOn(service, 'manageSessions')
    const tool = createManageSessionsTool({ getService: () => service as unknown as PiChatSessionService })

    const result = await tool.execute({ action: 'delete', sessionId: 'other-session', confirm: false }, toolCtx())

    expect(result.isError).toBe(true)
    expect(manageSessions).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ code: ErrorCode.enum.BRIDGE_COMMAND_INVALID })
  })

  test('rejects whitespace-only rename title with a stable validation error before reaching the service', async () => {
    const service = new FakeManageService()
    const manageSessions = vi.spyOn(service, 'manageSessions')
    const tool = createManageSessionsTool({ getService: () => service as unknown as PiChatSessionService })

    const result = await tool.execute({ action: 'rename', title: ' \r\n ' }, toolCtx())

    expect(result.isError).toBe(true)
    expect(manageSessions).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ code: ErrorCode.enum.BRIDGE_COMMAND_INVALID })
  })

  test('returns stable service errors without using loopback HTTP', async () => {
    const service = new FakeManageService()
    vi.spyOn(service, 'manageSessions').mockRejectedValue(Object.assign(new Error('session not found'), {
      code: ErrorCode.enum.SESSION_NOT_FOUND,
    }))
    const tool = createManageSessionsTool({ getService: () => service as unknown as PiChatSessionService })

    const result = await tool.execute({ action: 'rename', sessionId: 'missing', title: 'New' }, toolCtx())

    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND, message: 'session not found' })
  })
})
