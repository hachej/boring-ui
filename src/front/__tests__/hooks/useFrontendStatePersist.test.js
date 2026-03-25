import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useFrontendStatePersist from '../../hooks/useFrontendStatePersist'

vi.mock('../../utils/transport', () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('../../utils/apiBase', () => ({
  buildApiUrl: vi.fn((path) => `http://test${path}`),
}))

vi.mock('../../utils/routes', () => ({
  routes: {
    uiState: {
      upsert: () => ({ path: '/api/v1/ui/state', query: {} }),
      commands: { next: (id) => ({ path: `/api/v1/ui/commands/next`, query: { client_id: id } }) },
    },
  },
}))

vi.mock('../../utils/frontendState', () => ({
  collectFrontendStateSnapshot: vi.fn(() => ({ panes: [], client_id: 'test' })),
  getFrontendStateClientId: vi.fn((prefix) => `client-${prefix}`),
}))

describe('useFrontendStatePersist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns publish function and refs', () => {
    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: true, storagePrefix: 'test' }),
    )
    expect(typeof result.current.publish).toBe('function')
    expect(result.current.clientIdRef).toBeDefined()
    expect(result.current.unavailableRef).toBeDefined()
  })

  it('initializes clientIdRef from storagePrefix', () => {
    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: true, storagePrefix: 'myapp' }),
    )
    expect(result.current.clientIdRef.current).toBe('client-myapp')
  })

  it('publish returns false when disabled', async () => {
    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: false, storagePrefix: 'test' }),
    )
    const success = await result.current.publish({ some: 'dockApi' })
    expect(success).toBe(false)
  })

  it('publish returns false when no dockApi', async () => {
    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: true, storagePrefix: 'test' }),
    )
    const success = await result.current.publish(null)
    expect(success).toBe(false)
  })

  it('unavailableRef starts as false', () => {
    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: true, storagePrefix: 'test' }),
    )
    expect(result.current.unavailableRef.current).toBe(false)
  })

  it('publishes the collected snapshot with fetch by default', async () => {
    const { apiFetch } = await import('../../utils/transport')
    const { collectFrontendStateSnapshot } = await import('../../utils/frontendState')
    apiFetch.mockResolvedValueOnce({ ok: true, status: 200 })

    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: true, storagePrefix: 'test' }),
    )

    let success = false
    await act(async () => {
      success = await result.current.publish({ some: 'dockApi' }, { projectRoot: '/workspace' })
    })

    expect(success).toBe(true)
    expect(collectFrontendStateSnapshot).toHaveBeenCalledWith(
      { some: 'dockApi' },
      'client-test',
      '/workspace',
    )
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/ui/state', {
      query: {},
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panes: [], client_id: 'test' }),
      keepalive: true,
    })
    expect(result.current.unavailableRef.current).toBe(false)
  })

  it('uses sendBeacon when requested', async () => {
    const sendBeacon = vi.fn(() => true)
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })

    const { buildApiUrl } = await import('../../utils/apiBase')
    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: true, storagePrefix: 'test' }),
    )

    let success = false
    await act(async () => {
      success = await result.current.publish({ some: 'dockApi' }, {
        transport: 'beacon',
        projectRoot: '/workspace',
      })
    })

    expect(success).toBe(true)
    expect(buildApiUrl).toHaveBeenCalledWith('/api/v1/ui/state', {})
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    expect(sendBeacon).toHaveBeenCalledWith(
      'http://test/api/v1/ui/state',
      expect.any(Blob),
    )
  })

  it('marks the endpoint unavailable after a 404 and only retries when forced', async () => {
    const { apiFetch } = await import('../../utils/transport')
    apiFetch
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const { result } = renderHook(() =>
      useFrontendStatePersist({ enabled: true, storagePrefix: 'test' }),
    )

    await act(async () => {
      await result.current.publish({ some: 'dockApi' })
    })

    expect(result.current.unavailableRef.current).toBe(true)
    expect(apiFetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.publish({ some: 'dockApi' })
    })

    expect(apiFetch).toHaveBeenCalledTimes(1)

    let forcedSuccess = false
    await act(async () => {
      forcedSuccess = await result.current.publish({ some: 'dockApi' }, { force: true })
    })

    expect(forcedSuccess).toBe(true)
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(result.current.unavailableRef.current).toBe(false)
  })

  it('resets the client id and availability flag when the storage prefix changes', () => {
    const { result, rerender } = renderHook(
      ({ storagePrefix }) => useFrontendStatePersist({ enabled: true, storagePrefix }),
      { initialProps: { storagePrefix: 'first' } },
    )

    result.current.unavailableRef.current = true
    rerender({ storagePrefix: 'second' })

    expect(result.current.clientIdRef.current).toBe('client-second')
    expect(result.current.unavailableRef.current).toBe(false)
  })
})
