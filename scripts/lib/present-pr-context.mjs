const emptyContext = () => ({
  mermaid: '',
  visual: '',
  summary: '',
  audit: '',
  verdict: '',
  keyFiles: [],
  reviewHistory: [],
  why: [],
})

export function parseContextMarkdown(raw) {
  const context = emptyContext()
  const fence = raw.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/)
  if (fence?.[1] === 'mermaid') context.mermaid = fence[2].trim()
  else if (fence) context.visual = fence[2].trim()

  const lines = raw.replace(fence?.[0] ?? '', '').split('\n')
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
  return Object.assign(emptyContext(), value)
}

const escapeHtml = (value) => String(value).replace(
  /[&<>"]/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character],
)

export function renderIntroVisual(context, mermaidSvg = '') {
  if (context.mermaid && mermaidSvg) {
    return `<div class="mermaid-svg">${mermaidSvg}</div>`
  }
  if (context.mermaid) {
    return `<pre class="mermaid">\n${escapeHtml(context.mermaid)}\n</pre>`
  }
  if (context.visual) {
    return `<pre class="shape"><code>${escapeHtml(context.visual)}</code></pre>`
  }
  return '<p class="muted">No intro visual supplied. Put one focused fenced block in the context sidecar.</p>'
}
