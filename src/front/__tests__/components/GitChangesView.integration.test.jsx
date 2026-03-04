import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GitChangesView from '../../components/GitChangesView'
import DataContext from '../../providers/data/DataContext'

const renderWithProvider = (provider, props = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={provider}>
        <GitChangesView {...props} />
      </DataContext.Provider>
    </QueryClientProvider>,
  )
}

describe('GitChangesView integration', () => {
  it('renders provider-backed status groups and opens diff on click', async () => {
    const onOpenDiff = vi.fn()
    const provider = {
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
        status: vi.fn(async () => ({
          available: true,
          files: [
            { path: 'src/App.jsx', status: 'M' },
            { path: 'README.md', status: 'U' },
          ],
        })),
        diff: vi.fn(),
        show: vi.fn(),
      },
    }

    renderWithProvider(provider, { onOpenDiff })

    await waitFor(() => {
      expect(screen.getByText('Modified (1)')).toBeInTheDocument()
      expect(screen.getByText('Untracked (1)')).toBeInTheDocument()
      expect(screen.getByText('App.jsx')).toBeInTheDocument()
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('App.jsx'))
    expect(onOpenDiff).toHaveBeenCalledWith('src/App.jsx', 'M')
  })
})
