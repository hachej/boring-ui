import { describe, expect, it } from 'vitest'

import { safeRandomUUID } from '../random-id'

describe('safeRandomUUID', () => {
  it('uses crypto.randomUUID when available (secure context)', () => {
    const id = safeRandomUUID()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('falls back to getRandomValues when randomUUID is missing (insecure context)', () => {
    const originalRandomUUID = globalThis.crypto.randomUUID
    // @ts-expect-error - simulating an insecure-context Crypto object, which
    // lacks randomUUID but still exposes getRandomValues.
    delete globalThis.crypto.randomUUID
    try {
      const id = safeRandomUUID()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    } finally {
      globalThis.crypto.randomUUID = originalRandomUUID
    }
  })

  it('throws when no Web Crypto is available at all', () => {
    const originalCrypto = globalThis.crypto
    delete (globalThis as { crypto?: Crypto }).crypto
    try {
      expect(() => safeRandomUUID()).toThrow(
        'Secure random UUID generation requires crypto.getRandomValues()',
      )
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true, writable: true })
    }
  })
})
