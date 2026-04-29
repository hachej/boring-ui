/**
 * Default shadcn-styled tool renderers for @boring/agent/front.
 *
 * These now build on the canonical ai-elements <Tool> primitive
 * (Collapsible + ToolHeader + ToolInput + ToolOutput) — same components
 * Vercel's template ships — plus a tight layer of bash/edit/etc. visual
 * treatment on top. Consumers can override any tool name via the
 * `toolRenderers` prop on <ChatPanel />.
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
import { CollapsibleTrigger } from './ui/collapsible'
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

/**
 * The Tool primitive's discriminated union wants a `type` prop that matches
 * either a static ToolUIPart (`tool-<name>`) or the DynamicToolUIPart
 * (`dynamic-tool` plus `toolName`). Our ToolPart here just has a generic
 * toolName string — so we always project into the dynamic-tool branch, which
 * works for both custom and registered tools without us hardcoding types.
 */
function toHeaderProps(part: ToolPart) {
  return {
    type: 'dynamic-tool' as const,
    state: part.state,
    toolName: part.toolName,
  }
}

/**
 * Path label for the read/edit/write tool headers. When an
 * ArtifactOpenContext provider is mounted (i.e. a workbench host like
 * @boring/workspace is around), the path becomes clickable and opens
 * the file in the host. Without a host, it falls back to plain text.
 *
 * Implementation note: the surrounding Tool header is itself a Radix
 * `CollapsibleTrigger` rendered as a `<button>`, and HTML forbids a
 * nested `<button>`. We therefore render this as a `<span>` with
 * `role="button"` + `tabIndex={0}` + keyboard handling — same a11y
 * affordance, valid HTML. Click + Enter/Space stop propagation and
 * prevent default so they don't also toggle the collapsible.
 */
function PathLabel({ path }: { path: string }) {
  const onOpen = useOpenArtifact()
  if (!onOpen) {
    return <span className="font-mono text-[12.5px] text-foreground/85">{path}</span>
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
        'group/path inline-flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5',
        'cursor-pointer font-mono text-[12.5px] text-foreground/85',
        'transition-colors duration-150',
        'hover:bg-foreground/[0.05] hover:text-[color:var(--accent)]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40',
      )}
    >
      <span className="truncate">{path}</span>
      <ExternalLinkIcon
        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/path:opacity-100"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </span>
  )
}

function pathTitle(prefix: string, path: string): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="text-muted-foreground">{prefix}</span>
      <span className="text-muted-foreground/40" aria-hidden="true">·</span>
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

  const title = description || (command.length > 64 ? command.slice(0, 64) + '…' : command) || 'bash'
  const errorText = part.errorText
    || (stderr && (exitCode ?? 0) !== 0 ? stderr : undefined)

  return (
    <Tool>
      <ToolHeader title={`bash · ${title}`} {...toHeaderProps(part)} />
      <ToolContent>
        {command && (
          <section className="space-y-2">
            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Command
            </h4>
            <CodeBlock code={command} language="bash" />
          </section>
        )}
        <ToolOutput
          output={stdout && !errorText ? stdout : undefined}
          errorText={errorText}
        />
        {exitCode !== null && exitCode !== 0 && !errorText && (
          <div className="text-xs text-destructive">exit {exitCode}</div>
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
      <ToolContent>
        <ToolInput input={input} />
        {content && (
          <section className="space-y-2">
            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Content
            </h4>
            <CodeBlock code={content} language={lang ?? 'text'} />
          </section>
        )}
      </ToolContent>
    </Tool>
  )
}

// ---- write ----
//
// Uses the canonical <Artifact> primitive to present the written file as a
// workspace artifact. Saved content is shown in a titled card with download
// + copy actions, matching the Vercel artifact pattern.

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
        {/* Flat surface: the outer <Tool> already owns a bordered card, so
         * the nested <Artifact> drops its own border/shadow to keep stacked
         * depth at 1 — no "box-in-a-box" feel. */}
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
        <section className="space-y-2">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Diff
          </h4>
          <div className="overflow-hidden rounded-sm border border-input/60 bg-muted/30 font-mono text-[13px] leading-relaxed">
            {oldString && (
              <div className="grid grid-cols-[auto_1fr] gap-2 border-b border-input/40 bg-destructive/5 px-3 py-2">
                <span className="select-none text-destructive/70">-</span>
                <span className={cn('whitespace-pre-wrap break-all text-destructive/90')}>{oldString}</span>
              </div>
            )}
            {newString && (
              <div className="grid grid-cols-[auto_1fr] gap-2 bg-emerald-500/5 px-3 py-2">
                <span className="select-none text-emerald-400/80">+</span>
                <span className="whitespace-pre-wrap break-all text-emerald-300">{newString}</span>
              </div>
            )}
          </div>
        </section>
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
        <ToolInput input={input} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}

// ---- exec_ui / get_ui_state ----
//
// Custom header (not ToolHeader): the wrench icon + "exec_ui · …" prefix
// from the default header is redundant for high-frequency UI commands.
// We replace it with a tighter layout — a lightning glyph hints at the
// "fire-and-forget UI command" semantics, the kind name reads as the
// verb, and primitive param values render as mono tokens (no JSON
// braces). Generic across all kinds; no per-kind branching.
//
// Body collapsed by default, stays consistent with bash/read/edit. On
// error, errorText surfaces in the body via ToolOutput.

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
        className={cn(
          'group/exec-ui flex w-full items-center gap-3 px-3 py-2.5 text-left',
          'hover:bg-muted/40 transition-colors',
        )}
      >
        <ZapIcon
          className="size-3.5 shrink-0 text-muted-foreground/70"
          aria-hidden="true"
        />
        <span className="font-medium text-sm">{kind}</span>
        {tokens.length > 0 && (
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            {tokens.map((tok, i) => (
              <span
                key={i}
                className={cn(
                  'truncate rounded-sm bg-muted/60 px-1.5 py-0.5',
                  'font-mono text-[11px] text-muted-foreground',
                )}
                title={tok}
              >
                {tok}
              </span>
            ))}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {getStatusBadge(headerProps.state)}
          <ChevronDownIcon
            className="size-4 text-muted-foreground/60 transition-transform group-data-[state=open]/exec-ui:rotate-180"
            aria-hidden="true"
          />
        </div>
      </CollapsibleTrigger>
      <ToolContent>
        {part.input !== undefined && part.input !== null && (
          <ToolInput input={part.input} />
        )}
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
