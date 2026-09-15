import { describe, expect, it } from 'vitest'

import { formatElapsed } from '../ActivityStrip'

describe('formatElapsed', () => {
  it('keeps short and long waits plain', () => {
    const start = Date.parse('2026-09-15T12:00:00.000Z')
    expect(formatElapsed(start, start + 20_000)).toBe('<1 min')
    expect(formatElapsed(start, start + 3 * 60_000)).toBe('3 min')
    expect(formatElapsed(start, start + 62 * 60_000)).toBe('1 hr 2 min')
  })
})
