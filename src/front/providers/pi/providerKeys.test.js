import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockProviderKeys = {
  list: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}

const mockGetPiRuntime = vi.fn(() => ({
  providerKeys: mockProviderKeys,
}))

vi.mock('./runtime', () => ({
  getPiRuntime: (...args) => mockGetPiRuntime(...args),
}))

const {
  listPiProviderKeyStatus,
  maskPiProviderKey,
  removePiProviderKey,
  resolvePiProviderKeyScope,
  setPiProviderKey,
} = await import('./providerKeys')

describe('providerKeys helpers', () => {
  beforeEach(() => {
    mockGetPiRuntime.mockClear()
    mockProviderKeys.list.mockReset()
    mockProviderKeys.get.mockReset()
    mockProviderKeys.set.mockReset()
    mockProviderKeys.delete.mockReset()
    window.localStorage.clear()
  })

  it('masks short keys conservatively', () => {
    expect(maskPiProviderKey('abcd')).toBe('••••')
    expect(maskPiProviderKey('abcdefghi')).toBe('ab...hi')
    expect(maskPiProviderKey('sk-ant-api-key-1234')).toBe('sk-a...1234')
  })

  it('creates and reuses a stable anonymous scope id', () => {
    const first = resolvePiProviderKeyScope('')
    const second = resolvePiProviderKeyScope('')

    expect(first).toMatch(/^anon-/)
    expect(second).toBe(first)
  })

  it('uses explicit user scope when provided', () => {
    expect(resolvePiProviderKeyScope('user-123')).toBe('user-123')
  })

  it('lists known providers first and reports saved key status', async () => {
    mockProviderKeys.list.mockResolvedValue(['custom-provider', 'anthropic'])
    mockProviderKeys.get.mockImplementation(async (provider) => {
      if (provider === 'anthropic') return 'sk-ant-api-key-1234'
      if (provider === 'custom-provider') return 'custom-secret-9876'
      return null
    })

    const providers = await listPiProviderKeyStatus('scope:user-123')

    expect(mockGetPiRuntime).toHaveBeenCalledWith('scope:user-123')
    expect(providers.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'google',
      'custom-provider',
    ])
    expect(providers[0]).toMatchObject({ hasKey: true, maskedKey: 'sk-a...1234' })
    expect(providers[3]).toMatchObject({ label: 'Custom Provider', hasKey: true })
  })

  it('saves and removes provider keys in the resolved scope', async () => {
    await setPiProviderKey('', 'anthropic', 'sk-ant-api-key-1234')
    await removePiProviderKey('', 'anthropic')

    const resolvedScope = resolvePiProviderKeyScope('')
    expect(mockGetPiRuntime).toHaveBeenNthCalledWith(1, resolvedScope)
    expect(mockProviderKeys.set).toHaveBeenCalledWith('anthropic', 'sk-ant-api-key-1234')
    expect(mockGetPiRuntime).toHaveBeenNthCalledWith(2, resolvedScope)
    expect(mockProviderKeys.delete).toHaveBeenCalledWith('anthropic')
  })
})
