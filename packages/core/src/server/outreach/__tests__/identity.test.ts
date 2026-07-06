import { describe, expect, it } from 'vitest'

import { ERROR_CODES, HttpError } from '../../../shared/errors.js'
import type { Database } from '../../db/connection.js'
import { createOutreachAuthIdentityAdapter } from '../identity.js'

describe('createOutreachAuthIdentityAdapter', () => {
  it('throws a stable coded error when a claimed account already has another outreach lead', async () => {
    const leads = [
      { id: 'anonymous-lead', outreachLinkId: 'link-a' },
      { id: 'claimed-lead', outreachLinkId: 'link-b' },
    ]
    const tx = {
      select: () => {
        const row = leads.shift()
        return {
          from: () => ({
            where: () => ({
              limit: async () => row ? [row] : [],
            }),
          }),
        }
      },
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
