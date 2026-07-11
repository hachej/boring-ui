import { describe, expect, it } from 'vitest'

import {
  BUILTIN_MODE_TO_PROVIDER,
  autoDetectRuntimeMode,
  isBuiltinRuntimeModeId,
  isRuntimeModeId,
  providerForRuntimeMode,
} from '../runtimeModeSelection'

describe('runtime mode selection', () => {
  it('derives built-in provider ids from the authoritative mode map', () => {
    expect(BUILTIN_MODE_TO_PROVIDER).toEqual({
      direct: 'direct',
      local: 'bwrap',
      'vercel-sandbox': 'vercel-sandbox',
    })
    expect(providerForRuntimeMode('remote-worker')).toBe('remote-worker')
  })

  it('keeps remote-worker a known runtime mode but not an agent built-in', () => {
    expect(isRuntimeModeId('remote-worker')).toBe(true)
    expect(isBuiltinRuntimeModeId('remote-worker')).toBe(false)
  })

  it('validates explicit built-in mode overrides', () => {
    expect(autoDetectRuntimeMode({ explicitMode: 'local' })).toBe('local')
    expect(() => autoDetectRuntimeMode({ explicitMode: 'remote-worker' })).toThrow(
      'Invalid BORING_AGENT_MODE "remote-worker". Expected direct, local, vercel-sandbox.',
    )
    expect(() => autoDetectRuntimeMode({ explicitMode: '   ' })).toThrow(
      'Invalid BORING_AGENT_MODE "   ". Expected direct, local, vercel-sandbox.',
    )
  })

  it('auto-detects local only when linux has bubblewrap', () => {
    expect(autoDetectRuntimeMode({ platform: 'linux', hasBwrap: () => true })).toBe('local')
    expect(autoDetectRuntimeMode({ platform: 'linux', hasBwrap: () => false })).toBe('direct')
    expect(autoDetectRuntimeMode({ platform: 'darwin', hasBwrap: () => true })).toBe('direct')
  })
})
