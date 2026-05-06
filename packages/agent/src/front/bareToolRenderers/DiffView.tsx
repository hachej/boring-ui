import { useState } from 'react'
import { createPatch } from 'diff'
import { Button } from '@hachej/boring-ui-kit'
import { cn } from '../lib'

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

const lineClass: Record<DiffLine['type'], string> = {
  '+': 'bg-[var(--boring-agent-diff-add,rgba(46,160,67,0.15))] text-[var(--boring-agent-diff-add-fg,#3fb950)]',
  '-': 'bg-[var(--boring-agent-diff-remove,rgba(248,81,73,0.15))] text-[var(--boring-agent-diff-remove-fg,#f85149)]',
  ' ': '',
}

const prefixMap: Record<DiffLine['type'], string> = { '+': '+', '-': '-', ' ': ' ' }

export function DiffView({ oldString, newString, path, replaceAll }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false)

  if (oldString === newString) {
    return (
      <div data-testid="diff-no-change" className="py-2 italic opacity-60">
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
      <div className="px-3 py-1.5 font-[family-name:var(--boring-agent-font-mono,monospace)] text-xs opacity-70">
        {path}{replaceAll ? ' (replace all)' : ''}
      </div>
      <pre className="m-0 overflow-auto py-2 font-[family-name:var(--boring-agent-font-mono,monospace)] text-[0.8125rem] leading-relaxed">
        {visible.map((line, i) => (
          <div key={i} className={cn('px-3', lineClass[line.type])}>
            <span className="inline-block w-[1.5ch] select-none opacity-50">
              {prefixMap[line.type]}
            </span>
            {line.text}
          </div>
        ))}
      </pre>
      {collapsed && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(true)} className="w-full rounded-none text-xs opacity-60">
          Show {lines.length - COLLAPSE_THRESHOLD} more lines
        </Button>
      )}
    </div>
  )
}
