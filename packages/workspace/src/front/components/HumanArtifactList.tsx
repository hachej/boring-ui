"use client"

import { useState } from "react"
import { ExternalLink, FileText } from "lucide-react"
import type { HumanArtifact } from "../../shared/artifacts"

export interface HumanArtifactListProps {
  artifacts: readonly HumanArtifact[]
  onOpen?: (artifact: HumanArtifact) => void
  unavailableArtifactIds?: ReadonlySet<string>
  initialVisibleCount?: number
  typeLabel?: string | ((artifact: HumanArtifact) => string)
  className?: string
}

function artifactTypeLabel(artifact: HumanArtifact): string {
  if (artifact.surfaceKind === "questions") return "Question"
  if (artifact.surfaceKind === "workspace.open.path" || artifact.surfaceKind === "file") return "Document"
  return "Artifact"
}

export function HumanArtifactList({
  artifacts,
  onOpen,
  unavailableArtifactIds,
  initialVisibleCount = 10,
  typeLabel,
  className,
}: HumanArtifactListProps) {
  const [expanded, setExpanded] = useState(false)
  const boundedInitialCount = Math.max(1, initialVisibleCount)
  const visible = expanded ? artifacts : artifacts.slice(0, boundedInitialCount)
  const hiddenCount = Math.max(0, artifacts.length - visible.length)

  if (artifacts.length === 0) return null

  return (
    <div className={className} data-boring-workspace-part="human-artifact-list">
      <ul className="grid gap-1" aria-label="Artifacts">
        {visible.map((artifact) => {
          const unavailable = unavailableArtifactIds?.has(artifact.id) ?? false
          const canOpen = Boolean(onOpen) && !unavailable
          const defaultTypeLabel = artifactTypeLabel(artifact)
          const resolvedTypeLabel = typeof typeLabel === "function" ? typeLabel(artifact) : typeLabel ?? defaultTypeLabel
          const showDocumentPath = defaultTypeLabel === "Document"
          const content = (
            <>
              <FileText className="size-4 shrink-0 text-[color:var(--accent)]" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{artifact.title}</span>
                {showDocumentPath ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className="font-mono">{artifact.target}</span>
                    {artifact.description ? <span> · {artifact.description}</span> : null}
                  </span>
                ) : artifact.description ? <span className="block truncate text-xs text-muted-foreground">{artifact.description}</span> : null}
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {unavailable ? "Unavailable" : resolvedTypeLabel}
              </span>
              {canOpen ? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            </>
          )
          return (
            <li key={artifact.id}>
              {canOpen ? (
                <button
                  type="button"
                  className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  onClick={() => onOpen?.(artifact)}
                  aria-label={`Open ${artifact.title}`}
                >
                  {content}
                </button>
              ) : (
                <div
                  className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 opacity-70"
                  aria-label={`${artifact.title} unavailable`}
                >
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setExpanded(true)}
        >
          Show {hiddenCount} more
        </button>
      ) : expanded && artifacts.length > boundedInitialCount ? (
        <button
          type="button"
          className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      ) : null}
    </div>
  )
}
