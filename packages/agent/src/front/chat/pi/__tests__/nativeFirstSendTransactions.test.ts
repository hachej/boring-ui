import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import {
  NativeFirstSendErrorKind,
  clearNativeFirst,
  completeNativeFirst,
  sendNativeFirst,
  tombstoneNativeFirst,
} from '../nativeFirstSendTransactions'

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
  })
})
