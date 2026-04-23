import type { ReactNode } from 'react'
import { Tool, type ToolState } from '../primitives/Tool'
import { Terminal } from '../primitives/Terminal'
import { CodeBlock } from '../primitives/CodeBlock'
import { DiffView } from './DiffView'

export interface ToolPart {
  type: string
  toolName: string
  toolCallId: string
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
}

export type ToolRenderer = (part: ToolPart) => ReactNode

function asRecord(v: unknown): Record<string, unknown> {
  return (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
}

function langFromPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    css: 'css', html: 'html', sql: 'sql', sh: 'bash', bash: 'bash',
  }
  return ext ? map[ext] : undefined
}

function renderBash(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const output = asRecord(part.output)
  const command = String(input.command ?? '')
  const stdout = typeof output.stdout === 'string' ? output.stdout
    : output.content ? JSON.stringify(output.content) : undefined
  const stderr = typeof output.stderr === 'string' ? output.stderr : undefined
  const exitCode = typeof output.exitCode === 'number' ? output.exitCode : undefined

  return (
    <Tool toolName="bash" toolCallId={part.toolCallId} state={part.state} errorText={part.errorText} defaultExpanded>
      <Terminal title={`$ ${command}`} stdout={stdout} stderr={stderr} exitCode={exitCode ?? null} />
    </Tool>
  )
}

function renderRead(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const output = asRecord(part.output)
  const path = String(input.path ?? '')
  const content = typeof output.text === 'string' ? output.text
    : Array.isArray(output.content) ? (output.content as Array<{text?: string}>).map((c) => c.text ?? '').join('')
    : typeof output.content === 'string' ? output.content : undefined

  return (
    <Tool toolName="read" toolCallId={part.toolCallId} state={part.state} errorText={part.errorText}>
      {content != null ? (
        <CodeBlock code={content} language={langFromPath(path)} filename={path} />
      ) : (
        <span style={{ opacity: 0.6 }}>Reading {path}…</span>
      )}
    </Tool>
  )
}

function renderWrite(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const path = String(input.path ?? '')
  const content = typeof input.content === 'string' ? input.content : ''

  return (
    <Tool toolName="write" toolCallId={part.toolCallId} state={part.state} errorText={part.errorText} defaultExpanded>
      <span style={{ fontFamily: 'var(--boring-chat-font-mono, monospace)', fontSize: '0.8125rem' }}>
        Wrote {content.length} bytes to <strong>{path}</strong>
      </span>
    </Tool>
  )
}

function renderEdit(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const path = String(input.path ?? '')
  const oldString = typeof input.oldString === 'string' ? input.oldString : ''
  const newString = typeof input.newString === 'string' ? input.newString : ''
  const replaceAll = Boolean(input.replaceAll)

  return (
    <Tool toolName="edit" toolCallId={part.toolCallId} state={part.state} errorText={part.errorText} defaultExpanded>
      <DiffView oldString={oldString} newString={newString} path={path} replaceAll={replaceAll} />
    </Tool>
  )
}

function renderGetUiState(part: ToolPart): ReactNode {
  return (
    <Tool toolName="get_ui_state" toolCallId={part.toolCallId} state={part.state} errorText={part.errorText}
      renderOutput={(output) => (
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8125rem', fontFamily: 'var(--boring-chat-font-mono, monospace)' }}>
          {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
        </pre>
      )}
      input={part.input}
      output={part.output}
    />
  )
}

function renderExecUi(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const command = String(input.command ?? input.action ?? '')
  const args = input.args ?? input.payload

  return (
    <Tool toolName="exec_ui" toolCallId={part.toolCallId} state={part.state} errorText={part.errorText} defaultExpanded>
      <span style={{ fontFamily: 'var(--boring-chat-font-mono, monospace)', fontSize: '0.8125rem' }}>
        → {command}{args ? `(${typeof args === 'string' ? args : JSON.stringify(args)})` : ''}
      </span>
    </Tool>
  )
}

function renderFallback(part: ToolPart): ReactNode {
  return (
    <Tool
      toolName={part.toolName}
      toolCallId={part.toolCallId}
      state={part.state}
      input={part.input}
      output={part.output}
      errorText={part.errorText}
    />
  )
}

export const defaultToolRenderers: Record<string, ToolRenderer> = {
  bash: renderBash,
  read: renderRead,
  write: renderWrite,
  edit: renderEdit,
  get_ui_state: renderGetUiState,
  exec_ui: renderExecUi,
}

export function resolveToolRenderer(
  toolName: string,
  overrides?: Record<string, ToolRenderer>,
): ToolRenderer {
  return overrides?.[toolName] ?? defaultToolRenderers[toolName] ?? renderFallback
}
