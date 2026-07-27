import { describe, expect, it } from 'vitest'

import type { AgentCliErrorV1 } from '../index'
import { ErrorCode } from '../error-codes'

describe('AgentCliErrorV1', () => {
  it('captures the versioned CLI JSON failure envelope as shared type-only API', () => {
    const payload: AgentCliErrorV1 = {
      schemaVersion: 1,
      ok: false,
      error: {
        code: ErrorCode.enum.AUTHORED_AGENT_ID_INVALID,
        field: 'definitionId',
        message: 'definitionId must match ^[a-z][a-z0-9-]{0,62}$',
      },
    }

    expect(payload).toEqual({
      schemaVersion: 1,
      ok: false,
      error: {
        code: ErrorCode.enum.AUTHORED_AGENT_ID_INVALID,
        field: 'definitionId',
        message: 'definitionId must match ^[a-z][a-z0-9-]{0,62}$',
      },
    })
  })

  it('can carry stable legacy-reference migration diagnostics without special formatting', () => {
    const payload: AgentCliErrorV1 = {
      schemaVersion: 1,
      ok: false,
      error: {
        code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
        field: 'toolRefs',
        message: 'toolRefs cannot select behavior; configure trusted host plugins instead',
      },
    }

    expect(payload.error).toEqual({
      code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
      field: 'toolRefs',
      message: 'toolRefs cannot select behavior; configure trusted host plugins instead',
    })
  })
})
