import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock transport before importing the hook
vi.mock('../../utils/transport', () => ({
  apiFetchJson: vi.fn(),
}))

vi.mock('../../utils/routes', () => ({
  routes: {
    capabilities: {
      get: () => ({ path: '/api/capabilities', query: {} }),
    },
  },
}))

import { useCapabilities } from '../../hooks/useCapabilities'
import { apiFetchJson } from '../../utils/transport'

const MOCK_CAPABILITIES = {
  version: '0.1.0',
  features: { files: true, git: true, control_plane: true },
  routers: [],
}

describe('useCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with loading=true on initial fetch', async () => {
    apiFetchJson.mockResolvedValue({
      response: { ok: true },
      data: MOCK_CAPABILITIES,
    })

    const { result } = renderHook(() => useCapabilities())

    // Initial state: loading
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(apiFetchJson).toHaveBeenCalledWith('/api/capabilities', {
      query: {},
      rootScoped: true,
    })
    expect(result.current.capabilities).toEqual(MOCK_CAPABILITIES)
  })

  it('does NOT set loading=true on refetch (prevents workspace bounce)', async () => {
    apiFetchJson.mockResolvedValue({
      response: { ok: true },
      data: MOCK_CAPABILITIES,
    })

    const { result } = renderHook(() => useCapabilities())

    // Wait for initial fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Refetch — loading should NOT flip to true
    const loadingStates = []
    const originalLoading = result.current.loading

    await act(async () => {
      const refetchPromise = result.current.refetch()
      // Capture loading state immediately after refetch starts
      loadingStates.push(result.current.loading)
      await refetchPromise
    })

    // Loading should never have been true during refetch
    expect(loadingStates.every((s) => s === false)).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.capabilities).toEqual(MOCK_CAPABILITIES)
  })

  it('preserves capabilities on refetch error', async () => {
    apiFetchJson
      .mockResolvedValueOnce({
        response: { ok: true },
        data: MOCK_CAPABILITIES,
      })
      .mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useCapabilities())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Refetch with error
    await act(async () => {
      await result.current.refetch()
    })

    // Capabilities preserved from first successful fetch
    expect(result.current.capabilities).toEqual(MOCK_CAPABILITIES)
    expect(result.current.error).toBeTruthy()
  })
})
