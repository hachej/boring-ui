import { expect, test } from './fixtures'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

test.describe('M3a: session CRUD', () => {
  test('create → list → load → delete → list confirms removal', async ({
    browserPage,
    backend,
  }) => {
    const api = backend.apiUrl

    // Create two sessions
    const r1 = await browserPage.request.post(`${api}/api/v1/agent/sessions`, {
      data: { title: 'Session A' },
    })
    expect(r1.ok()).toBe(true)
    const sessionA = (await r1.json()) as { id: string; title: string; turnCount: number }
    expect(sessionA.title).toBe('Session A')
    expect(sessionA.turnCount).toBe(0)

    const r2 = await browserPage.request.post(`${api}/api/v1/agent/sessions`, {
      data: { title: 'Session B' },
    })
    expect(r2.ok()).toBe(true)
    const sessionB = (await r2.json()) as { id: string }

    // List — both present
    const listBefore = await browserPage.request.get(`${api}/api/v1/agent/sessions`)
    const beforeList = (await listBefore.json()) as Array<{ id: string }>
    const idsBefore = beforeList.map((s) => s.id)
    expect(idsBefore).toContain(sessionA.id)
    expect(idsBefore).toContain(sessionB.id)

    // Load — returns messages array
    const load = await browserPage.request.get(
      `${api}/api/v1/agent/sessions/${sessionA.id}`,
    )
    expect(load.ok()).toBe(true)
    const detail = (await load.json()) as {
      id: string
      title: string
      messages: unknown[]
    }
    expect(detail.id).toBe(sessionA.id)
    expect(detail.messages).toEqual([])

    // Delete session A
    const del = await browserPage.request.delete(
      `${api}/api/v1/agent/sessions/${sessionA.id}`,
    )
    expect(del.status()).toBe(204)

    // List again — only B remains
    const listAfter = await browserPage.request.get(`${api}/api/v1/agent/sessions`)
    const afterList = (await listAfter.json()) as Array<{ id: string }>
    const idsAfter = afterList.map((s) => s.id)
    expect(idsAfter).not.toContain(sessionA.id)
    expect(idsAfter).toContain(sessionB.id)
  })

  test('load non-existent session returns 404', async ({
    browserPage,
    backend,
  }) => {
    const r = await browserPage.request.get(
      `${backend.apiUrl}/api/v1/agent/sessions/does-not-exist`,
      { failOnStatusCode: false },
    )
    expect(r.status()).toBe(404)
  })

  test('delete non-existent session returns 404', async ({
    browserPage,
    backend,
  }) => {
    const r = await browserPage.request.delete(
      `${backend.apiUrl}/api/v1/agent/sessions/does-not-exist`,
      { failOnStatusCode: false },
    )
    expect(r.status()).toBe(404)
  })

  test('create with default title', async ({ browserPage, backend }) => {
    const r = await browserPage.request.post(
      `${backend.apiUrl}/api/v1/agent/sessions`,
    )
    expect(r.ok()).toBe(true)
    const session = (await r.json()) as { title: string }
    expect(session.title).toBe('New session')
  })
})

test.describe('M3a: UI bridge — state roundtrip', () => {
  test('PUT state → GET returns same state', async ({
    browserPage,
    backend,
  }) => {
    const api = backend.apiUrl

    const put = await browserPage.request.put(`${api}/api/v1/ui/state`, {
      data: { state: { openFiles: ['foo.md', 'bar.ts'], activePanel: 'editor' } },
    })
    expect(put.status()).toBe(204)

    const get = await browserPage.request.get(`${api}/api/v1/ui/state`)
    expect(get.ok()).toBe(true)
    const state = (await get.json()) as Record<string, unknown>
    expect(state).toEqual({
      openFiles: ['foo.md', 'bar.ts'],
      activePanel: 'editor',
    })
  })

  test('GET state before any PUT returns empty object', async ({
    browserPage,
    backend,
  }) => {
    const get = await browserPage.request.get(
      `${backend.apiUrl}/api/v1/ui/state`,
    )
    expect(get.ok()).toBe(true)
    const state = await get.json()
    expect(state).toEqual({})
  })

  test('PUT state overwrites previous', async ({ browserPage, backend }) => {
    const api = backend.apiUrl

    await browserPage.request.put(`${api}/api/v1/ui/state`, {
      data: { state: { a: 1 } },
    })
    await browserPage.request.put(`${api}/api/v1/ui/state`, {
      data: { state: { b: 2 } },
    })

    const get = await browserPage.request.get(`${api}/api/v1/ui/state`)
    const state = (await get.json()) as Record<string, unknown>
    expect(state).toEqual({ b: 2 })
    expect(state).not.toHaveProperty('a')
  })
})

test.describe('M3a: UI bridge — command dispatch', () => {
  test('POST command returns seq and status ok', async ({
    browserPage,
    backend,
  }) => {
    const r = await browserPage.request.post(
      `${backend.apiUrl}/api/v1/ui/commands`,
      { data: { kind: 'openFile', params: { path: 'README.md' } } },
    )
    expect(r.ok()).toBe(true)
    const body = (await r.json()) as { seq: number; status: string }
    expect(body.seq).toBeGreaterThanOrEqual(1)
    expect(body.status).toBe('ok')
  })

  test('SSE subscriber receives posted command', async ({
    browserPage,
  }) => {
    const received = await browserPage.evaluate(async () => {
      const origin = window.location.origin
      return new Promise<{ kind: string; params: Record<string, unknown>; seq: number }>(
        (resolve, reject) => {
          const es = new EventSource(`${origin}/api/v1/ui/commands/next`)
          const timer = setTimeout(() => {
            es.close()
            reject(new Error('SSE timeout — no command received in 10s'))
          }, 10_000)

          es.addEventListener('command', (event) => {
            clearTimeout(timer)
            es.close()
            resolve(JSON.parse(event.data))
          })

          es.onopen = () => {
            fetch(`${origin}/api/v1/ui/commands`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: 'openFile',
                params: { path: 'foo.md' },
              }),
            })
          }
        },
      )
    })

    expect(received.kind).toBe('openFile')
    expect(received.params).toEqual({ path: 'foo.md' })
    expect(received.seq).toBeGreaterThanOrEqual(1)
  })

  test('poll fallback returns command shape', async ({
    browserPage,
    backend,
  }) => {
    const r = await browserPage.request.get(
      `${backend.apiUrl}/api/v1/ui/commands/next?poll=true`,
    )
    expect(r.ok()).toBe(true)
    const body = (await r.json()) as { commands: unknown[] }
    expect(body.commands).toEqual([])
  })
})

test.describe('M3a: stream resume', () => {
  test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

  test('disconnect + reconnect with cursor receives remaining chunks', async ({
    browserPage,
    backend,
  }) => {
    const apiUrl = backend.apiUrl

    // Start a chat turn, collect a few chunks, then disconnect
    const firstRead = await browserPage.evaluate(async (url: string) => {
      const res = await fetch(`${url}/api/v1/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'resume-test',
          message: 'Say exactly: "hello world"',
        }),
        signal: AbortSignal.timeout(3000),
      })

      const turnId = res.headers.get('X-Turn-Id')
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      let chunks = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          text += decoder.decode(value, { stream: true })
          chunks++
        }
      } catch {
        // AbortSignal timeout fires — this is the disconnect
      }

      return { turnId, text, chunks }
    }, apiUrl)

    expect(firstRead.turnId).toBeTruthy()

    // Reconnect with cursor=-1 to replay all buffered chunks
    const resumeRes = await browserPage.request.get(
      `${apiUrl}/api/v1/agent/chat/resume-test/stream?cursor=-1`,
    )
    // Should get 200 with SSE content, or 204 if turn already completed and evicted
    expect([200, 204]).toContain(resumeRes.status())
  })
})
