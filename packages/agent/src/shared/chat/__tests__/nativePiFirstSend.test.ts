import { describe, expect, it } from 'vitest'
import { PromptNewSessionReceiptSchema } from '../index'

describe('PromptNewSessionReceiptSchema', () => {
  const receipt = {
    accepted: true,
    cursor: 0,
    clientNonce: 'nonce',
    nativeSessionId: 'native-1',
    firstSendState: 'native_persisted',
    sessionSource: 'durable',
    session: {
      id: 'native-1',
      nativeSessionId: 'native-1',
      title: 'First prompt',
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
      turnCount: 1,
      hasAssistantReply: false,
    },
  }

  it('accepts only native receipt identity that agrees with its session row', () => {
    expect(PromptNewSessionReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(PromptNewSessionReceiptSchema.safeParse({
      ...receipt,
      session: { ...receipt.session, nativeSessionId: 'native-other' },
    }).success).toBe(false)
  })

  it('normalizes a rolling-upgrade receipt without native summary adornments', () => {
    const legacy = PromptNewSessionReceiptSchema.parse({
      ...receipt,
      sessionSource: undefined,
      session: {
        id: 'native-1',
        title: 'First prompt',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
        turnCount: 1,
      },
    })
    expect(legacy).toMatchObject({
      sessionSource: 'optimistic',
      session: { nativeSessionId: 'native-1', hasAssistantReply: false },
    })
  })
})
