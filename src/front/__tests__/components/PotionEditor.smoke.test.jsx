import { describe, expect, it } from 'vitest'
import { fileContents } from '../fixtures/files'
import { parseFrontmatter, reconstructContent } from '../../components/FrontmatterEditor'
import {
  getEditorPanelComponent,
  normalizeMarkdownEditorPanels,
} from '../../utils/editorFiles'

describe('host-defined markdown pane smoke', () => {
  it('keeps markdown routing generic and preserves frontmatter content', () => {
    const content = fileContents.markdown.withFrontmatter
    const { body, frontmatter } = parseFrontmatter(content)
    const editedBody = `${body.trim()}\n\nUpdated in smoke test.\n`

    expect(getEditorPanelComponent('docs/guide.md', 'child-markdown')).toBe('child-markdown')

    const layout = normalizeMarkdownEditorPanels({
      panels: {
        'editor-docs/guide.md': {
          contentComponent: 'editor',
          params: { path: 'docs/guide.md', markdownEditor: 'stale-core-editor' },
        },
      },
    }, 'child-markdown')

    expect(layout.panels['editor-docs/guide.md'].contentComponent).toBe('child-markdown')
    expect(layout.panels['editor-docs/guide.md'].params.markdownEditor).toBeUndefined()

    const fullDocument = reconstructContent(frontmatter, editedBody)
    expect(fullDocument).toContain('title: My Document')
    expect(fullDocument).toContain('Updated in smoke test.')
  })
})
