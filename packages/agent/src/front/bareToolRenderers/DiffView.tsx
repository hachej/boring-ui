import { useState } from 'react'
import { createPatch } from 'diff'

const COLLAPSE_THRESHOLD = 30

export interface DiffViewProps {
  oldString: string
  newString: string
  path: string
  replaceAll?: boolean
}

interface DiffLine {
  type: '+' | '-' | ' '
  text: string
}

function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split('\n')
  const result: DiffLine[] = []
  for (const line of lines) {
    if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff') || line.startsWith('Index') || line.startsWith('\\')) continue
    if (line.startsWith('+')) result.push({ type: '+', text: line.slice(1) })
    else if (line.startsWith('-')) result.push({ type: '-', text: line.slice(1) })
    else if (line.startsWith(' ') || line === '') result.push({ type: ' ', text: line.slice(1) })
  }
  while (result.length > 0 && result[result.length - 1].type === ' ' && result[result.length - 1].text === '') {
    result.pop()
  }
  return result
}

const lineStyle: Record<DiffLine['type'], React.CSSProperties> = {
  '+': {
    background: 'var(--boring-chat-diff-add, rgba(46, 160, 67, 0.15))',
    color: 'var(--boring-chat-diff-add-fg, #3fb950)',
  },
  '-': {
    background: 'var(--boring-chat-diff-remove, rgba(248, 81, 73, 0.15))',
    color: 'var(--boring-chat-diff-remove-fg, #f85149)',
  },
  ' ': {},
}

const prefixMap: Record<DiffLine['type'], string> = { '+': '+', '-': '-', ' ': ' ' }

export function DiffView({ oldString, newString, path, replaceAll }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false)

  if (oldString === newString) {
    return (
      <div data-testid="diff-no-change" style={{ opacity: 0.6, fontStyle: 'italic', padding: '0.5rem 0' }}>
        No changes
      </div>
    )
  }

  const patch = createPatch(path, oldString, newString, '', '', { context: 3 })
  const lines = parsePatch(patch)
  const collapsed = !expanded && lines.length > COLLAPSE_THRESHOLD
  const visible = collapsed ? lines.slice(0, COLLAPSE_THRESHOLD) : lines

  return (
    <div data-testid="diff-view">
      <div
        style={{
          padding: '0.375rem 0.75rem',
          fontSize: '0.75rem',
          opacity: 0.7,
          fontFamily: 'var(--boring-chat-font-mono, monospace)',
        }}
      >
        {path}{replaceAll ? ' (replace all)' : ''}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '0.5rem 0',
          fontFamily: 'var(--boring-chat-font-mono, monospace)',
          fontSize: '0.8125rem',
          lineHeight: 1.6,
          overflow: 'auto',
        }}
      >
        {visible.map((line, i) => (
          <div key={i} style={{ ...lineStyle[line.type], padding: '0 0.75rem' }}>
            <span style={{ display: 'inline-block', width: '1.5ch', opacity: 0.5, userSelect: 'none' }}>
              {prefixMap[line.type]}
            </span>
            {line.text}
          </div>
        ))}
      </pre>
      {collapsed && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            display: 'block',
            width: '100%',
            padding: '0.375rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.75rem',
            opacity: 0.6,
            textAlign: 'center',
          }}
        >
          Show {lines.length - COLLAPSE_THRESHOLD} more lines
        </button>
      )}
    </div>
  )
}
