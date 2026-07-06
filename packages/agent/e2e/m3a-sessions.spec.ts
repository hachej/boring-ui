import { ErrorCode } from '../src/shared/error-codes'
import { expect, test } from './fixtures'

test.describe('M3a: pi-chat session CRUD', () => {
  test('create -> list -> state -> delete -> list confirms removal', async ({
    browserPage,
    backend,
  }) => {
    const api = backend.apiUrl

    // Create two sessions
    const r1 = await browserPage.request.post(`${api}/api/v1/agent/pi-chat/sessions`, {
      data: { title: 'Session A' },
    })
    expect(r1.ok()).toBe(true)
    const sessionA = (await r1.json()) as { id: string; title: string; turnCount: number }
    expect(sessionA.title).toBe('Session A')
    expect(sessionA.turnCount).toBe(0)

    const r2 = await browserPage.request.post(`${api}/api/v1/agent/pi-chat/sessions`, {
      data: { title: 'Session B' },
    })
    expect(r2.ok()).toBe(true)
    const sessionB = (await r2.json()) as { id: string }

    // List - both present
    const listBefore = await browserPage.request.get(`${api}/api/v1/agent/pi-chat/sessions`)
    const beforeList = (await listBefore.json()) as Array<{ id: string }>
    const idsBefore = beforeList.map((s) => s.id)
    expect(idsBefore).toContain(sessionA.id)
    expect(idsBefore).toContain(sessionB.id)

    // State - canonical snapshot with an empty timeline
    const state = await browserPage.request.get(
      `${api}/api/v1/agent/pi-chat/${sessionA.id}/state`,
    )
    expect(state.ok()).toBe(true)
    const snapshot = (await state.json()) as {
      sessionId: string
      status: string
      messages: unknown[]
    }
    expect(snapshot.sessionId).toBe(sessionA.id)
    expect(snapshot.messages).toEqual([])

    // Delete session A
    const del = await browserPage.request.delete(
      `${api}/api/v1/agent/pi-chat/sessions/${sessionA.id}`,
    )
    expect(del.status()).toBe(204)

    // List again - only B remains
    const listAfter = await browserPage.request.get(`${api}/api/v1/agent/pi-chat/sessions`)
    const afterList = (await listAfter.json()) as Array<{ id: string }>
    const idsAfter = afterList.map((s) => s.id)
    expect(idsAfter).not.toContain(sessionA.id)
    expect(idsAfter).toContain(sessionB.id)
  })

  test('state of an unknown session returns stable not-found error', async ({
    browserPage,
    backend,
  }) => {
    const r = await browserPage.request.get(
      `${backend.apiUrl}/api/v1/agent/pi-chat/does-not-exist/state`,
      { failOnStatusCode: false },
    )
    expect(r.status()).toBe(404)
    const body = (await r.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe(ErrorCode.enum.SESSION_NOT_FOUND)
  })

  test('delete returns stable not-found error for unknown sessions', async ({ browserPage, backend }) => {
    const r = await browserPage.request.delete(
      `${backend.apiUrl}/api/v1/agent/pi-chat/sessions/does-not-exist`,
      { failOnStatusCode: false },
    )
    expect(r.status()).toBe(404)
    const body = (await r.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe(ErrorCode.enum.SESSION_NOT_FOUND)
  })

  test('create with default title', async ({ browserPage, backend }) => {
    const r = await browserPage.request.post(
      `${backend.apiUrl}/api/v1/agent/pi-chat/sessions`,
      { data: {} },
    )
    expect(r.ok()).toBe(true)
    const session = (await r.json()) as { title: string }
    expect(session.title).toBe('New session')
  })
})
