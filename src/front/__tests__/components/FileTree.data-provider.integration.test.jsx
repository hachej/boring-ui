import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FileTree from '../../components/FileTree'
import DataContext from '../../providers/data/DataContext'
import { queryKeys } from '../../providers/data/queries'

const defaultProps = {
  onOpen: vi.fn(),
  onOpenToSide: vi.fn(),
  onFileDeleted: vi.fn(),
  onFileRenamed: vi.fn(),
  onFileMoved: vi.fn(),
  projectRoot: '/project',
  activeFile: null,
  creatingFile: false,
  onFileCreated: vi.fn(),
  onCancelCreate: vi.fn(),
}

const renderWithProvider = (provider) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  const view = render(
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={provider}>
        <FileTree {...defaultProps} />
      </DataContext.Provider>
    </QueryClientProvider>,
  )

  return { ...view, queryClient }
}

describe('FileTree DataProvider integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/config')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '{}',
        }
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Not found' }),
        text: async () => 'Not found',
      }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders entries from provider and reflects cache invalidation updates', async () => {
    let rootEntries = [
      { name: 'README.md', path: 'README.md', is_dir: false },
      { name: 'src', path: 'src', is_dir: true },
    ]

    const provider = {
      files: {
        list: vi.fn(async (dir) => (dir === '.' ? rootEntries : [])),
        read: vi.fn(),
        write: vi.fn(),
        delete: vi.fn(),
        rename: vi.fn(),
        move: vi.fn(),
        search: vi.fn(async () => []),
      },
      git: {
        status: vi.fn(async () => ({ available: true, files: [{ path: 'README.md', status: 'M' }] })),
        diff: vi.fn(),
        show: vi.fn(),
      },
    }

    const { queryClient } = renderWithProvider(provider)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    rootEntries = [...rootEntries, { name: 'CHANGELOG.md', path: 'CHANGELOG.md', is_dir: false }]

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.files.all })
    })

    await waitFor(() => {
      expect(screen.getByText('CHANGELOG.md')).toBeInTheDocument()
    })

    expect(provider.files.list).toHaveBeenCalledWith('.', expect.any(Object))
    expect(provider.git.status).toHaveBeenCalled()
  })
})
