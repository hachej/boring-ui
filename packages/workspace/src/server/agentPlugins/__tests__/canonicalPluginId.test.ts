import { describe, expect, it } from 'vitest'
import {
  CANONICAL_PLUGIN_ID_ERROR_CODE,
  assertCanonicalPluginId,
} from '../canonicalPluginId'

describe('canonical plugin ID preflight', () => {
  it('requires package manifest, front, and server IDs to agree', () => {
    expect(assertCanonicalPluginId({
      packageJson: { name: 'package-name', boring: { id: 'macro' } },
      frontId: 'macro',
      serverId: 'macro',
    })).toBe('macro')

    for (const input of [
      { packageJson: { name: 'package-name', boring: { id: 'macro' } }, frontId: 'other', serverId: 'macro' },
      { packageJson: { name: 'package-name', boring: { id: 'macro' } }, frontId: 'macro', serverId: 'other' },
    ]) {
      expect(() => assertCanonicalPluginId(input)).toThrow(expect.objectContaining({
        code: CANONICAL_PLUGIN_ID_ERROR_CODE,
      }))
    }
  })

  it('falls back to package name when boring.id is omitted', () => {
    expect(assertCanonicalPluginId({
      packageJson: { name: 'package-name' },
      frontId: 'package-name',
      serverId: 'package-name',
    })).toBe('package-name')
  })

  it('fails before callers can collect any contribution', () => {
    const collected: string[] = []
    expect(() => {
      const id = assertCanonicalPluginId({
        packageJson: { name: 'package-name', boring: { id: 'canonical' } },
        serverId: 'mismatch',
      })
      collected.push(id)
    }).toThrow()
    expect(collected).toEqual([])
  })
})
