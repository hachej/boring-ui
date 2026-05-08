import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFileUpload } from '../useFileUpload'

vi.mock('../DataProvider', () => ({
  useApiBaseUrl: () => 'http://test',
  useWorkspaceRequestId: () => 'ws-1',
}))

vi.mock('@hachej/boring-agent/front', () => ({
  uploadFile: vi.fn(),
}))

import { uploadFile } from '@hachej/boring-agent/front'

const mockUploadFile = vi.mocked(uploadFile)

beforeEach(() => {
  mockUploadFile.mockReset()
})

describe('useFileUpload', () => {
  it('uploading is false initially', () => {
    const { result } = renderHook(() => useFileUpload())
    expect(result.current.uploading).toBe(false)
  })

  it('upload calls the underlying uploadFile with apiBaseUrl and workspaceRequestId', async () => {
    mockUploadFile.mockResolvedValue({ url: 'https://example.com/file.png', path: '/uploads/file.png' })

    const { result } = renderHook(() => useFileUpload())
    const file = new File(['content'], 'file.png', { type: 'image/png' })

    await act(async () => {
      await result.current.upload(file)
    })

    expect(mockUploadFile).toHaveBeenCalledWith(file, {
      apiBaseUrl: 'http://test',
      workspaceRequestId: 'ws-1',
      directory: undefined,
      sourcePath: undefined,
    })
  })

  it('upload passes directory and sourcePath opts through to uploadFile', async () => {
    mockUploadFile.mockResolvedValue({ url: 'https://example.com/file.png', path: '/uploads/dir/file.png' })

    const { result } = renderHook(() => useFileUpload({ directory: 'images' }))
    const file = new File(['content'], 'photo.jpg', { type: 'image/jpeg' })

    await act(async () => {
      await result.current.upload(file, { sourcePath: '/tmp/photo.jpg' })
    })

    expect(mockUploadFile).toHaveBeenCalledWith(file, {
      apiBaseUrl: 'http://test',
      workspaceRequestId: 'ws-1',
      directory: 'images',
      sourcePath: '/tmp/photo.jpg',
    })
  })

  it('per-call directory overrides hook-level directory', async () => {
    mockUploadFile.mockResolvedValue({ url: 'https://example.com/file.png', path: '/uploads/override/file.png' })

    const { result } = renderHook(() => useFileUpload({ directory: 'default-dir' }))
    const file = new File(['content'], 'file.png', { type: 'image/png' })

    await act(async () => {
      await result.current.upload(file, { directory: 'override-dir' })
    })

    expect(mockUploadFile).toHaveBeenCalledWith(file, {
      apiBaseUrl: 'http://test',
      workspaceRequestId: 'ws-1',
      directory: 'override-dir',
      sourcePath: undefined,
    })
  })

  it('uploading is true during upload and false after it resolves', async () => {
    let resolveUpload!: (value: { url: string; path: string }) => void
    mockUploadFile.mockReturnValue(
      new Promise<{ url: string; path: string }>((resolve) => {
        resolveUpload = resolve
      }),
    )

    const { result } = renderHook(() => useFileUpload())
    const file = new File(['x'], 'slow.png', { type: 'image/png' })

    // Start upload but don't await yet.
    let uploadPromise!: Promise<unknown>
    act(() => {
      uploadPromise = result.current.upload(file)
    })

    await waitFor(() => expect(result.current.uploading).toBe(true))

    // Resolve the upload.
    await act(async () => {
      resolveUpload({ url: 'https://example.com/slow.png', path: '/uploads/slow.png' })
      await uploadPromise
    })

    expect(result.current.uploading).toBe(false)
  })

  it('uploading returns to false even when upload rejects', async () => {
    mockUploadFile.mockRejectedValue(new Error('network error'))

    const { result } = renderHook(() => useFileUpload())
    const file = new File(['x'], 'fail.png', { type: 'image/png' })

    await act(async () => {
      await result.current.upload(file).catch(() => {})
    })

    expect(result.current.uploading).toBe(false)
  })

  it('returns the resolved url and path from uploadFile', async () => {
    mockUploadFile.mockResolvedValue({ url: 'https://cdn.example.com/img.png', path: '/workspace/img.png' })

    const { result } = renderHook(() => useFileUpload())
    const file = new File(['x'], 'img.png', { type: 'image/png' })

    let uploadResult!: { url: string; path: string }
    await act(async () => {
      uploadResult = await result.current.upload(file)
    })

    expect(uploadResult).toEqual({ url: 'https://cdn.example.com/img.png', path: '/workspace/img.png' })
  })
})
