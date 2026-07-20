import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import {
  NativeFirstSendErrorKind,
  clearNativeFirst,
  completeNativeFirst,
  releaseNativeFirst,
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
  it('tombstones an in-flight draft without starting another request or allowing adoption', async () => {
    let resolve!: (value: string) => void
    const request = vi.fn(() => new Promise<string>((nextResolve) => { resolve = nextResolve }))
    const dataSource = 'tombstone-test'
    const first = sendNativeFirst(dataSource, 'local-1', 1_000, 'same-request', request, () => NativeFirstSendErrorKind.Definite)

    const discard = tombstoneNativeFirst<string>(dataSource, 'local-1')
    const duplicate = sendNativeFirst(dataSource, 'local-1', 1_000, 'same-request', request, () => NativeFirstSendErrorKind.Definite)
    resolve('native-1')

    await expect(discard).resolves.toBe('native-1')
    await expect(first).resolves.toBe('native-1')
    await expect(duplicate).resolves.toBe('native-1')
    expect(request).toHaveBeenCalledOnce()
    expect(completeNativeFirst(dataSource, 'local-1')).toBe(false)
    clearNativeFirst(dataSource, 'local-1')
  })

  it('removes a completed receipt so the local id can start a new transaction', async () => {
    const dataSource = 'completed-receipt-test'
    const firstRequest = vi.fn(async () => 'native-1')

    await expect(sendNativeFirst(dataSource, 'local-1', 1_000, 'first-request', firstRequest, () => NativeFirstSendErrorKind.Definite))
      .resolves.toBe('native-1')
    expect(completeNativeFirst(dataSource, 'local-1')).toBe(true)

    const secondRequest = vi.fn(async () => 'native-2')
    await expect(sendNativeFirst(dataSource, 'local-1', 1_000, 'second-request', secondRequest, () => NativeFirstSendErrorKind.Definite))
      .resolves.toBe('native-2')
    expect(secondRequest).toHaveBeenCalledOnce()
    clearNativeFirst(dataSource, 'local-1')
  })

  it('retains a settled receipt until deletion clears its tombstoned transaction', async () => {
    const dataSource = 'settled-receipt-test'
    const receipt = { nativeSessionId: 'native-1' }
    const request = vi.fn(async () => receipt)

    await expect(sendNativeFirst(dataSource, 'local-1', 1_000, 'same-request', request, () => NativeFirstSendErrorKind.Definite))
      .resolves.toBe(receipt)
    await expect(tombstoneNativeFirst<typeof receipt>(dataSource, 'local-1')).resolves.toBe(receipt)
    expect(completeNativeFirst(dataSource, 'local-1')).toBe(false)

    clearNativeFirst(dataSource, 'local-1')
    await expect(tombstoneNativeFirst<typeof receipt>(dataSource, 'local-1')).resolves.toBeUndefined()
  })

  it('rejects a new transaction at terminal capacity until a local delete clears one', async () => {
    const dataSource = 'capacity-test'
    const terminal = Object.assign(new Error('outcome unknown'), {
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    const classify = () => NativeFirstSendErrorKind.TerminalUnknown
    const terminalRequest = vi.fn(async () => { throw terminal })

    for (let index = 0; index < 32; index += 1) {
      await expect(sendNativeFirst(dataSource, `local-${index}`, 1_000, 'same-request', terminalRequest, classify))
        .rejects.toBe(terminal)
    }

    const blockedRequest = vi.fn()
    await expect(sendNativeFirst(dataSource, 'local-33', 1_000, 'same-request', blockedRequest, classify))
      .rejects.toMatchObject({ errorCode: ErrorCode.enum.SESSION_LOCKED })
    expect(blockedRequest).not.toHaveBeenCalled()

    clearNativeFirst(dataSource, 'local-0')
    const acceptedRequest = vi.fn(async () => 'accepted')
    await expect(sendNativeFirst(dataSource, 'local-33', 1_000, 'same-request', acceptedRequest, classify))
      .resolves.toBe('accepted')
    expect(acceptedRequest).toHaveBeenCalledTimes(1)
    for (let index = 1; index < 32; index += 1) clearNativeFirst(dataSource, `local-${index}`)
    clearNativeFirst(dataSource, 'local-33')
  })

  it('releases a terminal outcome when its local owner is dropped', async () => {
    const dataSource = 'release-terminal-test'
    const terminal = Object.assign(new Error('outcome unknown'), {
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    const classify = () => NativeFirstSendErrorKind.TerminalUnknown
    const terminalRequest = vi.fn(async () => { throw terminal })

    for (let index = 0; index < 32; index += 1) {
      await expect(sendNativeFirst(dataSource, `local-${index}`, 1_000, 'same-request', terminalRequest, classify))
        .rejects.toBe(terminal)
    }

    releaseNativeFirst(dataSource, 'local-0')
    const acceptedRequest = vi.fn(async () => 'accepted')
    await expect(sendNativeFirst(dataSource, 'local-32', 1_000, 'same-request', acceptedRequest, classify))
      .resolves.toBe('accepted')

    for (let index = 1; index < 32; index += 1) releaseNativeFirst(dataSource, `local-${index}`)
    clearNativeFirst(dataSource, 'local-32')
  })

  it('releases a terminal outcome that settles after its local owner is dropped', async () => {
    const dataSource = 'release-late-terminal-test'
    const terminal = Object.assign(new Error('outcome unknown'), {
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    const classify = () => NativeFirstSendErrorKind.TerminalUnknown
    const deferredRequests = Array.from({ length: 32 }, () => deferred<never>())
    const terminalSends = deferredRequests.map((pending, index) => {
      const send = sendNativeFirst(dataSource, `local-${index}`, 1_000, 'same-request', () => pending.promise, classify)
      releaseNativeFirst(dataSource, `local-${index}`)
      return send
    })

    const terminalResults = terminalSends.map(async (send) => expect(send).rejects.toBe(terminal))
    for (const pending of deferredRequests) pending.reject(terminal)
    await Promise.all(terminalResults)

    const acceptedRequest = vi.fn(async () => 'accepted')
    await expect(sendNativeFirst(dataSource, 'local-32', 1_000, 'same-request', acceptedRequest, classify))
      .resolves.toBe('accepted')
    clearNativeFirst(dataSource, 'local-32')
  })

  it('keeps an in-flight accepted receipt until its completion callback clears it', async () => {
    const dataSource = 'release-late-receipt-test'
    const pending = deferred<string>()
    const receipt = sendNativeFirst(dataSource, 'local-1', 1_000, 'same-request', () => pending.promise, () => NativeFirstSendErrorKind.Definite)

    releaseNativeFirst(dataSource, 'local-1')
    pending.resolve('native-1')
    await expect(receipt).resolves.toBe('native-1')

    const onAdopt = vi.fn()
    expect(completeNativeFirst(dataSource, 'local-1', onAdopt)).toBe(true)
    expect(onAdopt).toHaveBeenCalledOnce()

    const nextRequest = vi.fn(async () => 'native-2')
    await expect(sendNativeFirst(dataSource, 'local-1', 1_000, 'next-request', nextRequest, () => NativeFirstSendErrorKind.Definite))
      .resolves.toBe('native-2')
    clearNativeFirst(dataSource, 'local-1')
  })
})
