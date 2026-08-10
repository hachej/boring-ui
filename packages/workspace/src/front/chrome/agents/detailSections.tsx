"use client"

import type { ReactNode } from "react"
import { FileText } from "lucide-react"

/**
 * The presentational vocabulary of the Agent details panel: one section
 * chrome, one card row, one meta row. Every section is built from these, so a
 * spacing or badge change lands in exactly one place.
 */

/**
 * Heading + the ONE loading/empty/error spine every section shares. Sections
 * supply only what actually differs: their words and their list markup. Eight
 * hand-rolled copies of this spine had already drifted into three different
 * loading guards and three different error ternaries.
 */
export function DetailSection({ id, title, hint, loading, empty, error, errorText, emptyText, children }: {
  id: string
  title: string
  hint?: string
  loading: boolean
  empty: boolean
  error?: boolean
  errorText?: string
  emptyText: string
  children: ReactNode
}) {
  const showError = Boolean(error && errorText)
  const showEmpty = empty && !showError
  return (
    <section aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        {hint ? <span className="shrink-0 text-[11px] text-muted-foreground/80">{hint}</span> : null}
      </div>
      {loading ? (
        <div aria-hidden="true" className="mt-3 animate-pulse border-y border-border/60 py-3">
          <div className="h-3.5 w-1/3 rounded bg-foreground/[0.08]" />
          <div className="mt-2 h-3 w-3/5 rounded bg-foreground/[0.06]" />
        </div>
      ) : (
        <>
          {showError ? (
            <p className="mt-3 border-y border-border/60 py-3 text-sm text-muted-foreground">{errorText}</p>
          ) : null}
          {showEmpty ? (
            <p className="mt-3 border-y border-border/60 py-3 text-sm text-muted-foreground">{emptyText}</p>
          ) : null}
          {!empty ? children : null}
        </>
      )}
    </section>
  )
}

export interface DetailRowModel {
  key: string
  title: string
  badge?: string
  blurb?: string
  icon?: "file"
  /** Present ⇒ the row is a button that opens something. */
  onOpen?: () => void
  openAriaLabel?: string
  openTitle?: string
}

/**
 * The single card row used by Instructions and Skills. Owns
 * card-vs-div, the badge, the blurb and the trailing icon — the three
 * byte-identical copies this replaces had already started drifting apart.
 */
function DetailRow({ row }: { row: DetailRowModel }) {
  const body = (
    <div className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 sm:min-h-0">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">{row.title}</span>
          {row.badge ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">{row.badge}</span>
          ) : null}
        </div>
        {row.blurb ? (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.blurb}</p>
        ) : null}
      </div>
      {row.icon && row.onOpen ? (
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" strokeWidth={1.75} aria-hidden="true" />
      ) : null}
    </div>
  )
  return (
    <li className="min-w-0">
      {row.onOpen ? (
        <button
          type="button"
          onClick={row.onOpen}
          title={row.openTitle}
          aria-label={row.openAriaLabel}
          className="group block w-full rounded-xl border border-border/60 bg-card/70 text-left transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {body}
        </button>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card/70">{body}</div>
      )}
    </li>
  )
}

/** Card list shared by Instructions / Skills. */
export function CardRows({ rows }: { rows: readonly DetailRowModel[] }) {
  return <ul role="list" className="mt-3 grid gap-2">{rows.map((row) => <DetailRow key={row.key} row={row} />)}</ul>
}

/** Bordered list wrapper shared by Tools / MCP / Plugins. */
export function DividedRows({ children }: { children: ReactNode }) {
  return <ul role="list" className="mt-3 divide-y divide-border/50 border-y border-border/60">{children}</ul>
}

/**
 * A name, a right-aligned fact about it, and an optional detail line. MCP
 * servers and Plugins are the same row wearing different words.
 */
export function MetaRow({ title, meta, detail }: { title: string; meta: string; detail?: string }) {
  return (
    <li className="min-h-11 py-2.5 sm:min-h-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{meta}</span>
      </div>
      {detail ? (
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{detail}</p>
      ) : null}
    </li>
  )
}
