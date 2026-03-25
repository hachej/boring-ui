import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
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
})
