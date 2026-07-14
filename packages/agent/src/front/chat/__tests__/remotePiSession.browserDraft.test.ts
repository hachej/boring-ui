// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { RemotePiSession } from '../pi/remotePiSession'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('RemotePiSession browser draft first prompt', () => {
  test('posts the materializing prompt before opening the event stream', async () => {
    const promptResponse = deferred<Response>()
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/prompt')) return promptResponse.promise
      if (href.includes('/events')) {
        return Promise.resolve(new Response(new ReadableStream(), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected request ${href}`))
    })
    const session = new RemotePiSession({
      sessionId: 'brdraft_first',
      storageScope: 'scope-a',
      browserDraft: { kind: 'new-native', requestId: 'brreq_first' },
      autoStart: false,
      fetch: fetchMock as unknown as typeof fetch,
      requestTimeoutMs: 500,
    })

    const receiptPromise = session.prompt({ message: 'first', clientNonce: 'nonce-1' })
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/prompt')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      message: 'first',
      clientNonce: 'nonce-1',
      browserDraft: { kind: 'new-native', requestId: 'brreq_first' },
    })

    promptResponse.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce-1' }))
    await expect(receiptPromise).resolves.toMatchObject({ accepted: true, cursor: 1, clientNonce: 'nonce-1' })
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/events?'))).toBe(true))

    const promptCallIndex = fetchMock.mock.calls.findIndex((call) => String(call[0]).endsWith('/prompt'))
    const eventsCallIndex = fetchMock.mock.calls.findIndex((call) => String(call[0]).includes('/events?'))
    expect(promptCallIndex).toBeGreaterThanOrEqual(0)
    expect(eventsCallIndex).toBeGreaterThan(promptCallIndex)
    session.dispose()
  })
})
