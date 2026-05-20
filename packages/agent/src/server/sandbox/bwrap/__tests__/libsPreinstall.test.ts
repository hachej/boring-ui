import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import {
  parsePackagesEnv,
  buildVenvBwrapArgs,
  buildVenvEnv,
  ensureTier1Venv,
  ensureTier2Venv,
} from '../libsPreinstall'
import { restoreEnvForTest, setEnvForTest } from '../../../config/env'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parsePackagesEnv', () => {
  test('returns empty array for undefined', () => {
    expect(parsePackagesEnv(undefined)).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(parsePackagesEnv('')).toEqual([])
  })

  test('returns empty array for whitespace-only', () => {
    expect(parsePackagesEnv('   ')).toEqual([])
  })

  test('parses comma-separated packages', () => {
    expect(parsePackagesEnv('pandas,numpy,scipy')).toEqual(['pandas', 'numpy', 'scipy'])
  })

  test('trims whitespace around packages', () => {
    expect(parsePackagesEnv(' pandas , numpy , scipy ')).toEqual(['pandas', 'numpy', 'scipy'])
  })

  test('filters out empty segments', () => {
    expect(parsePackagesEnv('pandas,,numpy,,,')).toEqual(['pandas', 'numpy'])
  })

  test('handles single package', () => {
    expect(parsePackagesEnv('pandas')).toEqual(['pandas'])
  })
})

describe('buildVenvBwrapArgs', () => {
  test('returns empty array when no tier1 path', () => {
    expect(buildVenvBwrapArgs(null)).toEqual([])
  })

  test('returns ro-bind args for tier1 path', () => {
    const args = buildVenvBwrapArgs('/var/cache/boring-agent/venvs/abc123')
    expect(args).toEqual([
      '--ro-bind',
      '/var/cache/boring-agent/venvs/abc123',
      '/opt/venv',
    ])
  })
})

describe('buildVenvEnv', () => {
  test('includes tier2 bin in PATH without tier1', () => {
    const env = buildVenvEnv(null, '/workspace')
    expect(env.PATH).toContain('/workspace/.boring-agent/venv/bin')
    expect(env.VIRTUAL_ENV).toBe('/workspace/.boring-agent/venv')
  })

  test('includes both tier1 and tier2 bins when tier1 present', () => {
    const env = buildVenvEnv('/var/cache/boring-agent/venvs/abc', '/workspace')
    expect(env.PATH).toContain('/workspace/.boring-agent/venv/bin')
    expect(env.PATH).toContain('/opt/venv/bin')
  })

  test('tier2 bin comes before tier1 bin in PATH', () => {
    const env = buildVenvEnv('/some/path', '/workspace')
    const parts = env.PATH.split(':')
    const tier2Idx = parts.indexOf('/workspace/.boring-agent/venv/bin')
    const tier1Idx = parts.indexOf('/opt/venv/bin')
    expect(tier2Idx).toBeLessThan(tier1Idx)
  })

  test('appends host PATH through config env seam', () => {
    const previous = setEnvForTest('PATH', '/usr/local/bin:/usr/bin')
    try {
      const env = buildVenvEnv(null, '/workspace')
      expect(env.PATH).toBe('/workspace/.boring-agent/venv/bin:/usr/local/bin:/usr/bin')
    } finally {
      restoreEnvForTest('PATH', previous)
    }
  })

  test('omits host PATH segment when PATH is unset', () => {
    const previous = setEnvForTest('PATH', undefined)
    try {
      const env = buildVenvEnv('/some/path', '/workspace')
      expect(env.PATH).toBe('/workspace/.boring-agent/venv/bin:/opt/venv/bin')
    } finally {
      restoreEnvForTest('PATH', previous)
    }
  })

  test('filters old top-level .venv from host PATH', () => {
    const previous = setEnvForTest('PATH', '/workspace/.venv/bin:/usr/bin')
    try {
      const env = buildVenvEnv(null, '/workspace')
      expect(env.PATH).toBe('/workspace/.boring-agent/venv/bin:/usr/bin')
    } finally {
      restoreEnvForTest('PATH', previous)
    }
  })

  test('sets VIRTUAL_ENV to workspace .boring-agent/venv', () => {
    const env = buildVenvEnv('/some/path', '/workspace')
    expect(env.VIRTUAL_ENV).toBe('/workspace/.boring-agent/venv')
  })
})

describe('ensureTier1Venv', () => {
  test('returns null when no packages configured', () => {
    const result = ensureTier1Venv([])
    expect(result).toBeNull()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  test('returns /opt/venv when Dockerfile-built venv exists', () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === '/opt/venv/bin/python3',
    )
    const result = ensureTier1Venv(['pandas'])
    expect(result).toBe('/opt/venv')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  test('returns cached path when cache hit', () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p)
      return s !== '/opt/venv/bin/python3' && s.endsWith('/bin/python3')
    })
    const result = ensureTier1Venv(['pandas'])
    expect(result).toMatch(/^\/var\/cache\/boring-agent\/venvs\//)
    expect(execFileSync).not.toHaveBeenCalled()
  })

  test('installs with pip when uv not available and no cache', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(execFileSync).mockImplementation((cmd) => {
      if (cmd === 'uv') throw new Error('not found')
      return Buffer.from('')
    })

    const result = ensureTier1Venv(['pandas', 'numpy'])

    expect(result).toMatch(/^\/var\/cache\/boring-agent\/venvs\//)
    expect(mkdirSync).toHaveBeenCalledWith(
      '/var/cache/boring-agent/venvs',
      { recursive: true },
    )
    const calls = vi.mocked(execFileSync).mock.calls
    const python3Call = calls.find((c) => c[0] === 'python3')
    expect(python3Call).toBeDefined()
    expect(python3Call![1]).toContain('-m')
    expect(python3Call![1]).toContain('venv')
  })

  test('installs with uv when available and no cache', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

    const result = ensureTier1Venv(['pandas'])

    expect(result).toMatch(/^\/var\/cache\/boring-agent\/venvs\//)
    const calls = vi.mocked(execFileSync).mock.calls
    const uvCalls = calls.filter((c) => c[0] === 'uv')
    expect(uvCalls.length).toBeGreaterThanOrEqual(2)
  })

  test('same packages in different order produce same cache path', () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p)
      return s !== '/opt/venv/bin/python3' && s.endsWith('/bin/python3')
    })
    const result1 = ensureTier1Venv(['numpy', 'pandas', 'scipy'])
    const result2 = ensureTier1Venv(['scipy', 'pandas', 'numpy'])
    expect(result1).toBe(result2)
  })
})

describe('ensureTier2Venv', () => {
  test('returns existing venv path when already created', () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === '/workspace/.boring-agent/venv/bin/python3',
    )
    const result = ensureTier2Venv('/workspace', null)
    expect(result).toBe('/workspace/.boring-agent/venv')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  test('creates venv without system-site-packages when no tier1', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

    ensureTier2Venv('/workspace', null)

    expect(execFileSync).toHaveBeenCalledWith(
      'python3',
      ['-m', 'venv', '/workspace/.boring-agent/venv'],
      expect.any(Object),
    )
    expect(writeFileSync).toHaveBeenCalledWith(
      '/workspace/.boring-agent/venv/.boring-agent-owned.json',
      expect.stringContaining('@hachej/boring-agent'),
      'utf8',
    )
  })

  test('creates venv with system-site-packages when tier1 present', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

    ensureTier2Venv('/workspace', '/opt/venv')

    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/venv/bin/python3',
      ['-m', 'venv', '/workspace/.boring-agent/venv', '--system-site-packages'],
      expect.any(Object),
    )
  })
})
