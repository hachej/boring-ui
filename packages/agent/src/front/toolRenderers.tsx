/**
 * Default shadcn-styled tool renderers for @boring/agent/front.
 *
 * These build on the canonical Tool primitive (Collapsible + ToolHeader +
 * ToolContent + ToolOutput). Each renderer is intentionally minimal — the
 * title carries the key info (verb + path/command), the body shows output
 * only when there's something worth seeing. No redundant "Parameters" dumps.
 */
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  langFromPath,
  type ToolPart,
  type ToolRenderer,
  type ToolRendererOverrides,
} from './bareToolRenderers'
import type { defaultToolRenderers as bareDefaults } from './bareToolRenderers/renderers'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, getStatusBadge } from './primitives/tool'
import { CollapsibleTrigger } from '@boring/ui'
import { ChevronDownIcon, ExternalLinkIcon, ZapIcon } from 'lucide-react'
import { CodeBlock } from './primitives/code-block'
import { useOpenArtifact } from './ArtifactOpenContext'
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from './primitives/artifact'
import { CopyIcon, DownloadIcon } from 'lucide-react'
import { cn } from './lib'

export type { ToolPart, ToolRenderer, ToolRendererOverrides }

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function extractTextContent(record: Record<string, unknown>, field = 'text'): string {
  const direct = record[field]
  if (typeof direct === 'string') return direct
  const content = record.content
  if (Array.isArray(content)) {
    return (content as Array<{ text?: unknown }>)
      .map((c) => (typeof c?.text === 'string' ? c.text : ''))
      .join('')
  }
  if (typeof content === 'string') return content
  return ''
}

function toHeaderProps(part: ToolPart) {
  return {
    type: 'dynamic-tool' as const,
    state: part.state,
    toolName: part.toolName,
  }
}

/**
 * Clickable path label for read/edit/write headers. Opens the file in the
 * workbench if an ArtifactOpenContext is mounted; falls back to plain text.
 * Rendered as a <span role="button"> to avoid nesting <button> inside the
 * CollapsibleTrigger <button>.
 */
function PathLabel({ path }: { path: string }) {
  const onOpen = useOpenArtifact()
  if (!onOpen) {
    return <span className="font-mono text-[12px] text-foreground/75">{path}</span>
  }
  const open = (e: ReactMouseEvent<HTMLSpanElement> | ReactKeyboardEvent<HTMLSpanElement>) => {
    e.preventDefault()
    e.stopPropagation()
    onOpen(path)
  }
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') open(e)
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={handleKeyDown}
      title={`Open ${path} in workbench`}
      className={cn(
        'group/path inline-flex min-w-0 items-center gap-1 rounded-sm px-0.5',
        'cursor-pointer font-mono text-[12px] text-foreground/75',
        'transition-colors duration-150',
        'hover:text-[color:var(--accent)]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40',
      )}
    >
      <span className="truncate">{path}</span>
      <ExternalLinkIcon
        className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover/path:opacity-100"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </span>
  )
}

function pathTitle(prefix: string, path: string): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="shrink-0 text-muted-foreground/70">{prefix}</span>
      <span className="text-muted-foreground/30" aria-hidden="true">·</span>
      <PathLabel path={path} />
    </span>
  )
}

// ---- bash ----

function renderBash(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const output = asRecord(part.output)
  const command = typeof input.command === 'string' ? input.command : ''
  const description = typeof input.description === 'string' ? input.description : ''
  const stdout = extractTextContent(output, 'stdout')
  const stderr = typeof output.stderr === 'string' ? output.stderr : ''
  const exitCode = typeof output.exitCode === 'number' ? output.exitCode : null

  const title = description || (command.length > 60 ? command.slice(0, 60) + '…' : command) || 'bash'
  const errorText = part.errorText || (stderr && (exitCode ?? 0) !== 0 ? stderr : undefined)

  return (
    <Tool>
      <ToolHeader title={`bash · ${title}`} {...toHeaderProps(part)} />
      <ToolContent>
        {/* Show full command only when a description is used as title (otherwise it's already visible) */}
        {description && command && (
          <CodeBlock code={command} language="bash" />
        )}
        <ToolOutput
          output={stdout && !errorText ? stdout : undefined}
          errorText={errorText}
        />
        {exitCode !== null && exitCode !== 0 && !errorText && (
          <div className="font-mono text-[11px] text-destructive/70">exit {exitCode}</div>
        )}
      </ToolContent>
    </Tool>
  )
}

// ---- read ----

function renderRead(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const output = asRecord(part.output)
  const path = typeof input.path === 'string' ? input.path : ''
  const content = extractTextContent(output)
  const lang = langFromPath(path)

  return (
    <Tool>
      <ToolHeader title={pathTitle('read', path)} {...toHeaderProps(part)} />
      {content && (
        <ToolContent>
          <CodeBlock code={content} language={lang ?? 'text'} />
        </ToolContent>
      )}
    </Tool>
  )
}

// ---- write ----

function renderWrite(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const path = typeof input.path === 'string' ? input.path : ''
  const content = typeof input.content === 'string' ? input.content : ''
  const bytes = content.length
  const lang = langFromPath(path)

  return (
    <Tool>
      <ToolHeader title={pathTitle('write', path)} {...toHeaderProps(part)} />
      <ToolContent>
        <Artifact className="rounded-none border-0 bg-transparent shadow-none">
          <ArtifactHeader className="border-0 px-0 pt-0 pb-2">
            <div>
              <ArtifactTitle>{path || 'untitled'}</ArtifactTitle>
              <ArtifactDescription>
                {bytes.toLocaleString()} {bytes === 1 ? 'byte' : 'bytes'}
                {lang ? ` · ${lang}` : ''}
              </ArtifactDescription>
            </div>
            <ArtifactActions>
              <ArtifactAction
                icon={CopyIcon}
                tooltip="Copy contents"
                label="Copy"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(content).catch(() => {})
                  }
                }}
              />
              <ArtifactAction
                icon={DownloadIcon}
                tooltip="Download file"
                label="Download"
                onClick={() => {
                  try {
                    const blob = new Blob([content], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = path.split('/').pop() || 'artifact.txt'
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                    URL.revokeObjectURL(url)
                  } catch { /* noop */ }
                }}
              />
            </ArtifactActions>
          </ArtifactHeader>
          {content && (
            <ArtifactContent className="p-0">
              <CodeBlock code={content} language={lang ?? 'text'} showLineNumbers />
            </ArtifactContent>
          )}
        </Artifact>
      </ToolContent>
    </Tool>
  )
}

// ---- edit ----

function renderEdit(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const path = typeof input.path === 'string' ? input.path : ''
  const oldString = typeof input.oldString === 'string' ? input.oldString : ''
  const newString = typeof input.newString === 'string' ? input.newString : ''

  return (
    <Tool>
      <ToolHeader title={pathTitle('edit', path)} {...toHeaderProps(part)} />
      <ToolContent>
        <div className="overflow-hidden rounded-sm border border-border/40 font-mono text-[12px] leading-relaxed">
          {oldString && (
            <div className="grid grid-cols-[16px_1fr] gap-2 border-b border-border/30 bg-destructive/5 px-2 py-1.5">
              <span className="select-none text-destructive/60">-</span>
              <span className="whitespace-pre-wrap break-all text-destructive/80">{oldString}</span>
            </div>
          )}
          {newString && (
            <div className="grid grid-cols-[16px_1fr] gap-2 bg-accent/5 px-2 py-1.5">
              <span className="select-none text-accent/70">+</span>
              <span className="whitespace-pre-wrap break-all text-accent/90">{newString}</span>
            </div>
          )}
        </div>
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}

// ---- find / grep / ls ----

function renderSearchLike(toolName: 'find' | 'grep' | 'ls', part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''
  const path = typeof input.path === 'string' ? input.path : ''
  const glob = typeof input.glob === 'string' ? input.glob : ''
  const summary = [pattern, path, glob].filter(Boolean).join(' · ')

  return (
    <Tool>
      <ToolHeader
        title={summary ? `${toolName} · ${summary}` : toolName}
        {...toHeaderProps(part)}
      />
      <ToolContent>
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}

// ---- exec_ui / get_ui_state ----

function extractParamTokens(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) {
    return depth >= 2
      ? [JSON.stringify(value)]
      : value.flatMap((v) => extractParamTokens(v, depth + 1))
  }
  if (typeof value === 'object') {
    return depth >= 2
      ? [JSON.stringify(value)]
      : Object.values(value as Record<string, unknown>).flatMap((v) =>
          extractParamTokens(v, depth + 1),
        )
  }
  return [String(value)]
}

function renderExecUi(part: ToolPart): ReactNode {
  const input = asRecord(part.input)
  const kind = typeof input.kind === 'string' ? input.kind : '(empty)'
  const tokens = extractParamTokens(input.params)
  const headerProps = toHeaderProps(part)

  return (
    <Tool>
      <CollapsibleTrigger
        className="group/exec-ui flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/30"
      >
        <ZapIcon className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        <span className="font-medium text-[13px]">{kind}</span>
        {tokens.length > 0 && (
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="text-muted-foreground/30" aria-hidden="true">·</span>
            {tokens.map((tok, i) => (
              <span
                key={i}
                className="truncate rounded-sm bg-muted/50 px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                title={tok}
              >
                {tok}
              </span>
            ))}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {getStatusBadge(headerProps.state)}
          <ChevronDownIcon
            className="size-3.5 text-muted-foreground/40 transition-transform group-data-[state=open]/exec-ui:rotate-180"
            aria-hidden="true"
          />
        </div>
      </CollapsibleTrigger>
      <ToolContent>
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}

// ---- fallback ----

function renderFallback(part: ToolPart): ReactNode {
  return (
    <Tool>
      <ToolHeader title={part.toolName} {...toHeaderProps(part)} />
      <ToolContent>
        {part.input !== undefined && part.input !== null && (
          <ToolInput input={part.input} />
        )}
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}

// ---- public API ----

export const shadcnDefaultToolRenderers: Record<string, ToolRenderer> = {
  bash: renderBash,
  read: renderRead,
  write: renderWrite,
  edit: renderEdit,
  find: (part) => renderSearchLike('find', part),
  grep: (part) => renderSearchLike('grep', part),
  ls: (part) => renderSearchLike('ls', part),
  exec_ui: renderExecUi,
  __fallback: renderFallback,
}

export function mergeShadcnToolRenderers(
  overrides?: ToolRendererOverrides,
): Record<string, ToolRenderer> {
  if (!overrides) return { ...shadcnDefaultToolRenderers }
  const result: Record<string, ToolRenderer> = { ...shadcnDefaultToolRenderers }
  for (const [key, value] of Object.entries(overrides)) {
    if (value) result[key] = value
  }
  return result
}

export { bareDefaults as bareDefaultToolRenderers }
