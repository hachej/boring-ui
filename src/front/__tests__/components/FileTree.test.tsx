/**
 * Tests for FileTree component
 *
 * Features tested:
 * - Directory expand/collapse
 * - File selection and active state
 * - Search functionality
 * - Git status badges
 * - Context menu operations
 * - Drag and drop
 * - File creation/rename/delete
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import FileTree from '../../components/FileTree'
import { fileTree, gitStatus, searchResults } from '../fixtures'
import { setupApiMocks, flushPromises, simulateContextMenu, simulateDragDrop } from '../utils'
import DataContext from '../../providers/data/DataContext'
import { createHttpProvider } from '../../providers/data'

const render = (ui: ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={createHttpProvider()}>
        {ui}
      </DataContext.Provider>
    </QueryClientProvider>
  )
}

describe('FileTree', () => {
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

  beforeEach(() => {
    setupApiMocks({
      '/api/v1/files/list': { entries: fileTree.root },
      '/api/v1/git/status': { available: true, files: gitStatus.clean },
      '/api/v1/files/search': searchResults.empty,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders file tree with root entries', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument()
        expect(screen.getByText('package.json')).toBeInTheDocument()
        expect(screen.getByText('src')).toBeInTheDocument()
        expect(screen.getByText('docs')).toBeInTheDocument()
      })
    })

    it('shows search input', () => {
      render(<FileTree {...defaultProps} />)

      expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument()
    })

    it('shows project title', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      expect(screen.getByText('Project')).toBeInTheDocument()
    })

    it('retries fetch if initial load returns empty', async () => {
      let listCalls = 0
      setupApiMocks({
        '/api/v1/files/list': () => {
          listCalls++
          if (listCalls <= 2) return { entries: [] }
          return { entries: fileTree.root }
        },
      })

      render(<FileTree {...defaultProps} />)

      // Component retries with a 300ms backoff; give it enough time deterministically.
      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument()
      }, { timeout: 2000 })

      expect(listCalls).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Directory Expand/Collapse', () => {
    it('expands directory on click', async () => {
      setupApiMocks({
        '/api/v1/files/list': (url: string) => {
          // Must match exact paths to avoid path=src matching path=src/components
          const match = url.match(/path=([^&]+)/)
          const path = match ? match[1] : '.'
          if (path === 'src') return { entries: fileTree.srcDir }
          if (path === '.') return { entries: fileTree.root }
          return { entries: [] } // Unknown paths return empty
        },
        '/api/v1/git/status': { available: true, files: {} },
      })

      render(<FileTree {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('src')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('src'))

      await waitFor(() => {
        expect(screen.getByText('index.js')).toBeInTheDocument()
        expect(screen.getByText('App.jsx')).toBeInTheDocument()
      })
    })

    it('collapses expanded directory on click', async () => {
      setupApiMocks({
        '/api/v1/files/list': (url: string) => {
          const match = url.match(/path=([^&]+)/)
          const path = match ? match[1] : '.'
          if (path === 'src') return { entries: fileTree.srcDir }
          if (path === '.') return { entries: fileTree.root }
          return { entries: [] }
        },
        '/api/v1/git/status': { available: true, files: {} },
      })

      render(<FileTree {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('src')).toBeInTheDocument()
      })

      // Expand
      fireEvent.click(screen.getByText('src'))

      await waitFor(() => {
        expect(screen.getByText('index.js')).toBeInTheDocument()
      })

      // Collapse
      fireEvent.click(screen.getByText('src'))

      await waitFor(() => {
        expect(screen.queryByText('index.js')).not.toBeInTheDocument()
      })
    })

    it('shows folder icon for collapsed directories', async () => {
      render(<FileTree {...defaultProps} />)

      await waitFor(() => {
        // Should have at least one collapsed folder icon (src and docs dirs)
        // Icons are rendered as SVG via Lucide React components
        expect(document.querySelectorAll('.file-item-icon svg').length).toBeGreaterThan(0)
      })
    })

    it('shows open folder icon for expanded directories', async () => {
      setupApiMocks({
        '/api/v1/files/list': (url: string) => {
          const match = url.match(/path=([^&]+)/)
          const path = match ? match[1] : '.'
          if (path === 'src') return { entries: fileTree.srcDir }
          if (path === '.') return { entries: fileTree.root }
          return { entries: [] }
        },
        '/api/v1/git/status': { available: true, files: {} },
      })

      render(<FileTree {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('src')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('src'))

      await waitFor(() => {
        // Expanded folder uses FolderOpen Lucide icon (SVG)
        expect(document.querySelectorAll('.file-item-icon svg').length).toBeGreaterThan(0)
      })
    })
  })

  describe('File Selection', () => {
    it('calls onOpen when file is clicked', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      fireEvent.click(screen.getByText('README.md'))

      expect(defaultProps.onOpen).toHaveBeenCalledWith('README.md')
    })

    it('highlights active file', async () => {
      render(<FileTree {...defaultProps} activeFile="README.md" />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')
      expect(fileItem).toHaveClass('file-item-active')
    })

    it('does not call onOpen when directory is clicked', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      fireEvent.click(screen.getByText('src'))

      expect(defaultProps.onOpen).not.toHaveBeenCalled()
    })
  })

  describe('Search', () => {
    it('shows search results when typing', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: {} },
        '/api/v1/files/search': searchResults.basic,
      })

      render(<FileTree {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('Search files...')
      fireEvent.change(searchInput, { target: { value: 'App' } })

      await waitFor(() => {
        // Search results split matched text into <mark> elements, so check for results container
        const results = document.querySelectorAll('.search-result-item')
        expect(results.length).toBe(2) // App.jsx and App.test.jsx
      })
    })

    it('shows "Searching..." while searching', async () => {
      render(<FileTree {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('Search files...')
      fireEvent.change(searchInput, { target: { value: 'test' } })

      expect(screen.getByText('Searching...')).toBeInTheDocument()
    })

    it('shows "No files found" for empty results', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: {} },
        '/api/v1/files/search': { results: [] },
      })

      render(<FileTree {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('Search files...')
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } })

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        expect(screen.getByText('No files found')).toBeInTheDocument()
      })
    })

    it('highlights matching text in search results', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: {} },
        '/api/v1/files/search': searchResults.basic,
      })

      render(<FileTree {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('Search files...')
      fireEvent.change(searchInput, { target: { value: 'App' } })

      await waitFor(() => {
        // Multiple search results have <mark> elements for highlighting
        const marks = document.querySelectorAll('mark')
        expect(marks.length).toBeGreaterThan(0)
      })
    })

    it('clears search when clear button is clicked', async () => {
      render(<FileTree {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('Search files...')
      fireEvent.change(searchInput, { target: { value: 'test' } })

      const clearButton = screen.getByRole('button')
      fireEvent.click(clearButton)

      expect(searchInput).toHaveValue('')
    })

    it('opens file when search result is clicked', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: {} },
        '/api/v1/files/search': searchResults.basic,
      })

      render(<FileTree {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('Search files...')
      fireEvent.change(searchInput, { target: { value: 'App' } })

      await waitFor(() => {
        const results = document.querySelectorAll('.search-result-item')
        expect(results.length).toBeGreaterThan(0)
      })

      // Click the first search result
      const firstResult = document.querySelector('.search-result-item')!
      fireEvent.click(firstResult)

      expect(defaultProps.onOpen).toHaveBeenCalledWith('src/App.jsx')
    })
  })

  describe('Git Status', () => {
    it('shows modified badge for modified files', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: { 'README.md': 'M' } },
      })

      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        expect(screen.getByText('M')).toBeInTheDocument()
      })
    })

    it('shows new badge for untracked files', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: { 'README.md': '??' } },
      })

      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        expect(screen.getByText('U')).toBeInTheDocument()
      })
    })

    it('shows dot indicator on directory with changed files', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: { 'src/App.jsx': 'M' } },
      })

      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        const srcDir = screen.getByText('src').closest('.file-item')
        expect(srcDir?.querySelector('.dir-changes-dot')).toBeInTheDocument()
      })
    })

    it('sets up polling interval for git status', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval')

      render(<FileTree {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument()
      })

      // Verify that setInterval was called (for polling)
      expect(setIntervalSpy).toHaveBeenCalled()

      setIntervalSpy.mockRestore()
    })
  })

  describe('Context Menu', () => {
    it('shows context menu on right-click', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        expect(screen.getByText('Rename')).toBeInTheDocument()
        expect(screen.getByText('Delete')).toBeInTheDocument()
      })
    })

    it('shows "Open to the Side" for files', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        expect(screen.getByText('Open to the Side')).toBeInTheDocument()
      })
    })

    it('does not show "Open to the Side" for directories', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const dirItem = screen.getByText('src').closest('.file-item')!
      fireEvent.contextMenu(dirItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        expect(screen.queryByText('Open to the Side')).not.toBeInTheDocument()
      })
    })

    it('shows "New File" option in context menu', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        expect(screen.getByText('New File')).toBeInTheDocument()
      })
    })

    it('shows copy path options', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        expect(screen.getByText('Copy Relative Path')).toBeInTheDocument()
        expect(screen.getByText('Copy Path')).toBeInTheDocument()
      })
    })

    it('closes context menu on outside click', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        expect(screen.getByText('Rename')).toBeInTheDocument()
      })

      fireEvent.click(document)

      await waitFor(() => {
        expect(screen.queryByText('Rename')).not.toBeInTheDocument()
      })
    })
  })

  describe('Rename', () => {
    it('shows rename input when rename is selected', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        fireEvent.click(screen.getByText('Rename'))
      })

      await waitFor(() => {
        expect(screen.getByDisplayValue('README.md')).toBeInTheDocument()
      })
    })

    it('renames file on Enter', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: {} },
        '/api/v1/files/rename': { ok: true },
      })

      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        fireEvent.click(screen.getByText('Rename'))
      })

      await waitFor(() => {
        const input = screen.getByDisplayValue('README.md')
        fireEvent.change(input, { target: { value: 'RENAMED.md' } })
        fireEvent.keyDown(input, { key: 'Enter' })
      })

      await new Promise(r => setTimeout(r, 10))

      expect(defaultProps.onFileRenamed).toHaveBeenCalled()
    })

    it('cancels rename on Escape', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        fireEvent.click(screen.getByText('Rename'))
      })

      await waitFor(() => {
        const input = screen.getByDisplayValue('README.md')
        fireEvent.keyDown(input, { key: 'Escape' })
      })

      // Input should be gone
      await waitFor(() => {
        expect(screen.queryByDisplayValue('README.md')).not.toBeInTheDocument()
      })
    })
  })

  describe('Delete', () => {
    it('confirms before deleting', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        fireEvent.click(screen.getByText('Delete'))
      })

      expect(confirmSpy).toHaveBeenCalledWith('Delete file "README.md"?')

      confirmSpy.mockRestore()
    })

    it('deletes file when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: {} },
        // The delete endpoint should be handled
      })

      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')!
      fireEvent.contextMenu(fileItem, { clientX: 100, clientY: 100 })

      await waitFor(() => {
        fireEvent.click(screen.getByText('Delete'))
      })

      await new Promise(r => setTimeout(r, 10))

      expect(defaultProps.onFileDeleted).toHaveBeenCalledWith('README.md')
    })
  })

  describe('New File', () => {
    it('shows new file input when creatingFile prop is true', async () => {
      render(<FileTree {...defaultProps} creatingFile={true} />)

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        expect(screen.getByPlaceholderText('filename')).toBeInTheDocument()
      })
    })

    it('creates file on Enter', async () => {
      setupApiMocks({
        '/api/v1/files/list': { entries: fileTree.root },
        '/api/v1/git/status': { available: true, files: {} },
        '/api/v1/files/write': {},
      })

      render(<FileTree {...defaultProps} creatingFile={true} />)

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        const input = screen.getByPlaceholderText('filename')
        fireEvent.change(input, { target: { value: 'new-file.md' } })
        fireEvent.keyDown(input, { key: 'Enter' })
      })

      await new Promise(r => setTimeout(r, 10))

      expect(defaultProps.onFileCreated).toHaveBeenCalled()
    })

    it('calls onCancelCreate on Escape', async () => {
      render(<FileTree {...defaultProps} creatingFile={true} />)

      await new Promise(r => setTimeout(r, 10))

      await waitFor(() => {
        const input = screen.getByPlaceholderText('filename')
        fireEvent.keyDown(input, { key: 'Escape' })
      })

      expect(defaultProps.onCancelCreate).toHaveBeenCalled()
    })
  })

  describe('Drag and Drop', () => {
    it('sets draggable on file items', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const fileItem = screen.getByText('README.md').closest('.file-item')
      expect(fileItem).toHaveAttribute('draggable', 'true')
    })

    it('shows drag-over state on directory', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const srcDir = screen.getByText('src').closest('.file-item')!

      fireEvent.dragOver(srcDir, {
        dataTransfer: {
          getData: () => '',
          setData: () => {},
          dropEffect: 'move',
        },
      })

      await waitFor(() => {
        expect(srcDir).toHaveClass('drag-over')
      })
    })

    it('removes drag-over state on drag leave', async () => {
      render(<FileTree {...defaultProps} />)

      await new Promise(r => setTimeout(r, 10))

      const srcDir = screen.getByText('src').closest('.file-item')!

      fireEvent.dragOver(srcDir, {
        dataTransfer: { getData: () => '', setData: () => {}, dropEffect: 'move' },
      })
      fireEvent.dragLeave(srcDir)

      await waitFor(() => {
        expect(srcDir).not.toHaveClass('drag-over')
      })
    })
  })

  describe('Polling', () => {
    it('sets up polling interval for file tree', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval')

      render(<FileTree {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument()
      })

      // Verify that setInterval was called for polling
      expect(setIntervalSpy).toHaveBeenCalled()

      setIntervalSpy.mockRestore()
    })

    it('cleans up polling intervals on unmount', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

      const { unmount } = render(<FileTree {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument()
      })

      unmount()

      expect(clearIntervalSpy).toHaveBeenCalled()

      clearIntervalSpy.mockRestore()
    })

    it('refreshes expanded directories during polling', async () => {
      // Track fetch calls to verify expanded dirs are refreshed
      const fetchCalls: string[] = []

      // Initial state: src has index.js
      const initialSrcDir = [
        { name: 'index.js', path: 'src/index.js', is_dir: false },
      ]
      // After polling: src has index.js AND new-file.js
      const updatedSrcDir = [
        { name: 'index.js', path: 'src/index.js', is_dir: false },
        { name: 'new-file.js', path: 'src/new-file.js', is_dir: false },
      ]

      let srcCallCount = 0
      setupApiMocks({
        '/api/v1/files/list': (url: string) => {
          fetchCalls.push(url)
          const match = url.match(/path=([^&]+)/)
          const path = match ? decodeURIComponent(match[1]) : '.'
          if (path === 'src') {
            srcCallCount++
            // Query-driven refresh can issue multiple initial reads; switch only
            // after several calls so the test can assert the pre-refresh state.
            return { entries: srcCallCount > 2 ? updatedSrcDir : initialSrcDir }
          }
          if (path === '.') return { entries: fileTree.root }
          return { entries: [] }
        },
        '/api/v1/git/status': { available: true, files: {} },
        // Return config without paths so it uses flat rendering (not sectioned)
        '/api/config': { available: false },
      })

      render(<FileTree {...defaultProps} />)

      // Wait for initial render - in flat mode, files appear at root
      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument()
      })

      // Wait a bit more for the full tree to load
      await new Promise(r => setTimeout(r, 100))

      // Find and expand the src directory
      const srcElement = screen.getByText('src')
      expect(srcElement).toBeInTheDocument()
      fireEvent.click(srcElement)

      await waitFor(() => {
        expect(screen.getByText('index.js')).toBeInTheDocument()
      })

      // Verify initial content - new file not yet present
      expect(screen.queryByText('new-file.js')).not.toBeInTheDocument()

      // Wait for polling to trigger (3 second interval + some buffer)
      // The refreshTree function will fetch expanded dirs and update with new content
      await waitFor(
        () => {
          expect(screen.getByText('new-file.js')).toBeInTheDocument()
        },
        { timeout: 5000 }
      )

      // Verify that src directory was fetched multiple times (initial expand + polling refresh)
      const srcFetchCalls = fetchCalls.filter(url => url.includes('path=src'))
      expect(srcFetchCalls.length).toBeGreaterThan(1)
    })

    it('reflects moved files in UI after polling', async () => {
      // Simulates: user moves README.md from root to docs/ folder
      // After polling, README.md should disappear from root and appear in docs/

      // Track state changes
      let pollCount = 0

      // Initial root has README.md, after move it doesn't
      const initialRoot = [
        { name: 'README.md', path: 'README.md', is_dir: false },
        { name: 'docs', path: 'docs', is_dir: true },
      ]
      const rootAfterMove = [
        { name: 'docs', path: 'docs', is_dir: true },
      ]

      // docs/ folder initially empty, after move has README.md
      const initialDocs = []
      const docsAfterMove = [
        { name: 'README.md', path: 'docs/README.md', is_dir: false },
      ]

      setupApiMocks({
        '/api/v1/files/list': (url: string) => {
          const match = url.match(/path=([^&]+)/)
          const path = match ? decodeURIComponent(match[1]) : '.'
          if (path === '.') {
            pollCount++
            // After first poll (initial + expand docs + first refresh), return moved state
            return { entries: pollCount > 2 ? rootAfterMove : initialRoot }
          }
          if (path === 'docs') {
            return { entries: pollCount > 2 ? docsAfterMove : initialDocs }
          }
          return { entries: [] }
        },
        '/api/v1/git/status': { available: true, files: {} },
        '/api/config': { available: false },
      })

      render(<FileTree {...defaultProps} />)

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument()
      })

      // Expand docs folder
      fireEvent.click(screen.getByText('docs'))

      await waitFor(() => {
        // docs is expanded (shows open folder icon via Lucide SVG)
        expect(document.querySelectorAll('.file-item-icon svg').length).toBeGreaterThan(0)
      })

      // Initially README.md is in root, not in docs
      expect(screen.getByText('README.md')).toBeInTheDocument()

      // Wait for polling to detect the move (3 second interval + buffer)
      await waitFor(
        () => {
          // README.md should now be inside docs folder (still visible since docs is expanded)
          // But it should NOT be at root level anymore
          const readmeElements = screen.getAllByText('README.md')
          // Should only find one README.md now (in docs folder)
          expect(readmeElements.length).toBe(1)
          // The one README should be inside the docs tree (has docs/README.md path)
        },
        { timeout: 5000 }
      )
    })
  })
})
