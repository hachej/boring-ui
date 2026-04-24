import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'

import type { AgentHarness, RunContext, SendMessageInput } from '../../../../shared/harness'
import type { UIMessageChunk } from '../../../../shared/message'
import type { SessionStore } from '../../../../shared/session'
import { chatRoutes } from '../chat'
import { sessionChangesRoutes } from '../sessionChanges'
import { InMemorySessionChangesTracker } from '../../sessionChangesTracker'

function createMockHarness(
  chunksByMessage: Record<string, unknown[]>,
): AgentHarness {
  return {
    id: 'test-harness',
    placement: 'server',
    sendMessage(input: SendMessageInput, _ctx: RunContext) {
      const chunks = chunksByMessage[input.message] ?? []
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk as UIMessageChunk
        }
      })()
    },
    sessions: {
      list: async () => [],
      create: async () => ({ id: 'new', title: 'New', createdAt: '', updatedAt: '', turnCount: 0 }),
      load: async () => ({ id: 'new', title: 'New', createdAt: '', updatedAt: '', turnCount: 0, messages: [] }),
      delete: async () => {},
    } satisfies SessionStore,
  }
}

async function buildApp(chunksByMessage: Record<string, unknown[]>) {
  const app = Fastify({ logger: false })
  const tracker = new InMemorySessionChangesTracker()
  const harness = createMockHarness(chunksByMessage)

  await app.register(chatRoutes, {
    harness,
    workdir: '/tmp/test',
    sessionChangesTracker: tracker,
  })
  await app.register(sessionChangesRoutes, { tracker })
  await app.ready()

  return app
}

describe('GET /api/v1/agent/sessions/:id/changes', () => {
  test('accumulates multiple writes + edits per session with stable response shape', async () => {
    const app = await buildApp({
      first: [
        {
          type: 'data-file-changed',
          data: {
            op: 'write',
            path: 'src/a.ts',
            size: 12,
            timestamp: '2026-04-23T00:00:00.000Z',
            toolCallId: 'tc-1',
          },
        },
      ],
      second: [
        {
          type: 'data-file-changed',
          data: {
            op: 'edit',
            path: 'src/a.ts',
            size: 18,
            timestamp: '2026-04-23T00:00:01.000Z',
            toolCallId: 'tc-2',
          },
        },
      ],
    })

    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 'sess-1', message: 'first' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 'sess-1', message: 'second' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/sess-1/changes',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      files: [
        {
          op: 'write',
          path: 'src/a.ts',
          size: 12,
          timestamp: '2026-04-23T00:00:00.000Z',
        },
        {
          op: 'edit',
          path: 'src/a.ts',
          size: 18,
          timestamp: '2026-04-23T00:00:01.000Z',
        },
      ],
    })

    await app.close()
  })

  test('records deletes (unlink) and keeps session isolation', async () => {
    const app = await buildApp({
      remove: [
        {
          type: 'data-file-changed',
          data: {
            op: 'unlink',
            path: 'src/old.ts',
            timestamp: '2026-04-23T00:01:00.000Z',
            toolCallId: 'tc-rm-1',
          },
        },
      ],
    })

    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: { sessionId: 'sess-delete', message: 'remove' },
    })

    const deleteRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/sess-delete/changes',
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(deleteRes.json()).toEqual({
      files: [
        {
          op: 'unlink',
          path: 'src/old.ts',
          timestamp: '2026-04-23T00:01:00.000Z',
        },
      ],
    })

    const otherRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/sess-other/changes',
    })
    expect(otherRes.statusCode).toBe(200)
    expect(otherRes.json()).toEqual({ files: [] })

    await app.close()
  })
})
