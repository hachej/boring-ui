import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import type { AgentGateway, AuthorizedAgentScope } from '@hachej/boring-agent/shared'

import { compactAfterAgreement, createCompactCommandExtension } from '../compaction'
import { createSessionTracker } from '../reloadTools'

describe('agreement compaction', () => {
  test('maps command arguments to Pi custom compaction instructions', async () => {
    let registered: { handler: (args: string, ctx: { compact(options: unknown): void }) => Promise<void> } | undefined
    createCompactCommandExtension()({
      registerCommand(_name: string, command: typeof registered) { registered = command },
    } as never)
    let received: { customInstructions?: string; onComplete(): void } | undefined
    await registered!.handler('Keep this.', {
      getContextUsage: () => ({ tokens: 123, contextWindow: 1_000, percent: 12.3 }),
      compact(options: unknown) {
        received = options as typeof received
        received!.onComplete()
      },
    } as never)
    expect(received?.customInstructions).toBe('Keep this.')
  })

  test('uses the addressed Host command route after the colleague becomes idle', async () => {
    const app = Fastify()
    let payload: Record<string, unknown> | undefined
    app.post('/api/v1/agents/default/commands/execute', async (request) => {
      payload = request.body as Record<string, unknown>
      return { ok: true }
    })
    const snapshot = {
      summary: { status: 'idle' },
      state: { messages: [] },
    }
    const gateway = { async readSessionState() { return snapshot } } as unknown as AgentGateway
    const tracker = createSessionTracker()
    tracker.remember('colleague-session')
    await compactAfterAgreement({
      app,
      gateway,
      scope: { workspaceScopeId: 'workspace', authSubjectId: 'user' } as AuthorizedAgentScope,
      sessions: tracker,
      slug: 'supplier-list',
    })
    expect(payload).toMatchObject({
      sessionId: 'colleague-session',
      name: 'compact',
      args: "Keep: the pointer to agent/intents/supplier-list.md, the agreed summary, and the user's standing preferences. Drop the interview questions and answers.",
    })
    await app.close()
  })
})
