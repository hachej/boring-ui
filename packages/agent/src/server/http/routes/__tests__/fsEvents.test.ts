import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  Workspace,
  WorkspaceChangeEvent,
  WorkspaceWatcher,
} from '../../../../shared/workspace'
import { fsEventsRoutes } from '../fsEvents'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
})

function makeStubWorkspace(opts: {
  watch?: () => WorkspaceWatcher
} = {}): Workspace {
  const runtimeContext = { runtimeCwd: '/tmp/stub' }
  return {
    root: runtimeContext.runtimeCwd,
    runtimeContext,
    readFile: async () => '',
    writeFile: async () => {},
    unlink: async () => {},
    readdir: async () => [],
    stat: async () => ({ size: 0, mtimeMs: 0, kind: 'file' }),
    mkdir: async () => {},
    rename: async () => {},
    watch: opts.watch,
  }
}

async function createApp(workspace: Workspace): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fsEventsRoutes, { workspace })
  await app.ready()
  apps.push(app)
  return app
}

describe('fsEventsRoutes', () => {
  it('emits a single `unsupported` event and ends when watch is undefined', async () => {
    const app = await createApp(makeStubWorkspace({ watch: undefined }))

    const res = await app.inject({ method: 'GET', url: '/api/v1/fs/events' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    expect(res.body).toContain('event: unsupported')
    expect(res.body).toContain('"reason":"watch_not_implemented"')
  })

  it('streams subscribed change events as SSE messages', async () => {
    let captured: ((e: WorkspaceChangeEvent) => void) | null = null
    const stubWatcher: WorkspaceWatcher = {
      subscribe(listener) {
        captured = listener
        return () => { captured = null }
      },
      close() { captured = null },
    }
    const app = await createApp(makeStubWorkspace({ watch: () => stubWatcher }))

    // Fastify's `inject()` waits for the response to end, but SSE is a
    // long-lived connection. Bind to an ephemeral port and stream over
    // a real socket so we can read partial output and close ourselves.
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (typeof address !== 'object' || !address) throw new Error('no address')
    const url = `http://127.0.0.1:${address.port}/api/v1/fs/events`

    const ac = new AbortController()
    const res = await fetch(url, { signal: ac.signal })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    // Wait for the subscription to register.
    for (let i = 0; i < 20 && !captured; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(captured).not.toBeNull()

    captured!({ op: 'write', path: 'a.ts', mtimeMs: 1234 })
    captured!({ op: 'unlink', path: 'b.ts' })

    // Read until we've seen both envelopes, then abort the request.
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const collected: Array<Record<string, unknown>> = []
    let collectedIds: string[] = []
    let seqs: number[] = []
    while (collected.length < 2) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Reset buffer to the trailing partial line.
      buffer = lines.pop() ?? ''
      let pendingId: string | null = null
      for (const line of lines) {
        if (line.startsWith('id: ')) pendingId = line.slice(4).trim()
        if (line.startsWith('data: ')) {
          const env = JSON.parse(line.slice(6)) as Record<string, unknown>
          collected.push(env.change as Record<string, unknown>)
          if (typeof env.eventId === 'string') collectedIds.push(env.eventId)
          if (typeof env.seq === 'number') seqs.push(env.seq)
          if (pendingId !== null) {
            // SSE id: must equal the envelope's seq.
            expect(Number(pendingId)).toBe(env.seq)
            pendingId = null
          }
        }
      }
    }
    ac.abort()
    await reader.cancel().catch(() => {})

    expect(collected).toContainEqual({ op: 'write', path: 'a.ts', mtimeMs: 1234 })
    expect(collected).toContainEqual({ op: 'unlink', path: 'b.ts' })
    // Reliability invariants: sequence is monotonic, eventIds are unique.
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(collectedIds).size).toBe(collectedIds.length)
  }, 15_000)
})
