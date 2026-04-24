/**
 * Default shadcn-styled tool renderers for @boring/agent/ui-shadcn.
 *
 * These now build on the canonical ai-elements <Tool> primitive
 * (Collapsible + ToolHeader + ToolInput + ToolOutput) — same components
 * Vercel's template ships — plus a tight layer of bash/edit/etc. visual
 * treatment on top. Consumers can override any tool name via the
 * `toolRenderers` prop on <ChatPanel />.
 */
import type { ReactNode } from 'react'
import {
  langFromPath,
  type ToolPart,
  type ToolRenderer,
  type ToolRendererOverrides,
} from '../front/toolRenderers'
import type { defaultToolRenderers as bareDefaults } from '../front/toolRenderers/renderers'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from './primitives/tool'
import { CodeBlock } from './primitives/code-block'
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
      <ToolHeader title={`read · ${path}`} {...toHeaderProps(part)} />
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
      <ToolHeader title={`write · ${path}`} {...toHeaderProps(part)} />
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
      <ToolHeader title={`edit · ${path}`} {...toHeaderProps(part)} />
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
