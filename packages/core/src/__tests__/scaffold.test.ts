import { describe, it, expect } from 'vitest'
import { withTaskId } from '../server/__tests__/_setup'

describe('@hachej/boring-core scaffold', () => {
  it(
    'vitest is wired',
    withTaskId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      assertionPassed('vitest-wired')
      expect(true).toBe(true)
    }),
  )
})
