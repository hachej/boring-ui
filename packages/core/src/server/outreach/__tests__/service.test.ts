import { describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from '../../../shared/errors.js'
import type { Database } from '../../db/connection.js'
import { createOutreachExperience } from '../service.js'

describe('outreach service validation', () => {
  it('rejects clone_per_lead at experience creation with a stable code', async () => {
    const db = {
      select: vi.fn(),
      insert: vi.fn(),
    } as unknown as Database

    await expect(createOutreachExperience({
      db,
      appId: 'app-1',
      name: 'Clone demo',
      provisioningMode: 'clone_per_lead',
      templateWorkspaceId: null,
      defaultTargetPath: '/',
      createdBy: 'admin-user',
    })).rejects.toMatchObject({
      status: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
    })
    expect(db.select).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })
})
