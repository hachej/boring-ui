import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import {
  NativeFirstSendErrorKind,
  clearNativeFirst,
  sendNativeFirst,
} from '../nativeFirstSendTransactions'

describe('native first-send transactions', () => {
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
