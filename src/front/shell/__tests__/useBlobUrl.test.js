import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBlobUrl } from '../useBlobUrl'

describe('useBlobUrl', () => {
  let mockCreateObjectURL
  let mockRevokeObjectURL

  beforeEach(() => {
    mockCreateObjectURL = vi.fn((file) => `blob:mock-${file.name || 'unnamed'}`)
    mockRevokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = mockCreateObjectURL
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a blob URL string for a file', () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    const { result } = renderHook(() => useBlobUrl(file))

    expect(mockCreateObjectURL).toHaveBeenCalledWith(file)
    expect(result.current).toBe('blob:mock-test.txt')
  })

  it('revokes the blob URL on unmount', () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    const { unmount } = renderHook(() => useBlobUrl(file))

    expect(mockRevokeObjectURL).not.toHaveBeenCalled()
    unmount()
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-test.txt')
  })

  it('revokes the old blob URL when file changes', () => {
    const file1 = new File(['hello'], 'first.txt', { type: 'text/plain' })
    const file2 = new File(['world'], 'second.txt', { type: 'text/plain' })

    const { rerender } = renderHook(({ file }) => useBlobUrl(file), {
      initialProps: { file: file1 },
    })

    expect(mockCreateObjectURL).toHaveBeenCalledWith(file1)
    expect(mockRevokeObjectURL).not.toHaveBeenCalled()

    rerender({ file: file2 })

    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-first.txt')
    expect(mockCreateObjectURL).toHaveBeenCalledWith(file2)
  })

  it('returns null for null file input', () => {
    const { result } = renderHook(() => useBlobUrl(null))

    expect(mockCreateObjectURL).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })
})
