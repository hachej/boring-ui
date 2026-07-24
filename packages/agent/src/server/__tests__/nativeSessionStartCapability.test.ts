import { describe, expect, test } from 'vitest'
import { nativeSessionStartEnabledForRuntime } from '../nativeSessionStartCapability'

describe('nativeSessionStartEnabledForRuntime', () => {
  test.each(['direct', 'local'] as const)('enables native Pi sessions for the single-user %s runtime', (runtimeMode) => {
    expect(nativeSessionStartEnabledForRuntime(runtimeMode)).toBe(true)
  })

  test.each(['vercel-sandbox', 'remote-worker', 'tenant-runtime'])('keeps app-host native Pi sessions disabled for %s', (runtimeMode) => {
    expect(nativeSessionStartEnabledForRuntime(runtimeMode)).toBe(false)
  })
})
