import { describe, expect, it } from 'vitest'
import {
  applyMarkdownPaneParams,
  getEditorPanelComponent,
  getMarkdownEditorParam,
  isMarkdownFile,
  normalizeMarkdownEditorPanels,
  normalizeMarkdownPane,
} from './editorFiles'

describe('editorFiles', () => {
  it('detects markdown extensions', () => {
    expect(isMarkdownFile('README.md')).toBe(true)
    expect(isMarkdownFile('notes.markdown')).toBe(true)
    expect(isMarkdownFile('post.mdx')).toBe(true)
    expect(isMarkdownFile('script.js')).toBe(false)
    expect(isMarkdownFile('')).toBe(false)
  })

  it('routes markdown files to a host-defined pane', () => {
    expect(getEditorPanelComponent('README.md', 'bdocs-markdown')).toBe('bdocs-markdown')
    expect(getEditorPanelComponent('guide.mdx', 'bdocs-markdown')).toBe('bdocs-markdown')
    expect(getEditorPanelComponent('app.py')).toBe('editor')
  })

  it('derives markdown editor params from the selected pane', () => {
    expect(getMarkdownEditorParam('README.md', 'editor')).toBe('tiptap')
    expect(getMarkdownEditorParam('README.md', 'bdocs-markdown')).toBeUndefined()
    expect(getMarkdownEditorParam('app.py', 'bdocs-markdown')).toBeUndefined()
  })

  it('drops core markdown editor params when routing to a host-defined pane', () => {
    expect(applyMarkdownPaneParams(
      { path: 'README.md', markdownEditor: 'tiptap', keep: true },
      'README.md',
      'bdocs-markdown',
    )).toEqual({ path: 'README.md', keep: true })
  })

  it('normalizes markdown pane values', () => {
    expect(normalizeMarkdownPane('editor')).toBe('editor')
    expect(normalizeMarkdownPane('bdocs-markdown')).toBe('bdocs-markdown')
    expect(normalizeMarkdownPane('')).toBe('editor')
  })

  it('normalizes saved markdown editor panels to the selected pane', () => {
    const layout = {
      panels: {
        'editor-README.md': {
          contentComponent: 'editor',
          params: { path: 'README.md' },
        },
        'editor-src/app.py': {
          contentComponent: 'editor',
          params: { path: 'src/app.py' },
        },
      },
    }

    const next = normalizeMarkdownEditorPanels(layout, 'editor')

    expect(next.panels['editor-README.md'].contentComponent).toBe('editor')
    expect(next.panels['editor-README.md'].params.markdownEditor).toBe('tiptap')
    expect(next.panels['editor-src/app.py'].contentComponent).toBe('editor')
  })

  it('normalizes saved markdown editor panels to a host-defined pane id', () => {
    const layout = {
      panels: {
        'editor-README.md': {
          contentComponent: 'editor',
          params: { path: 'README.md', markdownEditor: 'tiptap' },
        },
      },
    }

    const next = normalizeMarkdownEditorPanels(layout, 'bdocs-markdown')

    expect(next.panels['editor-README.md'].contentComponent).toBe('bdocs-markdown')
    expect(next.panels['editor-README.md'].params.markdownEditor).toBeUndefined()
  })
})
