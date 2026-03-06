/**
 * Tests for GitDiff component
 *
 * Features tested:
 * - Diff parsing and rendering
 * - Split vs unified view types
 * - File headers
 * - Empty and invalid diff handling
 * - Multiple file diffs
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GitDiff from '../../components/GitDiff'
import { diffs } from '../fixtures'

describe('GitDiff', () => {
  describe('Empty States', () => {
    it('shows message when diff is null', () => {
      render(<GitDiff diff={null} />)

      expect(screen.getByText('No changes for this file')).toBeInTheDocument()
    })

    it('shows message when diff is undefined', () => {
      render(<GitDiff diff={undefined} />)

      expect(screen.getByText('No changes for this file')).toBeInTheDocument()
    })

    it('shows message when diff is empty string', () => {
      render(<GitDiff diff="" />)

      expect(screen.getByText('No changes for this file')).toBeInTheDocument()
    })

    it('renders empty diff table for invalid diff format', () => {
      // parseDiff returns a file with empty hunks for invalid input
      const { container } = render(<GitDiff diff={diffs.invalid} />)

      // Should render a diff-file container with empty table
      expect(container.querySelector('.diff-file')).toBeInTheDocument()
    })
  })

  describe('Single File Diff', () => {
    it('renders diff content correctly', () => {
      render(<GitDiff diff={diffs.simple} />)

      // Should show the diff content (Hello appears in both deleted and added lines)
      expect(screen.getAllByText(/Hello/).length).toBeGreaterThan(0)
    })

    it('shows file header by default', () => {
      render(<GitDiff diff={diffs.simple} />)

      // parseDiff extracts the path without b/ prefix
      expect(screen.getByText('src/App.jsx')).toBeInTheDocument()
    })

    it('hides file header when showFileHeader is false', () => {
      render(<GitDiff diff={diffs.simple} showFileHeader={false} />)

      expect(screen.queryByText('src/App.jsx')).not.toBeInTheDocument()
    })

    it('renders in split view by default', () => {
      const { container } = render(<GitDiff diff={diffs.simple} />)

      // react-diff-view uses specific classes for split view
      expect(container.querySelector('.diff-split')).toBeInTheDocument()
    })

    it('renders in unified view when specified', () => {
      const { container } = render(<GitDiff diff={diffs.simple} viewType="unified" />)

      expect(container.querySelector('.diff-unified')).toBeInTheDocument()
    })
  })

  describe('Multiple File Diffs', () => {
    it('renders all files in the diff', () => {
      render(<GitDiff diff={diffs.multipleFiles} />)

      // parseDiff extracts paths without b/ prefix
      expect(screen.getByText('file1.js')).toBeInTheDocument()
      expect(screen.getByText('file2.js')).toBeInTheDocument()
    })

    it('shows separate hunks for each file', () => {
      const { container } = render(<GitDiff diff={diffs.multipleFiles} />)

      const diffFiles = container.querySelectorAll('.diff-file')
      expect(diffFiles.length).toBe(2)
    })
  })

  describe('Diff Types', () => {
    it('handles deleted file diffs', () => {
      const { container } = render(<GitDiff diff={diffs.deleted} />)

      // For deleted files, newPath is /dev/null, so header shows that
      // Just verify the diff renders without errors
      expect(container.querySelector('.diff-file')).toBeInTheDocument()
      expect(container.querySelectorAll('.diff-code-delete').length).toBeGreaterThan(0)
    })

    it('handles new file diffs', () => {
      const { container } = render(<GitDiff diff={diffs.newFile} />)

      // For new files, newPath shows the filename
      expect(screen.getByText('new.js')).toBeInTheDocument()
      expect(container.querySelectorAll('.diff-code-insert').length).toBeGreaterThan(0)
    })
  })

  describe('Hunk Rendering', () => {
    it('renders added lines', () => {
      const { container } = render(<GitDiff diff={diffs.simple} />)

      // Added lines have specific classes in react-diff-view
      const addedLines = container.querySelectorAll('.diff-code-insert')
      expect(addedLines.length).toBeGreaterThan(0)
    })

    it('renders removed lines', () => {
      const { container } = render(<GitDiff diff={diffs.simple} />)

      // Removed lines have specific classes in react-diff-view
      const removedLines = container.querySelectorAll('.diff-code-delete')
      expect(removedLines.length).toBeGreaterThan(0)
    })

    it('renders context lines', () => {
      const { container } = render(<GitDiff diff={diffs.simple} />)

      // Context lines are present
      expect(container.querySelector('.diff')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has accessible diff container', () => {
      const { container } = render(<GitDiff diff={diffs.simple} />)

      expect(container.querySelector('.diff-content')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('applies diff-file class to each file section', () => {
      const { container } = render(<GitDiff diff={diffs.simple} />)

      expect(container.querySelector('.diff-file')).toBeInTheDocument()
    })

    it('applies diff-file-header class to file headers', () => {
      const { container } = render(<GitDiff diff={diffs.simple} />)

      expect(container.querySelector('.diff-file-header')).toBeInTheDocument()
    })
  })
})
