import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import { EphemeralSessionCoordinator } from '../ephemeralSessionCoordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function acceptedReceipt(id: string, clientNonce = 'nonce-first') {
  return {
    accepted: true,
    cursor: 0,
    clientNonce,
    nativeSessionId: id,
    firstSendState: 'native_persisted',
    sessionSource: 'durable',
    session: {
      id,
      nativeSessionId: id,
      title: 'First prompt',
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
      turnCount: 1,
      hasAssistantReply: false,
    },
  } as const
}

describe('EphemeralSessionCoordinator', () => {
  it('keeps one in-flight first send through a pane switch away and back', async () => {
    const response = deferred<Response>()
    let transcripts = 0
    const fetch = vi.fn(async () => {
      transcripts += 1
      return response.promise
    }) as unknown as typeof globalThis.fetch
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    coordinator.register('local-first')
    const request = { apiBaseUrl: 'https://agent.test', storageScope: 'workspace-a', fetch }

    const firstPaneSend = coordinator.start('local-first', { message: 'first', clientNonce: 'nonce-first' }, request)
    // The first RemotePiSession can now be disposed; the returning pane uses
    // the same request-scoped owner rather than issuing a new native start.
    const returningPaneSend = coordinator.start('local-first', { message: 'edited locally', clientNonce: 'nonce-second' }, request)

    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    response.resolve(jsonResponse(acceptedReceipt('native-only')))
    await expect(firstPaneSend).resolves.toMatchObject({ nativeSessionId: 'native-only' })
    await expect(returningPaneSend).resolves.toMatchObject({ nativeSessionId: 'native-only' })
    expect(transcripts).toBe(1)
  })

  it('retries a response-lost first send with the retained key and original payload', async () => {
    let attempts = 0
    const fetch = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('response lost')
      return jsonResponse(acceptedReceipt('native-retry'))
    }) as unknown as typeof globalThis.fetch
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    const request = { apiBaseUrl: 'https://agent.test', fetch }

    await expect(coordinator.start('local-retry', { message: 'original', clientNonce: 'nonce-original' }, request)).rejects.toThrow('response lost')
    await expect(coordinator.start('local-retry', { message: 'edited retry', clientNonce: 'nonce-edited' }, request)).resolves.toMatchObject({ accepted: true })

    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies).toHaveLength(2)
    expect(bodies[0].nativeSessionStart).toMatchObject({ retry: false })
    expect(bodies[1].nativeSessionStart).toMatchObject({ retry: true })
    expect(bodies[1].nativeSessionStart.idempotencyKey).toBe(bodies[0].nativeSessionStart.idempotencyKey)
    expect(bodies[1].message).toBe('original')
  })

  it('keeps failed drafts and attachments isolated by adopted native session', async () => {
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { message: string; clientNonce: string }
      const id = body.message === 'alpha' ? 'native-alpha' : 'native-beta'
      return jsonResponse({
        accepted: false,
        cursor: 0,
        clientNonce: body.clientNonce,
        nativeSessionId: id,
        firstSendState: 'prompt_failed',
        sessionSource: 'durable',
        session: {
          id,
          nativeSessionId: id,
          title: id,
          createdAt: '2026-06-03T00:00:00.000Z',
          updatedAt: '2026-06-03T00:00:00.000Z',
          turnCount: 1,
          hasAssistantReply: false,
        },
        error: { code: ErrorCode.enum.NATIVE_SESSION_START_PROMPT_FAILED, message: `retry ${id}`, retryable: true },
      })
    }) as unknown as typeof globalThis.fetch
    const request = { apiBaseUrl: 'https://agent.test', fetch }

    await coordinator.start('local-alpha', {
      message: 'alpha', clientNonce: 'alpha', attachments: [{ filename: 'alpha.txt', url: 'https://agent.test/alpha.txt' }],
    }, request)
    await coordinator.start('local-beta', {
      message: 'beta', clientNonce: 'beta', attachments: [{ filename: 'beta.txt', url: 'https://agent.test/beta.txt' }],
    }, request)

    expect(coordinator.failedDraft('native-alpha')).toMatchObject({ draft: 'alpha', attachments: [{ filename: 'alpha.txt' }] })
    expect(coordinator.failedDraft('native-beta')).toMatchObject({ draft: 'beta', attachments: [{ filename: 'beta.txt' }] })
  })

  it('times out a stalled first send without tying the timer to a disposable pane', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof globalThis.fetch
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    const pending = coordinator.start('local-timeout', { message: 'first', clientNonce: 'nonce-first' }, {
      apiBaseUrl: 'https://agent.test', fetch, requestTimeoutMs: 5,
    })
    const rejection = expect(pending).rejects.toThrow('timed out after 5ms')

    await vi.advanceTimersByTimeAsync(5)
    await rejection
    expect(coordinator.phase('local-timeout')).toMatchObject({ type: 'retryable' })
    vi.useRealTimers()
  })

  it('replays a response-lost transaction before deleting its native transcript', async () => {
    let posts = 0
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      posts += 1
      if (posts === 1) throw new TypeError('response lost')
      return jsonResponse(acceptedReceipt('native-lost', 'nonce-lost'))
    }) as unknown as typeof globalThis.fetch
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    const request = { apiBaseUrl: 'https://agent.test', fetch }

    await expect(coordinator.start('local-lost', { message: 'first', clientNonce: 'nonce-lost' }, request)).rejects.toThrow('response lost')
    await expect(coordinator.discard('local-lost')).resolves.toBeUndefined()
    const bodies = vi.mocked(fetch).mock.calls
      .filter(([, init]) => init?.method !== 'DELETE')
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies).toHaveLength(2)
    expect(bodies[1].nativeSessionStart).toMatchObject({ retry: true, idempotencyKey: bodies[0].nativeSessionStart.idempotencyKey })
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })

  it('releases failed recovery when its adopted native session is deleted', async () => {
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    const fetch = vi.fn(async () => jsonResponse({
      ...acceptedReceipt('native-delete-failed'),
      accepted: false,
      firstSendState: 'prompt_failed',
      error: { code: ErrorCode.enum.NATIVE_SESSION_START_PROMPT_FAILED, message: 'retry', retryable: true },
    })) as unknown as typeof globalThis.fetch

    await coordinator.start('local-delete-failed', { message: 'failed', clientNonce: 'nonce-failed' }, { apiBaseUrl: 'https://agent.test', fetch })
    coordinator.discardNativeSession('native-delete-failed')
    expect(coordinator.failedDraft('native-delete-failed')).toBeUndefined()
    expect(coordinator.phase('local-delete-failed')).toBeUndefined()
  })

  it('clears recovery through a state notification without replaying adoption', async () => {
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    const stateChanged = vi.fn()
    const adopted = vi.fn()
    coordinator.subscribeState(stateChanged)
    coordinator.subscribe(adopted)
    const fetch = vi.fn(async () => jsonResponse({
      ...acceptedReceipt('native-failed'),
      accepted: false,
      firstSendState: 'prompt_failed',
      error: { code: ErrorCode.enum.NATIVE_SESSION_START_PROMPT_FAILED, message: 'retry', retryable: true },
    })) as unknown as typeof globalThis.fetch

    await coordinator.start('local-failed', { message: 'failed', clientNonce: 'nonce-failed' }, { apiBaseUrl: 'https://agent.test', fetch })
    expect(coordinator.failedDraft('native-failed')).toBeDefined()
    expect(adopted).toHaveBeenCalledTimes(1)
    coordinator.clearFailedDraft('native-failed')
    expect(coordinator.failedDraft('native-failed')).toBeUndefined()
    expect(stateChanged).toHaveBeenCalledTimes(2)
    expect(adopted).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight receipt and deletes its adopted native session on discard', async () => {
    const response = deferred<Response>()
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : response.promise
    )) as unknown as typeof globalThis.fetch
    const coordinator = new EphemeralSessionCoordinator('workspace-a')
    const start = coordinator.start('local-delete', { message: 'first', clientNonce: 'nonce-delete' }, {
      apiBaseUrl: 'https://agent.test', fetch,
    })
    const discard = coordinator.discard('local-delete')

    response.resolve(jsonResponse(acceptedReceipt('native-delete', 'nonce-delete')))
    await expect(start).resolves.toMatchObject({ nativeSessionId: 'native-delete' })
    await expect(discard).resolves.toBeUndefined()
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'DELETE'])
    expect(coordinator.phase('local-delete')).toBeUndefined()
  })

  it('retains a local transaction after an explicit restart outcome is unknown', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      error: { code: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN, message: 'unknown' },
    }, 409)) as unknown as typeof globalThis.fetch
    const coordinator = new EphemeralSessionCoordinator('workspace-a')

    await expect(coordinator.start('local-restart', { message: 'first', clientNonce: 'nonce-first' }, { apiBaseUrl: 'https://agent.test', fetch })).rejects.toThrow('unknown')
    expect(coordinator.phase('local-restart')).toMatchObject({ type: 'retryable' })
  })
})
