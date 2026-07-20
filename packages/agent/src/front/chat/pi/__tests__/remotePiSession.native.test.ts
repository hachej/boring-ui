import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import { RemotePiSession } from '../remotePiSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const receipt = {
  accepted: true,
  cursor: 1,
  clientNonce: 'nonce',
  nativeSessionId: 'native-1',
  session: {
    id: 'native-1', nativeSessionId: 'native-1', title: 'hello',
    createdAt: '2026-06-04T00:00:00.000Z', updatedAt: '2026-06-04T00:00:00.000Z', turnCount: 1, hasAssistantReply: false,
  },
}

describe('RemotePiSession native first send', () => {
  it('reconciles a client timeout against the one persisted native session', async () => {
    const persistedFiles = new Set<string>()
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      if (!body.nativeSessionStart.retry) {
        persistedFiles.add('2026-06-04_native-1.jsonl')
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true })
        })
      }
      return new Response(JSON.stringify(receipt), { status: 202 })
    })
    const session = new RemotePiSession({
      sessionId: 'local-1',
      autoStart: false,
      requestTimeoutMs: 1,
      fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    await session.prompt({ message: 'hello', clientNonce: 'nonce' })

    expect(fetch).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    const retry = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)
    expect(retry.nativeSessionStart).toEqual({ ...first.nativeSessionStart, retry: true })
    expect(persistedFiles).toEqual(new Set(['2026-06-04_native-1.jsonl']))
  })

  it.each([502, 504])('reconciles an ambiguous HTTP %i first-send response with the same key', async (status) => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const { nativeSessionStart } = JSON.parse(init?.body as string)
      return Promise.resolve(nativeSessionStart.retry
        ? new Response(JSON.stringify(receipt), { status: 202 })
        : new Response('gateway error', { status }))
    })
    const session = new RemotePiSession({
      sessionId: `local-http-${status}`, autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    await session.prompt({ message: 'hello', clientNonce: 'nonce' })

    expect(fetch).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    const retry = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)
    expect(retry.nativeSessionStart).toEqual({ ...first.nativeSessionStart, retry: true })
  })

  it('terminal-locks an ambiguous HTTP reconciliation without a third POST', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('gateway error', { status: 502 })))
    const session = new RemotePiSession({
      sessionId: 'local-http-reconciliation-unknown', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps a 4xx native first-send response definite', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { code: ErrorCode.enum.PAYMENT_REQUIRED, message: 'payment required' },
    }), { status: 402 })))
    const session = new RemotePiSession({
      sessionId: 'local-http-definite', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({
      errorCode: ErrorCode.enum.PAYMENT_REQUIRED,
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not start a native first send after disposal', async () => {
    const fetch = vi.fn()
    const session = new RemotePiSession({
      sessionId: 'local-disposed-native', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    session.dispose()

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('defers native adoption until a rapid follow-up completes against the native ID', async () => {
    vi.useFakeTimers()
    try {
      const firstResponse = deferred<Response>()
      const followUpResponse = deferred<Response>()
      const order: string[] = []
      let session!: RemotePiSession
      const fetch = vi.fn((url: string) => {
        if (url.endsWith('/sessions/native-prompt')) return firstResponse.promise
        if (url.includes('/native-1/events?')) return Promise.resolve(new Response(null, { status: 204 }))
        if (url.endsWith('/native-1/followup')) {
          order.push('follow-up')
          return followUpResponse.promise
        }
        throw new Error(`unexpected request: ${url}`)
      })
      const adopted = vi.fn(() => {
        order.push('adopt')
        session.dispose()
      })
      session = new RemotePiSession({
        sessionId: 'local-follow-up-race',
        autoStart: false,
        fetch: fetch as unknown as typeof globalThis.fetch,
        nativeFirstPrompt: { onAdopt: adopted },
      })

      const first = session.prompt({ message: 'hello', clientNonce: 'nonce' })
      await Promise.resolve()
      await Promise.resolve()
      const followUp = session.followUp({ message: 'next', clientNonce: 'follow-up', clientSeq: 1 })
      expect(fetch).toHaveBeenCalledTimes(1)

      firstResponse.resolve(new Response(JSON.stringify(receipt), { status: 202 }))
      await first
      await vi.advanceTimersByTimeAsync(0)

      expect(adopted).not.toHaveBeenCalled()
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        '/api/v1/agent/pi-chat/sessions/native-prompt',
        '/api/v1/agent/pi-chat/native-1/events?cursor=0',
        '/api/v1/agent/pi-chat/native-1/followup',
      ])

      followUpResponse.resolve(new Response(JSON.stringify({ accepted: true, cursor: 2, clientNonce: 'follow-up', clientSeq: 1, queued: true })))
      await expect(followUp).resolves.toEqual({ accepted: true, cursor: 2, clientNonce: 'follow-up', clientSeq: 1, queued: true })
      expect(adopted).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(0)

      expect(adopted).toHaveBeenCalledTimes(1)
      expect(adopted).toHaveBeenCalledWith(receipt.session)
      expect(order).toEqual(['follow-up', 'adopt'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('adopts a native receipt on the next macrotask when there is no follow-up', async () => {
    const adopted = vi.fn()
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(receipt), { status: 202 })))
    const session = new RemotePiSession({
      sessionId: 'local-no-follow-up', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: adopted },
    })

    await session.prompt({ message: 'hello', clientNonce: 'nonce' })

    expect(adopted).not.toHaveBeenCalled()
    await nextMacrotask()
    expect(adopted).toHaveBeenCalledTimes(1)
    expect(adopted).toHaveBeenCalledWith(receipt.session)
  })

  it('fails a rapid follow-up with its native first prompt without a local route', async () => {
    const firstResponse = deferred<Response>()
    const fetch = vi.fn(() => firstResponse.promise)
    const session = new RemotePiSession({
      sessionId: 'local-1',
      autoStart: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    const first = session.prompt({ message: 'hello', clientNonce: 'nonce' })
    await Promise.resolve()
    const followUp = session.followUp({ message: 'next', clientNonce: 'follow-up', clientSeq: 1 })
    firstResponse.reject(new Error('first prompt failed'))

    await expect(first).rejects.toThrow('first prompt failed')
    await expect(followUp).rejects.toThrow('first prompt failed')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('adopts one deferred first send after its original view is disposed', async () => {
    const firstResponse = deferred<Response>()
    const persistedFiles = new Set<string>()
    const firstAdopted = vi.fn()
    const returnedAdopted = vi.fn()
    const fetch = vi.fn(() => {
      persistedFiles.add('2026-06-04_native-1.jsonl')
      return firstResponse.promise
    })
    const first = new RemotePiSession({
      sessionId: 'local-dispose-1', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: firstAdopted },
    })

    const initialPrompt = first.prompt({ message: 'hello', clientNonce: 'nonce' })
    await Promise.resolve()
    first.dispose()
    const returned = new RemotePiSession({
      sessionId: 'local-dispose-1', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: returnedAdopted },
    })
    const retryPrompt = returned.prompt({ message: 'hello', clientNonce: 'nonce' })

    expect(fetch).toHaveBeenCalledTimes(1)
    firstResponse.resolve(new Response(JSON.stringify(receipt), { status: 202 }))
    await Promise.all([initialPrompt, retryPrompt])
    await nextMacrotask()

    expect(persistedFiles).toEqual(new Set(['2026-06-04_native-1.jsonl']))
    expect(firstAdopted).toHaveBeenCalledWith(receipt.session)
    expect(returnedAdopted).not.toHaveBeenCalled()
  })

  it('reuses an uncertain first send for a returned view reconciliation', async () => {
    const firstResponse = deferred<Response>()
    const firstAdopted = vi.fn()
    const returnedAdopted = vi.fn()
    const fetch = vi.fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 202 }))
    const first = new RemotePiSession({
      sessionId: 'local-dispose-2', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: firstAdopted },
    })

    const initialPrompt = first.prompt({ message: 'hello', clientNonce: 'nonce' })
    await Promise.resolve()
    firstResponse.reject(new TypeError('response lost'))
    first.dispose()
    const returned = new RemotePiSession({
      sessionId: 'local-dispose-2', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: returnedAdopted },
    })
    const retryPrompt = returned.prompt({ message: 'hello', clientNonce: 'nonce' })

    await Promise.all([initialPrompt, retryPrompt])
    await nextMacrotask()

    expect(fetch).toHaveBeenCalledTimes(2)
    const firstRequest = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    const reconciliation = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)
    expect(reconciliation.nativeSessionStart).toEqual({ ...firstRequest.nativeSessionStart, retry: true })
    expect(firstAdopted).toHaveBeenCalledWith(receipt.session)
    expect(returnedAdopted).not.toHaveBeenCalled()
  })

  it('rejects a different first prompt while the local native start is in flight', async () => {
    const firstResponse = deferred<Response>()
    const fetch = vi.fn(() => firstResponse.promise)
    const session = new RemotePiSession({
      sessionId: 'local-identity-1', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    const first = session.prompt({ message: 'hello', clientNonce: 'nonce-1' })
    await Promise.resolve()
    await expect(session.prompt({ message: 'different', clientNonce: 'nonce-2' }))
      .rejects.toMatchObject({ message: 'A different message is already starting this chat.', errorCode: 'SESSION_LOCKED' })
    expect(session.getState().optimisticOutbox['nonce-2']).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)

    firstResponse.resolve(new Response(JSON.stringify(receipt), { status: 202 }))
    await first
  })

  it('adopts a native session from a rejected first prompt and retries it normally', async () => {
    const adopted = vi.fn()
    const failedReceipt = {
      accepted: false as const,
      clientNonce: 'nonce',
      nativeSessionId: 'native-1',
      session: receipt.session,
      error: { code: ErrorCode.enum.SESSION_LOCKED, message: 'first prompt failed', retryable: true },
    }
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('/sessions/native-prompt')) return Promise.resolve(new Response(JSON.stringify(failedReceipt), { status: 202 }))
      if (url.includes('/native-1/events?')) return Promise.resolve(new Response(null, { status: 204 }))
      if (url.endsWith('/native-1/prompt')) return Promise.resolve(new Response(JSON.stringify({ accepted: true, cursor: 2, clientNonce: 'retry' })))
      throw new Error(`unexpected request: ${url}`)
    })
    const session = new RemotePiSession({
      sessionId: 'local-failed-1', autoStart: false, fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: adopted },
    })

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({ message: 'first prompt failed', errorCode: 'SESSION_LOCKED' })
    await nextMacrotask()
    expect(adopted).toHaveBeenCalledWith(receipt.session)
    await expect(session.prompt({ message: 'retry', clientNonce: 'retry' })).resolves.toMatchObject({ accepted: true, cursor: 2 })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/agent/pi-chat/sessions/native-prompt',
      '/api/v1/agent/pi-chat/native-1/events?cursor=0',
      '/api/v1/agent/pi-chat/native-1/prompt',
    ])
  })

  it('shares one first-send key and performs one same-key reconciliation after response loss', async () => {
    const adopted = vi.fn()
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 202 }))
    const session = new RemotePiSession({
      sessionId: 'local-1',
      autoStart: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: adopted },
    })

    await Promise.all([
      session.prompt({ message: 'hello', clientNonce: 'nonce' }),
      session.prompt({ message: 'hello', clientNonce: 'nonce' }),
    ])

    expect(fetch).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    const retry = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)
    expect(first.nativeSessionStart).toMatchObject({ retry: false })
    expect(retry.nativeSessionStart).toEqual({ ...first.nativeSessionStart, retry: true })
    await nextMacrotask()
    expect(adopted).toHaveBeenCalledWith(receipt.session)
  })

  it('reconciles a malformed first 2xx receipt with one transcript', async () => {
    const transcripts = new Set<string>()
    const adopted = vi.fn()
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const { nativeSessionStart } = JSON.parse(init?.body as string)
      transcripts.add(nativeSessionStart.idempotencyKey)
      return Promise.resolve(nativeSessionStart.retry
        ? new Response(JSON.stringify(receipt), { status: 202 })
        : new Response('{', { status: 202 }))
    })
    const session = new RemotePiSession({
      sessionId: 'local-malformed-receipt',
      autoStart: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: adopted },
    })

    await session.prompt({ message: 'hello', clientNonce: 'nonce' })

    expect(fetch).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    const retry = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)
    expect(retry.nativeSessionStart).toEqual({ ...first.nativeSessionStart, retry: true })
    expect(transcripts.size).toBe(1)
    await nextMacrotask()
    expect(adopted).toHaveBeenCalledWith(receipt.session)
  })

  it('terminal-locks a restart retry with no receipt without a third POST', async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const { nativeSessionStart } = JSON.parse(init?.body as string)
      if (!nativeSessionStart.retry) return Promise.reject(new TypeError('response lost'))
      return Promise.resolve(new Response(JSON.stringify({
        error: {
          code: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
          message: 'native session start outcome is unknown after restart',
        },
      }), { status: 409 }))
    })
    const session = new RemotePiSession({
      sessionId: 'local-restart-missing-receipt',
      autoStart: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
      nativeFirstPrompt: { onAdopt: vi.fn() },
    })

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    const first = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    const retry = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)
    expect(retry.nativeSessionStart).toEqual({ ...first.nativeSessionStart, retry: true })

    await expect(session.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stores an unknown outcome across a restarted local view without another POST', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn().mockResolvedValue(new Response('{', { status: 202 }))
      const initial = new RemotePiSession({
        sessionId: 'local-malformed-twice',
        autoStart: false,
        fetch: fetch as unknown as typeof globalThis.fetch,
        nativeFirstPrompt: { onAdopt: vi.fn() },
      })

      await expect(initial.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({
        errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
      })
      initial.dispose()
      vi.setSystemTime(Date.now() + 10 * 60_000)

      const restarted = new RemotePiSession({
        sessionId: 'local-malformed-twice',
        autoStart: false,
        fetch: fetch as unknown as typeof globalThis.fetch,
        nativeFirstPrompt: { onAdopt: vi.fn() },
      })
      await expect(restarted.prompt({ message: 'hello', clientNonce: 'nonce' })).rejects.toMatchObject({
        errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
      })

      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
