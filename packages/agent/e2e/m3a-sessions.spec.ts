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
