import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useDataProviderScope from '../../hooks/useDataProviderScope'
import {
  createHttpProvider,
  createLightningDataProvider,
  createQueryClient,
  getDataProvider,
  getDataProviderFactory,
} from '../../providers/data'

vi.mock('../../providers/data', () => ({
  createQueryClient: vi.fn(),
  getDataProvider: vi.fn(),
  getDataProviderFactory: vi.fn(),
  createHttpProvider: vi.fn(),
  createLightningDataProvider: vi.fn(),
}))

vi.mock('../../utils/frontendState', () => ({
  getFrontendStateClientId: vi.fn((prefix) => `client-${prefix}`),
}))

const makeProps = (overrides = {}) => ({
  config: { data: { backend: 'http', strictBackend: false, lightningfs: { name: 'boring-fs' } } },
  storagePrefix: 'boring-ui',
  currentWorkspaceId: 'ws-1',
  menuUserId: '',
  menuUserEmail: '',
  userMenuAuthStatus: 'authenticated',
  ...overrides,
})

describe('useDataProviderScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createQueryClient.mockImplementation(() => ({ clear: vi.fn() }))
    createHttpProvider.mockImplementation(({ workspaceId }) => ({ kind: 'http', workspaceId }))
    createLightningDataProvider.mockImplementation(({ fsName }) => ({ kind: 'lightningfs', fsName }))
    getDataProvider.mockReturnValue(null)
    getDataProviderFactory.mockReturnValue(null)
  })

  it('uses an injected provider when one is already registered', () => {
    const injectedProvider = { kind: 'injected' }
    getDataProvider.mockReturnValue(injectedProvider)

    const { result } = renderHook(() => useDataProviderScope(makeProps()))

    expect(result.current.dataProvider).toBe(injectedProvider)
    expect(createHttpProvider).not.toHaveBeenCalled()
    expect(createLightningDataProvider).not.toHaveBeenCalled()
  })

  it('creates an http provider for the default backend', () => {
    const { result } = renderHook(() => useDataProviderScope(makeProps()))

    expect(result.current.configuredDataBackend).toBe('http')
    expect(result.current.dataProviderScopeKey).toBe('backend:http')
    expect(createHttpProvider).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(result.current.dataProvider).toEqual({ kind: 'http', workspaceId: 'ws-1' })
  })

  it('reuses cached lightningfs provider and query client for the same scope', () => {
    const props = makeProps({
      config: { data: { backend: 'lightningfs', lightningfs: { name: 'browser-fs' } } },
      menuUserId: 'user-1',
    })

    const { result, rerender } = renderHook((hookProps) => useDataProviderScope(hookProps), {
      initialProps: props,
    })
    const firstProvider = result.current.dataProvider
    const firstQueryClient = result.current.queryClient

    rerender(props)

    expect(createLightningDataProvider).toHaveBeenCalledTimes(1)
    expect(createQueryClient).toHaveBeenCalledTimes(1)
    expect(result.current.dataProvider).toBe(firstProvider)
    expect(result.current.queryClient).toBe(firstQueryClient)
  })

  it('clears stale lightningfs query clients when the user scope changes', () => {
    const props = makeProps({
      config: { data: { backend: 'lightningfs', lightningfs: { name: 'browser-fs' } } },
      menuUserId: 'user-1',
    })

    const { result, rerender } = renderHook((hookProps) => useDataProviderScope(hookProps), {
      initialProps: props,
    })
    const firstQueryClient = result.current.queryClient

    act(() => {
      rerender({ ...props, menuUserId: 'user-2' })
    })

    expect(createLightningDataProvider).toHaveBeenCalledTimes(2)
    expect(createQueryClient).toHaveBeenCalledTimes(2)
    expect(firstQueryClient.clear).toHaveBeenCalledTimes(1)
  })

  it('falls back to http for unknown backends when strict mode is disabled', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useDataProviderScope(makeProps({
      config: { data: { backend: 'custom-backend', strictBackend: false } },
    })))

    expect(createHttpProvider).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(result.current.dataProvider).toEqual({ kind: 'http', workspaceId: 'ws-1' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[DataProvider] Unknown configured backend "custom-backend", falling back to http',
    )

    warnSpy.mockRestore()
  })

  it('throws for unknown backends when strict mode is enabled', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useDataProviderScope(makeProps({
      config: { data: { backend: 'custom-backend', strictBackend: true } },
    })))).toThrow(
      '[DataProvider] Unknown configured backend "custom-backend" (strict mode enabled)',
    )

    consoleErrorSpy.mockRestore()
  })
})
