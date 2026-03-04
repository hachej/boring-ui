import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DataContext from '../../providers/data/DataContext'
import EditorPanel from '../../panels/EditorPanel'

vi.mock('../../components/Editor', () => ({
  default: ({ content, onChange, onAutoSave }) => (
    <div>
      <div data-testid="editor-content">{content}</div>
      <button type="button" data-testid="editor-change" onClick={() => onChange?.('next content')}>
        change
      </button>
      <button type="button" data-testid="editor-autosave" onClick={() => onAutoSave?.('next content')}>
        autosave
      </button>
    </div>
  ),
}))

vi.mock('../../components/CodeEditor', () => ({
  default: () => <div data-testid="code-editor-stub" />,
}))

vi.mock('../../components/GitDiff', () => ({
  default: () => <div data-testid="git-diff-stub" />,
}))

const createApiStub = () => ({
  onDidParametersChange: vi.fn(() => ({ dispose: vi.fn() })),
})

const renderWithProvider = (provider, params = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  const view = render(
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={provider}>
        <EditorPanel
          api={createApiStub()}
          params={{ path: 'README.md', initialContent: '', ...(params || {}) }}
        />
      </DataContext.Provider>
    </QueryClientProvider>,
  )

  return { ...view, queryClient }
}

const createProviderWithDeferredRead = () => {
  const readSignals = []
  const provider = {
    files: {
      list: vi.fn(),
      read: vi.fn((_path, opts = {}) => {
        if (opts?.signal) readSignals.push(opts.signal)
        return new Promise(() => {})
      }),
      write: vi.fn(async () => undefined),
      delete: vi.fn(),
      rename: vi.fn(),
      move: vi.fn(),
      search: vi.fn(),
    },
    git: {
      status: vi.fn(async () => ({ available: true, files: [] })),
      diff: vi.fn(async () => ''),
      show: vi.fn(async () => ''),
    },
  }
  return { provider, readSignals }
}

describe('EditorPanel integration + cancellation', () => {
  it('save cancels in-flight read poll before write completes', async () => {
    const { provider, readSignals } = createProviderWithDeferredRead()
    renderWithProvider(provider)

    await waitFor(() => {
      expect(readSignals.length).toBeGreaterThan(0)
      expect(screen.getByTestId('editor-autosave')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('editor-autosave'))

    await waitFor(() => {
      expect(provider.files.write).toHaveBeenCalledWith('README.md', 'next content')
    })

    await waitFor(() => {
      expect(readSignals.some((signal) => signal.aborted)).toBe(true)
    })
  })

  it('unmount cancels pending read query signal', async () => {
    const { provider, readSignals } = createProviderWithDeferredRead()
    const { unmount } = renderWithProvider(provider)

    await waitFor(() => {
      expect(readSignals.length).toBeGreaterThan(0)
    })

    unmount()

    await waitFor(() => {
      expect(readSignals.some((signal) => signal.aborted)).toBe(true)
    })
  })
})
