const emptyContext = () => ({
  mermaid: '',
  visual: '',
  visuals: [],
  summary: '',
  audit: '',
  verdict: '',
  keyFiles: [],
  reviewHistory: [],
  why: [],
})

const normalizeVisuals = (context) => {
  if (Array.isArray(context.visuals) && context.visuals.length > 0) {
    return context.visuals
      .filter((item) => item && typeof item.content === 'string' && item.content.trim())
      .map((item) => ({
        language: typeof item.language === 'string' ? item.language : 'text',
        content: item.content.trim(),
      }))
  }
  if (context.mermaid) return [{ language: 'mermaid', content: context.mermaid }]
  if (context.visual) return [{ language: 'text', content: context.visual }]
  return []
}

export function parseContextMarkdown(raw) {
  const context = emptyContext()
  const fencePattern = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  const fences = [...raw.matchAll(fencePattern)]
  context.visuals = fences.map((fence) => ({
    language: fence[1] || 'text',
    content: fence[2].trim(),
  }))
  context.mermaid = context.visuals.find((item) => item.language === 'mermaid')?.content ?? ''
  context.visual = context.visuals.find((item) => item.language !== 'mermaid')?.content ?? ''

  const lines = raw.replace(fencePattern, '').split('\n')
  const keep = []
  let section = ''
  for (const line of lines) {
    if (/^##+\s/.test(line)) {
      const heading = line.replace(/^#+\s*/, '').trim().toLowerCase()
      section = heading === 'key files' ? 'keyFiles'
        : heading === 'review history' ? 'reviewHistory'
        : heading === 'why' ? 'why' : ''
    }
    if (!section) {
      keep.push(line)
      continue
    }
    const item = line.match(/^\s*[-*]\s+(.*)$/)
    if (!item) continue
    if (section === 'keyFiles') context.keyFiles.push(item[1].replace(/`/g, '').trim())
    else if (section === 'why') context.why.push(item[1].replace(/`/g, '').trim())
    else context.reviewHistory.push(item[1].trim())
  }
  context.summary = keep.join('\n').replace(/^#.*\n/, '').trim()
  return context
}

export function createPresentationContext(value = {}) {
  const context = Object.assign(emptyContext(), value)
  context.visuals = normalizeVisuals(context)
  return context
}

const escapeHtml = (value) => String(value).replace(
  /[&<>"]/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character],
)

export function renderIntroVisuals(context, renderedMermaid = []) {
  const visuals = normalizeVisuals(context)
  if (visuals.length === 0) {
    return '<p class="muted">No context visuals supplied. Add focused fenced blocks to the context sidecar.</p>'
  }

  return visuals.map((visual, index) => {
    if (visual.language === 'mermaid' && renderedMermaid[index]) {
      return `<div class="context-visual mermaid-svg">${renderedMermaid[index]}</div>`
    }
    if (visual.language === 'mermaid') {
      return `<pre class="context-visual mermaid">\n${escapeHtml(visual.content)}\n</pre>`
    }
    return `<pre class="context-visual shape"><code>${escapeHtml(visual.content)}</code></pre>`
  }).join('\n')
}
