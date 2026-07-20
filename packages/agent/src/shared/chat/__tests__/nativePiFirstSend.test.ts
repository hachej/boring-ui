import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../error-codes'
import { isNativePromptReceipt } from '../nativePiFirstSend'

const session = {
  id: 'native-1',
  title: 'Native session',
  createdAt: '2026-06-04T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:01.000Z',
  turnCount: 1,
  nativeSessionId: 'native-1',
  hasAssistantReply: true,
}

const accepted = {
  accepted: true,
  cursor: 1,
  clientNonce: 'nonce',
  nativeSessionId: 'native-1',
  session,
}

describe('isNativePromptReceipt', () => {
  it('accepts complete success and rejection receipts', () => {
    expect(isNativePromptReceipt(accepted)).toBe(true)
    expect(isNativePromptReceipt({
      accepted: false,
      clientNonce: 'nonce',
      nativeSessionId: 'native-1',
      session,
      cursor: 'not-a-success-cursor',
      duplicate: 'not-a-success-duplicate',
      error: { code: ErrorCode.enum.SESSION_LOCKED, message: 'Locked', retryable: true, details: { reason: 'duplicate' } },
    })).toBe(true)
  })

  it.each([
    [{ ...accepted, cursor: Number.NaN }],
    [{ ...accepted, cursor: Number.POSITIVE_INFINITY }],
    [{ ...accepted, cursor: -1 }],
    [{ ...accepted, cursor: 1.5 }],
    [{ ...accepted, duplicate: 'yes' }],
    [{ ...accepted, session: { ...session, id: 'other' } }],
    [{ ...accepted, session: { ...session, title: undefined } }],
    [{ ...accepted, session: { ...session, turnCount: -1 } }],
    [{ ...accepted, session: { ...session, turnCount: 1.5 } }],
    [{ ...accepted, session: { ...session, turnCount: Number.POSITIVE_INFINITY } }],
    [{ ...accepted, session: { ...session, nativeSessionId: 1 } }],
    [{ ...accepted, session: { ...session, hasAssistantReply: 'true' } }],
    [{ ...accepted, accepted: false, error: { code: 1, message: 'Nope' } }],
    [{ ...accepted, accepted: false, error: { code: ErrorCode.enum.SESSION_LOCKED, message: 1 } }],
    [{ ...accepted, accepted: false, error: { code: ErrorCode.enum.SESSION_LOCKED, message: 'Nope', retryable: 'yes' } }],
  ])('rejects malformed receipt %#', (value) => {
    expect(isNativePromptReceipt(value)).toBe(false)
  })
})
