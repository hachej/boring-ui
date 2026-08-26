import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES } from '../../shared/errors.js'
import {
  DefaultAgentTypeError,
  LEGACY_DEFAULT_AGENT_TYPE_ID,
  classifyWorkspaceDefaultAgentTypeCohorts,
  isAgentTypeId,
  parseRequiredDefaultAgentTypeId,
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

describe('parseRequiredDefaultAgentTypeId', () => {
  it('rejects omitted and NULL production identities with a stable code', () => {
    for (const value of [undefined, null]) {
      expect(() => parseRequiredDefaultAgentTypeId(value)).toThrowError(expect.objectContaining({
        code: ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID,
      }))
    }
  })
})

describe('resolveWorkspaceDefaultAgentTypeId', () => {
  const fleet = ['default', 'boring-v2', 'reviewer']

  it('prefers the persisted seat when it names a validated fleet member', () => {
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: 'reviewer',
      applicationDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
    })).toBe('reviewer')
  })

  it('uses the validated application default when nothing is persisted', () => {
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: null,
      applicationDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
    })).toBe('boring-v2')
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: undefined,
      applicationDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
    })).toBe('boring-v2')
  })

  it('does not re-resolve the already-validated application default', () => {
    expect(resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: null,
      applicationDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
    })).toBe('boring-v2')
  })

  it('fails stably without fallback when the persisted seat is unknown', () => {
    const onUnknownPersistedSeat = vi.fn()
    expect(() => resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: 'retired-seat',
      applicationDefaultAgentTypeId: 'boring-v2',
      availableAgentTypeIds: fleet,
      onUnknownPersistedSeat,
    })).toThrowError(expect.objectContaining({
      code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
      name: 'DefaultAgentTypeError',
    }))
    expect(onUnknownPersistedSeat).toHaveBeenCalledWith({
      code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
      persistedDefaultAgentTypeId: 'retired-seat',
    })
  })

  it('does not reinterpret an unknown persisted seat as the legacy default', () => {
    expect(() => resolveWorkspaceDefaultAgentTypeId({
      persistedDefaultAgentTypeId: 'retired-seat',
      applicationDefaultAgentTypeId: LEGACY_DEFAULT_AGENT_TYPE_ID,
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
      configuredDefaultAgentTypeId: undefined,
      availableAgentTypeIds: ['default'],
    })).toBe('default')
    expect(() => resolveApplicationDefaultAgentTypeId({
      configuredDefaultAgentTypeId: 'retired-seat',
      availableAgentTypeIds: ['default'],
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT }))
    expect(() => resolveApplicationDefaultAgentTypeId({
      configuredDefaultAgentTypeId: undefined,
      availableAgentTypeIds: [],
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT }))
  })

  it('validates canonical fleet identity grammar and uniqueness before resolution', () => {
    for (const availableAgentTypeIds of [
      ['Default'],
      ['seat_name'],
      [`a${'0'.repeat(63)}`],
      ['default', 'default'],
    ]) {
      expect(() => resolveApplicationDefaultAgentTypeId({
        configuredDefaultAgentTypeId: undefined,
        availableAgentTypeIds,
      })).toThrowError(expect.objectContaining({
        name: 'DefaultAgentTypeError',
        code: ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID,
      }))
    }
  })

  it('distinguishes a malformed configured identity from a valid unavailable seat', () => {
    expect(() => resolveApplicationDefaultAgentTypeId({
      configuredDefaultAgentTypeId: 'Bad_Seat',
      availableAgentTypeIds: ['default'],
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID }))
    expect(() => resolveApplicationDefaultAgentTypeId({
      configuredDefaultAgentTypeId: 'retired-seat',
      availableAgentTypeIds: ['default'],
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT }))
  })

  it('keeps validation and resolution failures transport-neutral', () => {
    const actions = [
      () => parseTrustedDefaultAgentTypeId('Default'),
      () => resolveApplicationDefaultAgentTypeId({
        configuredDefaultAgentTypeId: 'retired-seat',
        availableAgentTypeIds: ['default'],
      }),
      () => resolveWorkspaceDefaultAgentTypeId({
        persistedDefaultAgentTypeId: 'retired-seat',
        applicationDefaultAgentTypeId: 'default',
        availableAgentTypeIds: ['default'],
      }),
    ]

    for (const action of actions) {
      expect(action).toThrowError(DefaultAgentTypeError)
      try {
        action()
      } catch (error) {
        expect(error).not.toHaveProperty('status')
        expect(error).not.toHaveProperty('statusCode')
      }
    }
  })
})
