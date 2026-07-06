import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionStreamPath, type Agent, type AgentEvent } from '../../../../shared/events'
import type { PiChatEvent } from '../../../../shared/chat'
import { ErrorCode } from '../../../../shared/error-codes'
import type { SessionCtx, SessionDetail } from '../../../../shared/session'
import { formatOffset, SqliteEventStreamStore, type EventStreamStore } from '../../../events/eventStreamStore'
import { openDatabase, type OpenDatabaseResult } from '../../../events/sqlStorage'
import { eventStreamRoutes } from '../eventStream'

const apps: FastifyInstance[] = []
const databases: OpenDatabaseResult[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const database of databases.splice(0)) database.db.close()
})

describe('eventStreamRoutes', () => {
  it('serves DS catch-up reads, HEAD metadata, and If-None-Match caching', async () => {
    const { app, store } = await createApp()
    const offsets = await seedEvents(store, 's1', 3)

    const full = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/default/sessions/s1/events/stream?offset=-1',
    })
    expect(full.statusCode).toBe(200)
    expect(full.headers['stream-next-offset']).toBe(offsets[2])
    expect(full.headers['stream-up-to-date']).toBe('true')
    expect(full.headers['x-accel-buffering']).toBe('no')
    expect((full.json() as AgentEvent[]).map((event) => event.eventIndex)).toEqual([0, 1, 2])

    const tail = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/default/sessions/s1/events/stream?offset=${offsets[0]}`,
    })
    expect(tail.statusCode).toBe(200)
    expect((tail.json() as AgentEvent[]).map((event) => event.eventIndex)).toEqual([1, 2])

    const head = await app.inject({
      method: 'HEAD',
      url: '/api/v1/agents/default/sessions/s1/events/stream',
    })
    expect(head.statusCode).toBe(200)
    expect(head.body).toBe('')
    expect(head.headers['stream-next-offset']).toBe(offsets[2])
    expect(head.headers.etag).toBeTruthy()

    const cached = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/default/sessions/s1/events/stream?offset=-1',
      headers: { 'if-none-match': full.headers.etag as string },
    })
    expect(cached.statusCode).toBe(304)
    expect(cached.body).toBe('')
  })

  it('fails closed when registered without a session authorizer', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const store = new SqliteEventStreamStore(database.sql, database.runTransaction)
    await seedEvents(store, 's1', 1)
    const app = Fastify({ logger: false })
    await app.register(eventStreamRoutes, { eventStore: store } as never)
    await app.ready()
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/default/sessions/s1/events/stream?offset=-1',
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({
      error: {
        code: ErrorCode.enum.INTERNAL_ERROR,
        message: 'event stream route requires agent or getAgent',
      },
    })
  })

  it('marks empty long-poll responses as non-cacheable', async () => {
    const { app, store } = await createApp()
    await store.createStream(sessionStreamPath('s1'))
    await store.closeStream(sessionStreamPath('s1'))

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/default/sessions/s1/events/stream?offset=-1&live=long-poll',
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['stream-up-to-date']).toBe('true')
    expect(response.headers['stream-closed']).toBe('true')
  })

  it('rejects non-default agent ids while preserving absent-agentId 404 behavior', async () => {
    const { app } = await createApp()

    const nonDefault = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/reviewer/sessions/s1/events/stream?offset=-1',
    })
    expect(nonDefault.statusCode).toBe(404)
    expect(nonDefault.json()).toEqual({
      error: {
        code: ErrorCode.enum.SESSION_NOT_FOUND,
        message: 'agent not found',
      },
    })

    const absent = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/sessions/s1/events/stream?offset=-1',
    })
    expect(absent.statusCode).toBe(404)
  })

  it('streams SSE data/control events and replays missed events after disconnect', async () => {
    const { app, store } = await createApp()
    const [firstOffset] = await seedEvents(store, 'sse-1', 1)

    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (typeof address !== 'object' || !address) throw new Error('no address')

    const controller = new AbortController()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/agents/default/sessions/sse-1/events/stream?offset=-1&live=sse`,
      { signal: controller.signal },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('x-accel-buffering')).toBe('no')

    const reader = response.body!.getReader()
    const sse = await readUntil(reader, (text) =>
      text.includes('event: data') &&
      text.includes('event: control') &&
      text.includes(firstOffset),
    )
    expect(sse).toContain('event: data')
    expect(sse).toContain('event: control')
    expect(sse).toContain('"streamNextOffset"')
    controller.abort()
    await reader.cancel().catch(() => {})

    const secondOffset = await store.appendAgentEvent('sse-1', piEvent(1))
    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/default/sessions/sse-1/events/stream?offset=${firstOffset}`,
    })

    expect(replay.statusCode).toBe(200)
    expect(replay.headers['stream-next-offset']).toBe(secondOffset)
    expect((replay.json() as AgentEvent[]).map((event) => event.eventIndex)).toEqual([1])
  }, 15_000)
})

async function createApp(): Promise<{ app: FastifyInstance; store: EventStreamStore }> {
  const database = openDatabase(':memory:')
  databases.push(database)
  const store = new SqliteEventStreamStore(database.sql, database.runTransaction)
  const app = Fastify({ logger: false })
  await app.register(eventStreamRoutes, { eventStore: store, agent: authorizeAllAgent() })
  await app.ready()
  apps.push(app)
  return { app, store }
}

function authorizeAllAgent(): Agent {
  return {
    start: async () => ({ sessionId: 'unused', startIndex: 0 }),
    stream: () => ({ async *[Symbol.asyncIterator]() {} }),
    send: async function* () {},
    resolveInput: async () => {
      throw new Error('not used')
    },
    interrupt: async () => ({ accepted: true }),
    stop: async () => ({ accepted: true, stopped: true }),
    sessions: {
      list: async () => [],
      create: async () => sessionDetail('created'),
      load: async (_ctx: SessionCtx, sessionId: string) => sessionDetail(sessionId),
      delete: async () => {},
      pendingInputs: async () => [],
    },
    readiness: {
      requirements: [],
      status: async () => [],
    },
    dispose: async () => {},
  } as unknown as Agent
}

function sessionDetail(sessionId: string): SessionDetail {
  return {
    id: sessionId,
    title: sessionId,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    turnCount: 0,
  }
}

async function seedEvents(store: EventStreamStore, sessionId: string, count: number): Promise<string[]> {
  await store.createStream(sessionStreamPath(sessionId))
  const offsets: string[] = []
  for (let seq = 0; seq < count; seq++) {
    offsets.push(await store.appendAgentEvent(sessionId, piEvent(seq)))
  }
  expect(offsets).toEqual(Array.from({ length: count }, (_, index) => formatOffset(index)))
  return offsets
}

function piEvent(seq: number): PiChatEvent {
  return { type: 'agent-start', seq, turnId: `turn-${seq}` }
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (predicate(text)) return text
  }
  throw new Error(`timed out waiting for SSE data; received: ${text}`)
}
