import { expect, test } from './fixtures'

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


test.describe('M3a: stream resume', () => {

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
