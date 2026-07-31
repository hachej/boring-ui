import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import {
  NativeFirstSendErrorKind,
  clearNativeFirst,
  completeNativeFirst,
  sendNativeFirst,
  tombstoneNativeFirst,
} from '../nativeFirstSendTransactions'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('native first-send transactions', () => {
  it('coalesces identical in-flight first sends and rejects a different prompt', async () => {
    const pending = deferred<{ accepted: true }>()
    const request = vi.fn(() => pending.promise)
    const classify = () => NativeFirstSendErrorKind.Definite

    const first = sendNativeFirst('scope-coalesce', 'local-1', 1_000, 'same-prompt', request, classify)
    const duplicate = sendNativeFirst('scope-coalesce', 'local-1', 1_000, 'same-prompt', request, classify)
    const conflict = sendNativeFirst('scope-coalesce', 'local-1', 1_000, 'different-prompt', request, classify)

    await expect(conflict).rejects.toMatchObject({ errorCode: ErrorCode.enum.SESSION_LOCKED })
    expect(request).toHaveBeenCalledTimes(1)

    pending.resolve({ accepted: true })
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { accepted: true },
      { accepted: true },
    ])
    expect(completeNativeFirst('scope-coalesce', 'local-1')).toBe(true)
  })

  it('reconciles one ambiguous result with the same idempotency key', async () => {
    const keys: string[] = []
    const retries: boolean[] = []
    const request = vi.fn(async ({ idempotencyKey, retry }: { idempotencyKey: string; retry: boolean }) => {
      keys.push(idempotencyKey)
      retries.push(retry)
      if (!retry) throw new TypeError('connection closed before receipt')
      return { accepted: true }
    })

    await expect(sendNativeFirst(
      'scope-retry',
      'local-2',
      1_000,
      'prompt',
      request,
      () => NativeFirstSendErrorKind.Ambiguous,
    )).resolves.toEqual({ accepted: true })

    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(1)
    expect(retries).toEqual([false, true])
    expect(completeNativeFirst('scope-retry', 'local-2')).toBe(true)
  })

  it('prevents adoption after the browser-local draft is deleted in flight', async () => {
    const pending = deferred<{ accepted: true }>()
    const first = sendNativeFirst(
      'scope-delete',
      'local-3',
      1_000,
      'prompt',
      () => pending.promise,
      () => NativeFirstSendErrorKind.Definite,
    )
    const deletion = tombstoneNativeFirst<{ accepted: true }>('scope-delete', 'local-3')
    pending.resolve({ accepted: true })

    await expect(first).resolves.toEqual({ accepted: true })
    await expect(deletion).resolves.toEqual({ accepted: true })
    expect(completeNativeFirst('scope-delete', 'local-3')).toBe(false)
    clearNativeFirst('scope-delete', 'local-3')
  })
})
