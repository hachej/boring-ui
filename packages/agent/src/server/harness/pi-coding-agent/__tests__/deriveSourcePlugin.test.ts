import { describe, expect, it } from 'vitest'

import { deriveSourcePlugin } from '../createHarness'

describe('deriveSourcePlugin', () => {
  it('tags provisioned plugin skills with the owning plugin id', () => {
    expect(deriveSourcePlugin({
      path: '/workspace/.boring-agent/skills/simple-counter/open-simple-counter/SKILL.md',
      source: 'workspace',
      scope: 'project',
      origin: 'top-level',
    })).toBe('simple-counter')
  })
})
