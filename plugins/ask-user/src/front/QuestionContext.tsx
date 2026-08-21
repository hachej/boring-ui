"use client"

import { HumanArtifactList, cn, type HumanArtifact } from "@hachej/boring-workspace"
import ReactMarkdown from "react-markdown"
import type { AskUserKind } from "../shared/types"

export function AskUserMetadata({ kind, correlationId, className }: { kind?: AskUserKind | string; correlationId?: string; className?: string }) {
  if (!kind && !correlationId) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="Question metadata">
      {kind ? <span className="rounded-full bg-[color:var(--accent)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">{kind}</span> : null}
      {correlationId ? <span className="max-w-full truncate rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground/75" title={correlationId}>{correlationId}</span> : null}
    </div>
  )
}

export function AskUserContext({
  context,
  artifacts = [],
  onOpenArtifact,
  className,
}: {
  context?: string
  artifacts?: HumanArtifact[]
  onOpenArtifact?: (artifact: HumanArtifact) => void
  className?: string
}) {
  if (!context && artifacts.length === 0) return null
  return (
    <div className={cn("space-y-4", className)}>
      {artifacts.length > 0 ? (
        <section aria-label="Review material" data-ask-user-artifact-count={artifacts.length} className="space-y-2 rounded-md border border-border/70 bg-background p-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Review material</h3>
          <HumanArtifactList artifacts={artifacts} onOpen={onOpenArtifact} />
        </section>
      ) : null}
      {context ? <AskUserMarkdown markdown={context} /> : null}
    </div>
  )
}

export function AskUserMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div data-testid="ask-user-markdown" className={cn("max-w-[72ch] text-sm leading-6 text-muted-foreground", className)}>
      <ReactMarkdown
        skipHtml
        components={{
          h1: ({ children }) => <h3 className="mb-2 mt-5 text-sm font-semibold tracking-tight text-foreground first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-2 mt-5 text-sm font-semibold tracking-tight text-foreground first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-foreground first:mt-0">{children}</h4>,
          p: ({ children }) => <p className="whitespace-pre-wrap [&:not(:first-child)]:mt-2">{children}</p>,
          ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-muted-foreground/70">{children}</ul>,
          ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5 marker:font-medium marker:text-muted-foreground">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          code: ({ children }) => <code className="rounded bg-foreground/[0.07] px-1 py-0.5 text-[0.9em] text-foreground">{children}</code>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-[color:var(--accent)] underline underline-offset-2 hover:no-underline">{children}</a>,
          blockquote: ({ children }) => <blockquote className="my-3 rounded-md bg-foreground/[0.04] px-3 py-2 text-foreground/80">{children}</blockquote>,
        }}
      >{markdown}</ReactMarkdown>
    </div>
  )
}
