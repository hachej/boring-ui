import { describe, expect, test } from 'vitest'

import { assertProductionAgentModeIsSafe } from './productionSafety'

describe('Blaxel production safety gate', () => {
  test('remains blocked until the separate production security decision', () => {
    expect(() => assertProductionAgentModeIsSafe({
      NODE_ENV: 'production',
      BORING_AGENT_MODE: 'blaxel',
    })).toThrow(/not allowed in production/)
  })

  test('allows the explicit unsafe override for qualification deployments', () => {
    expect(() => assertProductionAgentModeIsSafe({
      NODE_ENV: 'production',
      BORING_AGENT_MODE: 'blaxel',
      BORING_ALLOW_UNSAFE_AGENT_MODE: '1',
    })).not.toThrow()
  })
})
