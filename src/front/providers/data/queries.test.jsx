import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DataContext from './DataContext'
import {
  queryKeys,
  useFileList,
  useFileContent,
  useFileSearch,
  useGitStatus,
  useGitDiff,
  useGitShow,
  useFileWrite,
  useFileDelete,
  useFileRename,
  useFileMove,
} from './queries'

const createProviderMocks = () => ({
  files: {
    list: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    search: vi.fn(),
  },
  git: {
    status: vi.fn(),
    diff: vi.fn(),
    show: vi.fn(),
  },
})

const createWrapper = (provider) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={provider}>
        {children}
      </DataContext.Provider>
    </QueryClientProvider>
  )
  return { wrapper, queryClient }
}

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const expectLoadingState = (result) => {
  expect(result.current.isLoading || result.current.fetchStatus === 'fetching').toBe(true)
}

describe('query hooks', () => {
  describe('useFileList', () => {
    it('success: resolves entries', async () => {
      const provider = createProviderMocks()
      provider.files.list.mockResolvedValue([{ name: 'a.txt', is_dir: false }])
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileList('.'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual([{ name: 'a.txt', is_dir: false }])
      expect(provider.files.list).toHaveBeenCalledWith('.', expect.any(Object))
    })

    it('error: surfaces provider error', async () => {
      const provider = createProviderMocks()
      provider.files.list.mockRejectedValue(new Error('list failed'))
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileList('.'), { wrapper })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error?.message).toContain('list failed')
    })

    it('loading: stays pending for unresolved request', async () => {
      const provider = createProviderMocks()
      const deferred = createDeferred()
      provider.files.list.mockReturnValue(deferred.promise)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileList('.'), { wrapper })

      expectLoadingState(result)
      deferred.resolve([])
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })
  })

  describe('useFileContent', () => {
    it('success: resolves file content', async () => {
      const provider = createProviderMocks()
      provider.files.read.mockResolvedValue('hello')
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileContent('src/a.txt'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toBe('hello')
      expect(provider.files.read).toHaveBeenCalledWith('src/a.txt', expect.any(Object))
    })

    it('error: surfaces provider error', async () => {
      const provider = createProviderMocks()
      provider.files.read.mockRejectedValue(new Error('read failed'))
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileContent('src/a.txt'), { wrapper })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error?.message).toContain('read failed')
    })

    it('loading: stays pending for unresolved request', async () => {
      const provider = createProviderMocks()
      const deferred = createDeferred()
      provider.files.read.mockReturnValue(deferred.promise)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileContent('src/a.txt'), { wrapper })

      expectLoadingState(result)
      deferred.resolve('next')
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })
  })

  describe('useFileSearch', () => {
    it('success: resolves search results', async () => {
      const provider = createProviderMocks()
      provider.files.search.mockResolvedValue([{ path: 'src/a.txt' }])
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileSearch('a'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual([{ path: 'src/a.txt' }])
      expect(provider.files.search).toHaveBeenCalledWith('a', expect.any(Object))
    })

    it('error: surfaces provider error', async () => {
      const provider = createProviderMocks()
      provider.files.search.mockRejectedValue(new Error('search failed'))
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileSearch('needle'), { wrapper })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error?.message).toContain('search failed')
    })

    it('loading: stays pending for unresolved request', async () => {
      const provider = createProviderMocks()
      const deferred = createDeferred()
      provider.files.search.mockReturnValue(deferred.promise)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileSearch('needle'), { wrapper })

      expectLoadingState(result)
      deferred.resolve([])
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })
  })

  describe('useGitStatus', () => {
    it('success: resolves canonical git status codes', async () => {
      const provider = createProviderMocks()
      provider.git.status.mockResolvedValue({
        available: true,
        files: [
          { path: 'src/clean.txt', status: 'M' },
          { path: 'src/new.txt', status: 'U' },
          { path: 'src/staged.txt', status: 'A' },
          { path: 'src/deleted.txt', status: 'D' },
          { path: 'src/conflict.txt', status: 'C' },
        ],
      })
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitStatus(), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      const statuses = result.current.data.files.map((entry) => entry.status)
      expect(statuses).toEqual(expect.arrayContaining(['M', 'U', 'A', 'D', 'C']))
      expect(provider.git.status).toHaveBeenCalledWith(expect.any(Object))
    })

    it('error: surfaces provider error', async () => {
      const provider = createProviderMocks()
      provider.git.status.mockRejectedValue(new Error('status failed'))
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitStatus(), { wrapper })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error?.message).toContain('status failed')
    })

    it('loading: stays pending for unresolved request', async () => {
      const provider = createProviderMocks()
      const deferred = createDeferred()
      provider.git.status.mockReturnValue(deferred.promise)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitStatus(), { wrapper })

      expectLoadingState(result)
      deferred.resolve({ available: true, files: [] })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })
  })

  describe('useGitDiff', () => {
    it('success: resolves diff content', async () => {
      const provider = createProviderMocks()
      provider.git.diff.mockResolvedValue('diff --git a b')
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitDiff('src/a.txt'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toBe('diff --git a b')
      expect(provider.git.diff).toHaveBeenCalledWith('src/a.txt', expect.any(Object))
    })

    it('error: surfaces provider error', async () => {
      const provider = createProviderMocks()
      provider.git.diff.mockRejectedValue(new Error('diff failed'))
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitDiff('src/a.txt'), { wrapper })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error?.message).toContain('diff failed')
    })

    it('loading: stays pending for unresolved request', async () => {
      const provider = createProviderMocks()
      const deferred = createDeferred()
      provider.git.diff.mockReturnValue(deferred.promise)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitDiff('src/a.txt'), { wrapper })

      expectLoadingState(result)
      deferred.resolve('')
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })
  })

  describe('useGitShow', () => {
    it('success: resolves HEAD content', async () => {
      const provider = createProviderMocks()
      provider.git.show.mockResolvedValue('old content')
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitShow('src/a.txt'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toBe('old content')
      expect(provider.git.show).toHaveBeenCalledWith('src/a.txt', expect.any(Object))
    })

    it('error: surfaces provider error', async () => {
      const provider = createProviderMocks()
      provider.git.show.mockRejectedValue(new Error('show failed'))
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitShow('src/a.txt'), { wrapper })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error?.message).toContain('show failed')
    })

    it('loading: stays pending for unresolved request', async () => {
      const provider = createProviderMocks()
      const deferred = createDeferred()
      provider.git.show.mockReturnValue(deferred.promise)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useGitShow('src/a.txt'), { wrapper })

      expectLoadingState(result)
      deferred.resolve('')
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })
  })
})

describe('mutation hooks', () => {
  describe('useFileWrite', () => {
    it('success: writes file content', async () => {
      const provider = createProviderMocks()
      provider.files.write.mockResolvedValue(undefined)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileWrite(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ path: 'src/a.txt', content: 'next' })
      })

      expect(provider.files.write).toHaveBeenCalledWith('src/a.txt', 'next')
    })

    it('cache invalidation: cancels read and invalidates file + git keys', async () => {
      const provider = createProviderMocks()
      provider.files.write.mockResolvedValue(undefined)
      const { wrapper, queryClient } = createWrapper(provider)
      const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const { result } = renderHook(() => useFileWrite(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ path: 'src/a.txt', content: 'next' })
      })

      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: queryKeys.files.read('src/a.txt') })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.files.read('src/a.txt') })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.files.lists() })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.git.all })
    })
  })

  describe('useFileDelete', () => {
    it('success: deletes a file', async () => {
      const provider = createProviderMocks()
      provider.files.delete.mockResolvedValue(undefined)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileDelete(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ path: 'src/a.txt' })
      })

      expect(provider.files.delete).toHaveBeenCalledWith('src/a.txt')
    })

    it('cache invalidation: invalidates file + git keys', async () => {
      const provider = createProviderMocks()
      provider.files.delete.mockResolvedValue(undefined)
      const { wrapper, queryClient } = createWrapper(provider)
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const { result } = renderHook(() => useFileDelete(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ path: 'src/a.txt' })
      })

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.files.all })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.git.all })
    })
  })

  describe('useFileRename', () => {
    it('success: renames a file', async () => {
      const provider = createProviderMocks()
      provider.files.rename.mockResolvedValue(undefined)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileRename(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ oldPath: 'src/a.txt', newName: 'b.txt' })
      })

      expect(provider.files.rename).toHaveBeenCalledWith('src/a.txt', 'b.txt')
    })

    it('cache invalidation: invalidates file + git keys', async () => {
      const provider = createProviderMocks()
      provider.files.rename.mockResolvedValue(undefined)
      const { wrapper, queryClient } = createWrapper(provider)
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const { result } = renderHook(() => useFileRename(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ oldPath: 'src/a.txt', newName: 'b.txt' })
      })

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.files.all })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.git.all })
    })
  })

  describe('useFileMove', () => {
    it('success: moves a file', async () => {
      const provider = createProviderMocks()
      provider.files.move.mockResolvedValue(undefined)
      const { wrapper } = createWrapper(provider)
      const { result } = renderHook(() => useFileMove(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ srcPath: 'src/a.txt', destPath: 'docs' })
      })

      expect(provider.files.move).toHaveBeenCalledWith('src/a.txt', 'docs')
    })

    it('cache invalidation: invalidates file + git keys', async () => {
      const provider = createProviderMocks()
      provider.files.move.mockResolvedValue(undefined)
      const { wrapper, queryClient } = createWrapper(provider)
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const { result } = renderHook(() => useFileMove(), { wrapper })

      await act(async () => {
        await result.current.mutateAsync({ srcPath: 'src/a.txt', destPath: 'docs' })
      })

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.files.all })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.git.all })
    })
  })
})
