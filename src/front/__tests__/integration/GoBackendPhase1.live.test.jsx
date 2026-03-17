import { describe, it } from 'vitest'

if (process.env.BD16_LIVE_GO_BACKEND === '1') {
  await import('./GoBackendPhase1.integration.test.jsx')
} else {
  describe.skip('Go backend phase-1 live integration', () => {
    it('requires BD16_LIVE_GO_BACKEND=1', () => {})
  })
}
