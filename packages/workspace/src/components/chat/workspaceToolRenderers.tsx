/**
 * Workspace-aware tool renderers for ChatPanel.
 *
 * Re-implements the read / write / edit renderers so the `path` shown in
 * each tool card is a clickable button that opens the file in the
 * surrounding workbench (via the `onOpenArtifact` callback). All other
 * tool types fall through to the agent's default renderers.
 *
 * We deliberately don't import the agent's Tool/Collapsible primitives
 * here — those aren't part of the agent's public ui-shadcn export
 * surface, and pulling them via deep imports would couple workspace to
 * agent internals. Instead this file ships small self-contained
 * substitutes that match the visual language of the surrounding chat.
 */
import type { ReactNode } from "react"
import { ExternalLinkIcon } from "lucide-react"
import type { ToolPart, ToolRenderer, ToolRendererOverrides } from "@boring/agent/ui-shadcn"
import { cn } from "../../lib/utils"

interface CreateOptions {
  /** Called with a file path when the user clicks a clickable artifact reference in chat. */
  onOpenArtifact?: (path: string) => void
}

export function createWorkspaceToolRenderers(
  opts: CreateOptions = {},
): ToolRendererOverrides {
  const open = opts.onOpenArtifact
  return {
    read: (part) => <ReadCard part={part} onOpen={open} />,
    write: (part) => <WriteCard part={part} onOpen={open} />,
    edit: (part) => <EditCard part={part} onOpen={open} />,
  } satisfies Record<string, ToolRenderer>
}

// ---------- helpers ----------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function extractText(record: Record<string, unknown>, field = "text"): string {
  const direct = record[field]
  if (typeof direct === "string") return direct
  const content = record.content
  if (Array.isArray(content)) {
    return (content as Array<{ text?: unknown }>)
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .join("")
  }
  if (typeof content === "string") return content
  return ""
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

// ---------- shared chrome ----------

interface ToolCardProps {
  toolName: string
  state: ToolPart["state"]
  path: string
  onOpen?: (path: string) => void
  preview?: ReactNode
}

const STATE_LABEL: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Streaming",
  "output-available": "Done",
  "output-denied": "Denied",
  "output-error": "Error",
}

const STATE_DOT: Record<ToolPart["state"], string> = {
  "approval-requested": "bg-amber-500",
  "approval-responded": "bg-sky-500",
  "input-available": "bg-amber-500 animate-pulse",
  "input-streaming": "bg-amber-500 animate-pulse",
  "output-available": "bg-emerald-500",
  "output-denied": "bg-orange-500",
  "output-error": "bg-red-500",
}

function ToolCard({ toolName, state, path, onOpen, preview }: ToolCardProps) {
  return (
    <div
      className={cn(
        "group/toolcard not-prose flex flex-col overflow-hidden rounded-[var(--radius-md)]",
        "border border-[color:oklch(from_var(--border)_l_c_h/0.5)] bg-[color:oklch(from_var(--muted)_l_c_h/0.30)]",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[state])}
        />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {toolName}
        </span>
        <span className="text-muted-foreground/40">·</span>
        {path ? (
          <button
            type="button"
            onClick={() => onOpen?.(path)}
            disabled={!onOpen}
            title={onOpen ? `Open ${path} in workbench` : path}
            className={cn(
              "group/path inline-flex min-w-0 items-center gap-1 rounded-[var(--radius-sm)] px-1 py-0.5",
              "font-mono text-[12px] text-foreground/85",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              onOpen
                ? "cursor-pointer hover:bg-foreground/[0.05] hover:text-[color:var(--accent)]"
                : "cursor-default",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40",
            )}
          >
            <span className="truncate">{basename(path)}</span>
            {onOpen && (
              <ExternalLinkIcon
                className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/path:opacity-100"
                strokeWidth={1.75}
              />
            )}
          </button>
        ) : null}
        <span className="ml-auto text-[10.5px] text-muted-foreground/70">{STATE_LABEL[state]}</span>
      </div>
      {preview && (
        <div className="border-t border-[color:oklch(from_var(--border)_l_c_h/0.4)] px-3 py-2 text-[12px] text-foreground/80">
          {preview}
        </div>
      )}
    </div>
  )
}

// ---------- per-tool renderers ----------

function ReadCard({ part, onOpen }: { part: ToolPart; onOpen?: (path: string) => void }) {
  const input = asRecord(part.input)
  const path = typeof input.path === "string" ? input.path : ""
  const output = asRecord(part.output)
  const content = extractText(output)
  const lines = content ? content.split("\n").length : 0
  const preview = lines > 0 ? <span className="text-muted-foreground">{lines} line{lines === 1 ? "" : "s"}</span> : null
  return <ToolCard toolName="read" state={part.state} path={path} onOpen={onOpen} preview={preview} />
}

function WriteCard({ part, onOpen }: { part: ToolPart; onOpen?: (path: string) => void }) {
  const input = asRecord(part.input)
  const path = typeof input.path === "string" ? input.path : ""
  const output = asRecord(part.output)
  const written = typeof output.written === "number" ? output.written : null
  const preview = written != null ? <span className="text-muted-foreground">wrote {written} byte{written === 1 ? "" : "s"}</span> : null
  return <ToolCard toolName="write" state={part.state} path={path} onOpen={onOpen} preview={preview} />
}

function EditCard({ part, onOpen }: { part: ToolPart; onOpen?: (path: string) => void }) {
  const input = asRecord(part.input)
  const path = typeof input.path === "string" ? input.path : ""
  const output = asRecord(part.output)
  const replaced = typeof output.replaced === "number" ? output.replaced : null
  const preview = replaced != null ? <span className="text-muted-foreground">{replaced} replacement{replaced === 1 ? "" : "s"}</span> : null
  return <ToolCard toolName="edit" state={part.state} path={path} onOpen={onOpen} preview={preview} />
}
