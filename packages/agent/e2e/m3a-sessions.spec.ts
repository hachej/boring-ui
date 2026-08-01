import { ErrorCode } from '../src/shared/error-codes'
import { expect, test } from './fixtures'

test.describe('M3a: pi-chat session CRUD', () => {
  test('create -> list -> state -> delete -> list confirms removal', async ({
    browserPage,
    backend,
  }) => {
    const api = backend.apiUrl

    // Create two sessions
    const r1 = await browserPage.request.post(`${api}/api/v1/agents/default/sessions`, {
      data: { title: 'Session A' },
    })
    expect(r1.ok()).toBe(true)
    const sessionARef = (await r1.json()) as { agentTypeId: string; sessionId: string }
    expect(sessionARef.agentTypeId).toBe('default')

    const r2 = await browserPage.request.post(`${api}/api/v1/agents/default/sessions`, {
      data: { title: 'Session B' },
    })
    expect(r2.ok()).toBe(true)
    const sessionBRef = (await r2.json()) as { agentTypeId: string; sessionId: string }

    // List - both present
    const listBefore = await browserPage.request.get(`${api}/api/v1/agents/default/sessions`)
    const beforePayload = (await listBefore.json()) as { sessions: Array<{ ref: { sessionId: string }; title: string }> }
    const idsBefore = beforePayload.sessions.map((session) => session.ref.sessionId)
    expect(idsBefore).toContain(sessionARef.sessionId)
    expect(idsBefore).toContain(sessionBRef.sessionId)
    expect(beforePayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: expect.objectContaining({ sessionId: sessionARef.sessionId }), title: 'Session A' }),
    ]))

    // State - canonical snapshot with an empty timeline
    const state = await browserPage.request.get(
      `${api}/api/v1/agents/default/sessions/${sessionARef.sessionId}/state`,
    )
    expect(state.ok()).toBe(true)
    const snapshot = (await state.json()) as {
      ref: { agentTypeId: string; sessionId: string }
      state: { messages: unknown[] }
    }
    expect(snapshot.ref).toEqual({ agentTypeId: 'default', sessionId: sessionARef.sessionId })
    expect(snapshot.state.messages).toEqual([])

    // Delete session A
    const del = await browserPage.request.delete(
      `${api}/api/v1/agents/default/sessions/${sessionARef.sessionId}`,
    )
    expect(del.status()).toBe(204)

    // List again - only B remains
    const listAfter = await browserPage.request.get(`${api}/api/v1/agents/default/sessions`)
    const afterPayload = (await listAfter.json()) as { sessions: Array<{ ref: { sessionId: string } }> }
    const idsAfter = afterPayload.sessions.map((session) => session.ref.sessionId)
    expect(idsAfter).not.toContain(sessionARef.sessionId)
    expect(idsAfter).toContain(sessionBRef.sessionId)
  })

  test('state of an unknown session returns stable not-found error', async ({
    browserPage,
    backend,
  }) => {
    const r = await browserPage.request.get(
      `${backend.apiUrl}/api/v1/agents/default/sessions/does-not-exist/state`,
      { failOnStatusCode: false },
    )
    expect(r.status()).toBe(404)
    const body = (await r.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe(ErrorCode.enum.SESSION_NOT_FOUND)
  })

  test('delete returns stable not-found error for unknown sessions', async ({ browserPage, backend }) => {
    const r = await browserPage.request.delete(
      `${backend.apiUrl}/api/v1/agents/default/sessions/does-not-exist`,
      { failOnStatusCode: false },
    )
    expect(r.status()).toBe(404)
    const body = (await r.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe(ErrorCode.enum.SESSION_NOT_FOUND)
  })

  test('create with default title', async ({ browserPage, backend }) => {
    const r = await browserPage.request.post(
      `${backend.apiUrl}/api/v1/agents/default/sessions`,
      { data: {} },
    )
    expect(r.ok()).toBe(true)
    const ref = (await r.json()) as { agentTypeId: string; sessionId: string }
    const list = await browserPage.request.get(`${backend.apiUrl}/api/v1/agents/default/sessions`)
    const payload = (await list.json()) as { sessions: Array<{ ref: { sessionId: string }; title: string }> }
    expect(payload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: expect.objectContaining({ sessionId: ref.sessionId }), title: 'New session' }),
    ]))
  })
})
