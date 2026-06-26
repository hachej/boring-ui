import React from "react"
import type { DiffFile } from "./types"
import { classes } from "./ui"

interface DiffLine {
  kind: "context" | "add" | "del" | "note"
  oldNo?: number
  newNo?: number
  text: string
}

interface DiffHunk {
  oldStart: number
  newStart: number
  context: string
  lines: DiffLine[]
}

function parsePatch(patch: string): DiffHunk[] {
  const lines = patch.split(/\r?\n/)
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line)
    if (header) {
      oldNo = Number(header[1])
      newNo = Number(header[2])
      current = { oldStart: oldNo, newStart: newNo, context: header[3] ?? "", lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith("+")) current.lines.push({ kind: "add", newNo: newNo++, text: line.slice(1) })
    else if (line.startsWith("-")) current.lines.push({ kind: "del", oldNo: oldNo++, text: line.slice(1) })
    else if (line.startsWith("\\")) current.lines.push({ kind: "note", text: line.slice(2) })
    else current.lines.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) })
  }
  return hunks
}

const rowClass: Record<DiffLine["kind"], string> = {
  context: "",
  add: "bg-emerald-500/10",
  del: "bg-red-500/10",
  note: "",
}

const markerClass: Record<DiffLine["kind"], string> = {
  context: "text-transparent",
  add: "text-emerald-600 dark:text-emerald-400",
  del: "text-red-600 dark:text-red-400",
  note: "text-muted-foreground",
}

const marker: Record<DiffLine["kind"], string> = {
  context: " ",
  add: "+",
  del: "−",
  note: " ",
}

export function DiffViewer({ file, prUrl }: { file: DiffFile; prUrl?: string }) {
  const hunks = React.useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch])

  if (!file.patch || hunks.length === 0) {
    return (
      <div className="space-y-1 p-6 text-center text-xs text-muted-foreground">
        <p>No patch text for this file — GitHub omits it for binary or very large diffs.</p>
        {prUrl && (
          <a className="inline-block text-foreground hover:underline" href={`${prUrl}/files`} target="_blank" rel="noreferrer">
            View on GitHub ↗
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0 font-mono text-xs leading-5">
      {hunks.map((hunk, hunkIndex) => (
        <React.Fragment key={hunkIndex}>
          <div className={classes("flex items-baseline gap-2 bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground", hunkIndex > 0 && "border-t border-border/60")}>
            <span className="shrink-0 whitespace-nowrap tabular-nums">@@ −{hunk.oldStart} +{hunk.newStart}</span>
            {hunk.context && <span className="min-w-0 truncate opacity-80">{hunk.context}</span>}
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <div key={lineIndex} className={classes("flex", rowClass[line.kind])}>
              <span className="w-10 shrink-0 select-none pr-1.5 text-right tabular-nums text-muted-foreground/50">
                {line.oldNo ?? ""}
              </span>
              <span className="w-10 shrink-0 select-none border-r border-border/40 pr-1.5 text-right tabular-nums text-muted-foreground/50">
                {line.newNo ?? ""}
              </span>
              <span className={classes("w-5 shrink-0 select-none text-center", markerClass[line.kind])}>{marker[line.kind]}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-3">{line.text || " "}</span>
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}
