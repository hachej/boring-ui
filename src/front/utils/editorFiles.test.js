import { describe, expect, it } from 'vitest'
import {
  getEditorPanelComponent,
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

  it('routes markdown files to the potion pane', () => {
    expect(getEditorPanelComponent('README.md', 'potion')).toBe('potion')
    expect(getEditorPanelComponent('guide.mdx', 'potion')).toBe('potion')
    expect(getEditorPanelComponent('app.py')).toBe('editor')
  })

  it('normalizes markdown pane values', () => {
    expect(normalizeMarkdownPane('potion')).toBe('potion')
    expect(normalizeMarkdownPane('editor')).toBe('editor')
    expect(normalizeMarkdownPane('weird')).toBe('editor')
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

    const next = normalizeMarkdownEditorPanels(layout, 'potion')

    expect(next.panels['editor-README.md'].contentComponent).toBe('potion')
    expect(next.panels['editor-src/app.py'].contentComponent).toBe('editor')
  })
})
