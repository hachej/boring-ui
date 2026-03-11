const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])

export const isMarkdownFile = (filepath) => {
  if (!filepath) return false
  const ext = filepath.split('.').pop()?.toLowerCase()
  return MARKDOWN_EXTENSIONS.has(ext)
}

export const normalizeMarkdownPane = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || 'editor'
}

export const getEditorPanelComponent = (filepath, markdownPane = 'editor') =>
  isMarkdownFile(filepath) ? normalizeMarkdownPane(markdownPane) : 'editor'

export const getMarkdownEditorParam = (filepath, markdownPane = 'editor') => {
  if (!isMarkdownFile(filepath)) return undefined
  const normalizedPane = normalizeMarkdownPane(markdownPane)
  if (normalizedPane === 'editor') return 'tiptap'
  return undefined
}

export const normalizeMarkdownEditorPanels = (layout, markdownPane = 'editor') => {
  if (!layout?.panels || typeof layout.panels !== 'object') return layout

  const nextComponent = normalizeMarkdownPane(markdownPane)
  const panels = Object.fromEntries(
    Object.entries(layout.panels).map(([panelId, panel]) => {
      if (!panelId.startsWith('editor-')) return [panelId, panel]

      const path = panel?.params?.path || panelId.replace(/^editor-/, '')
      if (!isMarkdownFile(path)) return [panelId, panel]
      const markdownEditor = getMarkdownEditorParam(path, markdownPane)

      return [
        panelId,
        {
          ...panel,
          contentComponent: nextComponent,
          params: {
            ...(panel?.params || {}),
            ...(markdownEditor
              ? { markdownEditor }
              : {}),
          },
        },
      ]
    }),
  )

  return {
    ...layout,
    panels,
  }
}
