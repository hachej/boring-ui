import type { ReactNode } from 'react'
import { Tool, type ToolState } from '../barePrimitives/Tool'
import { Terminal } from '../barePrimitives/Terminal'
import { CodeBlock } from '../barePrimitives/CodeBlock'
import { DiffView } from './DiffView'

const FALLBACK_RENDERER_KEY = '__fallback'

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
export type ToolRendererOverrides = Partial<Record<string, ToolRenderer>>

function asRecord(v: unknown): Record<string, unknown> {
  return (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false
  return Object.getPrototypeOf(v) === Object.prototype
}

function deepMergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key]
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      merged[key] = deepMergeRecords(baseValue, overrideValue)
      continue
    }
    merged[key] = overrideValue
  }

  return merged
}

export function langFromPath(path: string): string | undefined {
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
      <span style={{ fontFamily: 'var(--boring-agent-font-mono, monospace)', fontSize: '0.8125rem' }}>
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

function renderSearchLike(toolName: 'find' | 'grep' | 'ls', part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const output = asRecord(part.output)
  const content = Array.isArray(output.content)
    ? (output.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
    : typeof output.content === 'string'
      ? output.content
      : typeof output.text === 'string'
        ? output.text
        : typeof part.output === 'string'
          ? part.output
          : ''
  const path = typeof input.path === 'string' ? input.path : ''
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''
  const title = [toolName, pattern || path].filter(Boolean).join(' ')

  return (
    <Tool toolName={toolName} toolCallId={part.toolCallId} state={part.state} errorText={part.errorText}>
      {content ? (
        <CodeBlock code={content} language="text" filename={title} />
      ) : (
        <span style={{ opacity: 0.6 }}>
          {toolName === 'ls' ? `Listing ${path || '.'}...` : `Searching ${pattern || path || '.'}...`}
        </span>
      )}
    </Tool>
  )
}

function renderGetUiState(part: ToolPart): ReactNode {
  return (
    <Tool toolName="get_ui_state" toolCallId={part.toolCallId} state={part.state} errorText={part.errorText}
      renderOutput={(output) => (
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8125rem', fontFamily: 'var(--boring-agent-font-mono, monospace)' }}>
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
  const kind = typeof input.kind === 'string' ? input.kind : ''
  const params = input.params

  // Generic format: `kind(<params as compact JSON>)`. Works for any
  // command kind the workspace adds later — no per-kind switch.
  const paramsText =
    params !== undefined && params !== null
      ? typeof params === 'string'
        ? params
        : JSON.stringify(params)
      : ''
  const summary = kind ? `${kind}${paramsText ? `(${paramsText})` : ''}` : '(empty)'

  return (
    <Tool
      toolName="exec_ui"
      toolCallId={part.toolCallId}
      state={part.state}
      errorText={part.errorText}
      defaultExpanded
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span
          style={{
            fontFamily: 'var(--boring-agent-font-mono, monospace)',
            fontSize: '0.8125rem',
            wordBreak: 'break-all',
          }}
        >
          → {summary}
        </span>
        {part.errorText && (
          <span
            data-testid="tool-error"
            style={{
              color: 'var(--boring-agent-tool-error, #ef4444)',
              fontFamily: 'var(--boring-agent-font-mono, monospace)',
              fontSize: '0.8125rem',
            }}
          >
            {part.errorText}
          </span>
        )}
      </div>
    </Tool>
  )
}

function renderFallback(part: ToolPart): ReactNode {
  const renderJson = (value: unknown): ReactNode => (
    <pre
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        fontSize: '0.8125rem',
        fontFamily: 'var(--boring-agent-font-mono, monospace)',
      }}
    >
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )

  return (
    <Tool
      toolName={part.toolName}
      toolCallId={part.toolCallId}
      state={part.state}
      input={part.input}
      output={part.output}
      errorText={part.errorText}
      defaultExpanded
      renderInput={renderJson}
      renderOutput={renderJson}
    />
  )
}

export const defaultToolRenderers: Record<string, ToolRenderer> = {
  bash: renderBash,
  read: renderRead,
  write: renderWrite,
  edit: renderEdit,
  find: (part) => renderSearchLike('find', part),
  grep: (part) => renderSearchLike('grep', part),
  ls: (part) => renderSearchLike('ls', part),
  get_ui_state: renderGetUiState,
  exec_ui: renderExecUi,
}

export function mergeToolRenderers(
  overrides?: ToolRendererOverrides,
): Record<string, ToolRenderer> {
  if (!overrides) {
    return { ...defaultToolRenderers }
  }

  return deepMergeRecords(
    defaultToolRenderers as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>,
  ) as Record<string, ToolRenderer>
}

export function resolveToolRenderer(
  toolName: string,
  overrides?: ToolRendererOverrides,
): ToolRenderer {
  return (
    overrides?.[toolName]
    ?? defaultToolRenderers[toolName]
    ?? overrides?.[FALLBACK_RENDERER_KEY]
    ?? renderFallback
  )
}
