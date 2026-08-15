import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES } from '../../shared/errors.js'
import {
  LEGACY_DEFAULT_AGENT_TYPE_ID,
  classifyWorkspaceDefaultAgentTypeCohorts,
  isAgentTypeId,
  parseTrustedDefaultAgentTypeId,
  resolveApplicationDefaultAgentTypeId,
  resolveWorkspaceDefaultAgentTypeId,
} from '../defaultAgentType.js'

describe('parseTrustedDefaultAgentTypeId', () => {
  it('maps absent values to null (no persisted default)', () => {
    expect(parseTrustedDefaultAgentTypeId(undefined)).toBeNull()
    expect(parseTrustedDefaultAgentTypeId(null)).toBeNull()
  })

  it('accepts the slug grammar and rejects everything else with a stable code', () => {
    expect(parseTrustedDefaultAgentTypeId('boring-v2')).toBe('boring-v2')
    expect(parseTrustedDefaultAgentTypeId('a')).toBe('a')
    for (const invalid of ['', 'Default', '-seat', '0seat', 'seat_a', `a${'0'.repeat(63)}`, 42]) {
      expect(() => parseTrustedDefaultAgentTypeId(invalid)).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID }),
      )
    }
  })

  it('exposes the grammar predicate', () => {
    expect(isAgentTypeId('boring-v2')).toBe(true)
    expect(isAgentTypeId('Boring')).toBe(false)
  })
})

describe('resolveWorkspaceDefaultAgentTypeId', () => {
  const fleet = ['default', 'boring-v2', 'reviewer']

  it('prefers the persisted seat when it names a validated fleet member', () => {
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: 'reviewer',
      bootDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
    })).toBe('reviewer')
  })

  it('falls back to the boot option when nothing is persisted', () => {
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: null,
      bootDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
    })).toBe('boring-v2')
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: undefined,
      bootDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
    })).toBe('boring-v2')
  })

  it('falls back to the first fleet seat and rejects an empty fleet', () => {
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: null,
      bootDefaultAgentTypeId: undefined,
      availableAgentTypeIds: fleet,
    })).toBe('default')
    expect(() => resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: null,
      bootDefaultAgentTypeId: undefined,
      availableAgentTypeIds: [],
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT }))
  })

  it('fails stably without fallback when the persisted seat is unknown', () => {
    const onUnknownPersistedSeat = vi.fn()
    expect(() => resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: 'retired-seat',
      bootDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
      onUnknownPersistedSeat,
    })).toThrowError(expect.objectContaining({
      code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
      status: 409,
    }))
    expect(onUnknownPersistedSeat).toHaveBeenCalledWith({
      code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
      persistedDefaultAgentTypeId: 'retired-seat',
    })
  })

  it('does not reinterpret an unknown persisted seat as the legacy default', () => {
    expect(() => resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: 'retired-seat',
      bootDefaultAgentTypeId: undefined,
      availableAgentTypeIds: [LEGACY_DEFAULT_AGENT_TYPE_ID],
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT }))
  })
})

describe('legacy default-Agent cohorts', () => {
  it('classifies NULL, known, and unknown persisted cohorts without repair', () => {
    expect(classifyWorkspaceDefaultAgentTypeCohorts([
      { defaultAgentTypeId: null, count: 3 },
      { defaultAgentTypeId: 'default', count: 4 },
      { defaultAgentTypeId: 'retired-seat', count: 2 },
    ], ['default'])).toEqual({
      nullCount: 3,
      knownCount: 4,
      unknown: [{ defaultAgentTypeId: 'retired-seat', count: 2 }],
    })
  })

  it('requires the application default to be a current fleet member', () => {
    expect(resolveApplicationDefaultAgentTypeId({
      bootDefaultAgentTypeId: undefined,
      availableAgentTypeIds: ['default'],
    })).toBe('default')
    expect(() => resolveApplicationDefaultAgentTypeId({
      bootDefaultAgentTypeId: 'retired-seat',
      availableAgentTypeIds: ['default'],
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT }))
  })
})
