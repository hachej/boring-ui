import { describe, it, expect } from 'vitest'
import { withBeadId } from '../server/__tests__/_setup'

describe('@boring/core scaffold', () => {
  it(
    'vitest is wired',
    withBeadId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      assertionPassed('vitest-wired')
      expect(true).toBe(true)
    }),
  )
})
