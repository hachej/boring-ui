import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import {
  NativeFirstSendErrorKind,
  clearNativeFirst,
  completeNativeFirst,
  releaseNativeFirst,
  sendNativeFirst,
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

describe('native first-send transaction lifecycle', () => {
  it('bounds retained terminal outcomes until their owner clears one', async () => {
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
    await expect(sendNativeFirst(dataSource, 'blocked', 1_000, 'same-request', vi.fn(), classify))
      .rejects.toMatchObject({ errorCode: ErrorCode.enum.SESSION_LOCKED })

    clearNativeFirst(dataSource, 'local-0')
    await expect(sendNativeFirst(dataSource, 'blocked', 1_000, 'same-request', async () => 'accepted', classify))
      .resolves.toBe('accepted')
    for (let index = 1; index < 32; index += 1) clearNativeFirst(dataSource, `local-${index}`)
    clearNativeFirst(dataSource, 'blocked')
  })

  it('releases a terminal outcome that settles after its owner is dropped', async () => {
    const dataSource = 'release-late-terminal-test'
    const terminal = Object.assign(new Error('outcome unknown'), {
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    const pending = deferred<never>()
    const terminalSend = sendNativeFirst(
      dataSource,
      'local-1',
      1_000,
      'same-request',
      () => pending.promise,
      () => NativeFirstSendErrorKind.TerminalUnknown,
    )

    releaseNativeFirst(dataSource, 'local-1')
    pending.reject(terminal)
    await expect(terminalSend).rejects.toBe(terminal)
    await expect(sendNativeFirst(dataSource, 'local-1', 1_000, 'same-request', async () => 'accepted', () => NativeFirstSendErrorKind.TerminalUnknown))
      .resolves.toBe('accepted')
    clearNativeFirst(dataSource, 'local-1')
  })

  it('retains a late accepted receipt until its completion callback clears it', async () => {
    const dataSource = 'release-late-receipt-test'
    const pending = deferred<string>()
    const receipt = sendNativeFirst(dataSource, 'local-1', 1_000, 'same-request', () => pending.promise, () => NativeFirstSendErrorKind.Definite)

    releaseNativeFirst(dataSource, 'local-1')
    pending.resolve('native-1')
    await expect(receipt).resolves.toBe('native-1')

    const onAdopt = vi.fn(() => {
      expect(completeNativeFirst(dataSource, 'local-1')).toBe(false)
    })
    expect(completeNativeFirst(dataSource, 'local-1', onAdopt)).toBe(true)
    expect(onAdopt).toHaveBeenCalledOnce()
    await expect(sendNativeFirst(dataSource, 'local-1', 1_000, 'next-request', async () => 'native-2', () => NativeFirstSendErrorKind.Definite))
      .resolves.toBe('native-2')
    clearNativeFirst(dataSource, 'local-1')
  })
})
