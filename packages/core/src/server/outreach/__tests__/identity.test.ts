import { describe, expect, it, vi } from 'vitest'

import { ERROR_CODES, HttpError } from '../../../shared/errors.js'
import type { Database } from '../../db/connection.js'
import { createOutreachAuthIdentityAdapter } from '../identity.js'

describe('createOutreachAuthIdentityAdapter', () => {
  it('throws a stable coded error when a claimed account already has another outreach lead', async () => {
    const execute = vi.fn(async () => {
      const callIndex = execute.mock.calls.length
      if (callIndex === 1) return [{ id: 'anonymous-lead', outreachLinkId: 'link-a' }]
      if (callIndex === 2) return [{ id: 'claimed-lead', outreachLinkId: 'link-b' }]
      return []
    })
    const tx = {
      execute,
    }
    const db = {
      transaction: async (fn: (txArg: typeof tx) => Promise<void>) => fn(tx),
    } as unknown as Database

    const adapter = createOutreachAuthIdentityAdapter(db, 'app-1')

    const promise = adapter.transferAnonymousOwnership({
      anonymousUserId: 'anonymous-user',
      claimedUserId: 'claimed-user',
      claimedEmail: 'claimed@example.test',
    })
    await expect(promise).rejects.toBeInstanceOf(HttpError)
    await expect(promise).rejects.toMatchObject({
      status: 409,
      code: ERROR_CODES.OUTREACH_CLAIM_CONFLICT,
    })
  })
})
