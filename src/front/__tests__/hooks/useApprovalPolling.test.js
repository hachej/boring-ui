import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useApprovalPolling from '../../hooks/useApprovalPolling'

// Mock transport
vi.mock('../../utils/transport', () => ({
  apiFetchJson: vi.fn().mockResolvedValue({ data: { requests: [] } }),
  apiFetch: vi.fn().mockResolvedValue({}),
}))

// Mock routes
vi.mock('../../utils/routes', () => ({
  default: {
    approval: {
      pending: () => ({ path: '/api/approval/pending', query: {} }),
      decision: () => ({ path: '/api/approval/decision', query: {} }),
    },
  },
}))

describe('useApprovalPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns empty approvals when disabled', () => {
    const { result } = renderHook(() =>
      useApprovalPolling({ enabled: false }),
    )
    expect(result.current.approvals).toEqual([])
    expect(result.current.approvalsLoaded).toBe(true)
  })

  it('returns handler functions', () => {
    const { result } = renderHook(() =>
      useApprovalPolling({ enabled: false }),
    )
    expect(typeof result.current.handleDecision).toBe('function')
    expect(typeof result.current.normalizeApprovalPath).toBe('function')
    expect(typeof result.current.getReviewTitle).toBe('function')
  })

  it('normalizeApprovalPath strips project root', () => {
    const { result } = renderHook(() =>
      useApprovalPolling({ enabled: false, projectRoot: '/workspace' }),
    )
    const path = result.current.normalizeApprovalPath({
      file_path: '/workspace/src/main.ts',
    })
    expect(path).toBe('src/main.ts')
  })

  it('normalizeApprovalPath returns project_path if present', () => {
    const { result } = renderHook(() =>
      useApprovalPolling({ enabled: false }),
    )
    const path = result.current.normalizeApprovalPath({
      project_path: 'relative/path.ts',
    })
    expect(path).toBe('relative/path.ts')
  })

  it('getReviewTitle uses tool name when no path', () => {
    const { result } = renderHook(() =>
      useApprovalPolling({ enabled: false }),
    )
    const title = result.current.getReviewTitle({ tool_name: 'exec_bash' })
    expect(title).toBe('Review: exec_bash')
  })

  it('getReviewTitle returns default when no info', () => {
    const { result } = renderHook(() =>
      useApprovalPolling({ enabled: false }),
    )
    expect(result.current.getReviewTitle({})).toBe('Review')
  })

  it('handleDecision removes approval from list', async () => {
    const { apiFetch } = await import('../../utils/transport')
    const { result } = renderHook(() =>
      useApprovalPolling({ enabled: false }),
    )
    await act(async () => {
      await result.current.handleDecision('req-1', 'approve', null, null)
    })
    // After dismissing, the approval should be filtered out on next fetch
    expect(apiFetch).toHaveBeenCalled()
  })
})
