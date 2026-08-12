import { describe, expect, test } from 'vitest'

import { assertProductionAgentModeIsSafe } from './productionSafety'

describe('Blaxel production safety gate', () => {
  test('allows the approved Blaxel production mode without an unsafe override', () => {
    expect(() => assertProductionAgentModeIsSafe({
      NODE_ENV: 'production',
      BORING_AGENT_MODE: 'blaxel',
    })).not.toThrow()
  })
})
