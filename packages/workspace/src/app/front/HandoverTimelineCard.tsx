"use client"

import { useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { HumanArtifactList } from "../../front/components/HumanArtifactList"
import { openHumanArtifact } from "../../front/artifacts/openHumanArtifact"
import { useWorkspaceShellCapabilities } from "../../shared/plugins/workspaceShellCapabilities"
import type { ProjectedHandover } from "../../shared/artifacts"

export function HandoverTimelineCard({
  handover,
  sessionId,
}: {
  handover: ProjectedHandover
  sessionId: string
}) {
  const shell = useWorkspaceShellCapabilities()
  const [unavailableIds, setUnavailableIds] = useState<ReadonlySet<string>>(() => new Set())

  return (
    <section
      data-boring-workspace-part="handover-card"
      data-handover-id={handover.id}
      className="mt-2 rounded-lg border border-border/50 bg-card/40 p-2.5"
      aria-label="Run deliverables"
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} aria-hidden="true" />
        <h3 className="text-xs font-medium">Deliverables</h3>
        <span className="ml-auto text-xs">{handover.artifacts.length} {handover.artifacts.length === 1 ? "item" : "items"}</span>
      </div>
      <HumanArtifactList
        artifacts={handover.artifacts}
        unavailableArtifactIds={unavailableIds}
        onOpen={(artifact) => {
          const result = openHumanArtifact(shell, artifact, { sessionId })
          if (result.success) return
          setUnavailableIds((current) => new Set([...current, artifact.id]))
        }}
      />
    </section>
  )
}
