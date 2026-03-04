import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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

const createApiStub = () => {
  let handler = null
  return {
    onDidParametersChange: vi.fn((nextHandler) => {
      handler = nextHandler
      return { dispose: vi.fn() }
    }),
    emitParametersChange: (params) => {
      if (handler) handler({ params })
    },
  }
}

const renderWithProvider = (provider, params = {}) => {
  const api = createApiStub()
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
          api={api}
          params={{ path: 'README.md', initialContent: '', ...(params || {}) }}
        />
      </DataContext.Provider>
    </QueryClientProvider>,
  )

  return { ...view, queryClient, api }
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

const createProviderWithStaleReadDuringSave = () => {
  const secondRead = {
    resolve: null,
    promise: null,
  }
  secondRead.promise = new Promise((resolve) => {
    secondRead.resolve = resolve
  })

  let readCount = 0
  const provider = {
    files: {
      list: vi.fn(),
      read: vi.fn(() => {
        readCount += 1
        if (readCount === 1) return Promise.resolve('old content')
        if (readCount === 2) return secondRead.promise
        return Promise.resolve('next content')
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
  return { provider, secondRead }
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

  it('keeps autosaved content instead of resyncing stale initialContent', async () => {
    const { provider } = createProviderWithDeferredRead()
    renderWithProvider(provider)

    expect(screen.getByTestId('editor-content')).toHaveTextContent('')

    fireEvent.click(screen.getByTestId('editor-change'))
    fireEvent.click(screen.getByTestId('editor-autosave'))

    await waitFor(() => {
      expect(provider.files.write).toHaveBeenCalledWith('README.md', 'next content')
    })

    await waitFor(() => {
      expect(screen.getByTestId('editor-content')).toHaveTextContent('next content')
    })
  })

  it('keeps unsaved markdown in panel state across callback-only param updates', async () => {
    const { provider } = createProviderWithDeferredRead()
    const { api } = renderWithProvider(provider)

    expect(screen.getByTestId('editor-content')).toHaveTextContent('')

    fireEvent.click(screen.getByTestId('editor-change'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-content')).toHaveTextContent('next content')
    })

    api.emitParametersChange({
      onDirtyChange: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('editor-content')).toHaveTextContent('next content')
    })
  })

  it('does not flash external-change notice during stale post-save read', async () => {
    const { provider, secondRead } = createProviderWithStaleReadDuringSave()
    renderWithProvider(provider, { initialContent: 'old content' })

    await waitFor(() => {
      expect(screen.getByTestId('editor-content')).toHaveTextContent('old content')
    })

    fireEvent.click(screen.getByTestId('editor-change'))
    fireEvent.click(screen.getByTestId('editor-autosave'))

    await waitFor(() => {
      expect(provider.files.write).toHaveBeenCalledWith('README.md', 'next content')
    })

    expect(screen.queryByText('File changed on disk.')).not.toBeInTheDocument()

    await act(async () => {
      secondRead.resolve('next content')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByText('File changed on disk.')).not.toBeInTheDocument()
    })
  })
})
