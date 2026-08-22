"use client"

import { useCallback, useEffect, useState } from "react"
import {
  EmptyState,
  Meter,
  Notice,
  Pane,
  PaneBody,
  PaneDescription,
  PaneHeader,
  PaneTitle,
  Spinner,
  StatusBadge,
  type StatusBadgeTone,
} from "@hachej/boring-ui-kit"
import { useApiBaseUrl } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { Target } from "lucide-react"
import { createObjectivesClient, ObjectivesClientError } from "./client"
import type { Objective, ObjectiveStatus } from "../shared/types"

interface ObjectivePaneParams {
  objectiveId?: string
}

const STATUS_TONE: Record<ObjectiveStatus, StatusBadgeTone> = {
  active: "info",
  paused: "warning",
  achieved: "success",
  abandoned: "danger",
}

function progressPercent(objective: Objective): number {
  const span = objective.target - objective.baseline
  if (span === 0) return objective.current >= objective.target ? 100 : 0
  const fraction = ((objective.current - objective.baseline) / span) * 100
  return Math.max(0, Math.min(100, fraction))
}

export function ObjectivePane({ params }: PaneProps<ObjectivePaneParams>) {
  const objectiveId = params?.objectiveId
  const apiBaseUrl = useApiBaseUrl()
  const [objective, setObjective] = useState<Objective | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!objectiveId) {
      setLoading(false)
      setObjective(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await createObjectivesClient({ apiBaseUrl }).get(objectiveId)
      setObjective(result)
      if (!result) setError(`Objective ${objectiveId} not found.`)
    } catch (err) {
      setObjective(null)
      setError(err instanceof ObjectivesClientError ? err.message : "Failed to load objective")
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, objectiveId])

  // Rehydration-on-boot: this panel is opened by the agent via exec_ui
  // openSurface (kind "objective", target = objective id). The durable
  // FileObjectiveStore means a page reload just re-fetches the current
  // record from disk through objective.v1.get — no separate boot state.
  useEffect(() => {
    void load()
  }, [load])

  return (
    <Pane className="h-full min-h-0 border-0 rounded-none">
      <PaneHeader>
        <div className="flex min-w-0 items-center gap-2">
          <Target className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <PaneTitle>{objective?.title ?? "Objective"}</PaneTitle>
        </div>
        {objective ? <StatusBadge tone={STATUS_TONE[objective.status]}>{objective.status}</StatusBadge> : null}
      </PaneHeader>
      <PaneBody className="space-y-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Spinner className="mr-2 size-4" /> Loading objective…
          </div>
        ) : !objectiveId ? (
          <EmptyState title="No objective selected" description="Open this surface with an objective id to view it." />
        ) : error && !objective ? (
          <Notice tone="error" title="Couldn't load objective" description={error} />
        ) : objective ? (
          <>
            {error ? <Notice tone="warning" description={error} /> : null}
            <div>
              <PaneDescription>Objective</PaneDescription>
              <p className="mt-1 text-sm text-foreground">{objective.objective}</p>
            </div>

            <div>
              <PaneDescription>{objective.metric}</PaneDescription>
              <div className="mt-2 flex items-center gap-3">
                <Meter
                  className="flex-1"
                  value={progressPercent(objective)}
                  label={`${objective.metric} progress`}
                  tone={objective.status === "abandoned" ? "danger" : "default"}
                />
                <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                  {objective.current} / {objective.target}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Baseline {objective.baseline} → Target {objective.target}</p>
            </div>

            {objective.constraints.length > 0 ? (
              <div>
                <PaneDescription>Constraints</PaneDescription>
                <ul className="mt-1 grid gap-1">
                  {objective.constraints.map((constraint, index) => (
                    <li key={`${index}-${constraint}`} className="text-sm text-foreground">
                      · {constraint}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {objective.evidenceRefs.length > 0 ? (
              <div>
                <PaneDescription>Evidence</PaneDescription>
                <ul className="mt-1 grid gap-1" aria-label="Evidence references">
                  {objective.evidenceRefs.map((ref, index) => (
                    <li key={`${index}-${ref}`} className="truncate font-mono text-xs text-muted-foreground">
                      {ref}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {objective.outcome ? (
              <div>
                <PaneDescription>Outcome</PaneDescription>
                <p className="mt-1 text-sm text-foreground">{objective.outcome}</p>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Created {new Date(objective.createdAt).toLocaleString()} · Updated {new Date(objective.updatedAt).toLocaleString()}
            </p>
          </>
        ) : null}
      </PaneBody>
    </Pane>
  )
}
