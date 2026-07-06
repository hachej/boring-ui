import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openPendingInputStoreAt } from '../pendingRequests'

const CTX_A = { workspaceId: 'workspace-a', userId: 'user-a' }
const CTX_B = { workspaceId: 'workspace-b', userId: 'user-b' }

describe('PendingInputStore', () => {
  it('persists redacted, ctx-scoped pending inputs in state.db only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'boring-pending-inputs-'))
    const statePath = join(root, 'state.db')
    const first = openPendingInputStoreAt(statePath)

    await first.store.create({
      sessionId: 's1',
      requestId: 'r1',
      ctx: CTX_A,
      kind: 'approval',
      toolName: 'bash',
      toolCallId: 'tool-1',
      auth: { userEmail: 'user-a@example.com', userEmailVerified: true },
      payload: { params: { command: 'deploy', secret: 'TOKEN_SHOULD_NOT_LEAK' } },
    })
    await first.store.create({
      sessionId: 's2',
      requestId: 'r2',
      ctx: CTX_A,
      kind: 'input',
      schema: { type: 'object', properties: { answer: { type: 'string' } } },
      payload: { values: { secret: 'FORM_SECRET_SHOULD_NOT_LEAK' } },
    })

    const bySession = await first.store.list(CTX_A, { sessionId: 's1' })
    expect(bySession).toEqual([{
      sessionId: 's1',
      requestId: 'r1',
      kind: 'approval',
      toolName: 'bash',
      toolCallId: 'tool-1',
      createdAt: expect.any(String),
    }])
    expect(JSON.stringify(bySession)).not.toContain('TOKEN_SHOULD_NOT_LEAK')
    expect(await first.store.list(CTX_A)).toHaveLength(2)
    expect(await first.store.list(CTX_B)).toEqual([])
    expect(await first.store.list(CTX_B, { sessionId: 's1' })).toEqual([])
    expect(existsSync(join(root, 'events.db'))).toBe(false)
    first.close()

    const reopened = openPendingInputStoreAt(statePath)
    expect(await reopened.store.list(CTX_A)).toHaveLength(2)
    await reopened.store.create({
      sessionId: 's1',
      requestId: 'r3',
      ctx: CTX_B,
      kind: 'approval',
      toolName: 'bash',
    })
    expect(await reopened.store.clearSession(CTX_A, 's2')).toBe(1)
    expect(await reopened.store.list(CTX_A, { sessionId: 's2' })).toEqual([])
    expect(await reopened.store.list(CTX_B, { sessionId: 's1' })).toEqual([
      expect.objectContaining({ requestId: 'r3' }),
    ])
    expect(await reopened.store.resolve('s1', 'r1')).toMatchObject({
      sessionId: 's1',
      requestId: 'r1',
      auth: { userEmail: 'user-a@example.com', userEmailVerified: true },
      payload: { params: { command: 'deploy', secret: 'TOKEN_SHOULD_NOT_LEAK' } },
    })
    expect(await reopened.store.list(CTX_A, { sessionId: 's1' })).toEqual([])
    reopened.close()
  })
})
