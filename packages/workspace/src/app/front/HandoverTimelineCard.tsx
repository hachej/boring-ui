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
      className="mt-2 rounded-xl border border-border/70 bg-card/70 p-3 shadow-sm"
      aria-label="Handover"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Handover</h3>
          <p className="text-xs text-muted-foreground">Reviewable outputs from this completed run</p>
        </div>
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
