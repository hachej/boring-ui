import { useEffect, useMemo, useRef, useState } from "react"
import { WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT, useWorkspaceAttention, useWorkspacePluginClient, type WorkspaceAttentionBlocker } from "@hachej/boring-workspace"
import type { BoringTaskCard, SessionTaskResolution } from "../shared"

export interface TaskAttentionItem {
  id: string
  title: string
  kind: "question" | "review" | "approval" | "notice"
  sessionId: string
  createdAt?: string | number | Date
  blocker: WorkspaceAttentionBlocker
}

function taskKey(adapterId: string, taskId: string): string {
  return `${adapterId}\u0000${taskId}`
}

export function useTaskAttention(tasks: readonly BoringTaskCard[]): ReadonlyMap<string, readonly TaskAttentionItem[]> {
  const { blockers } = useWorkspaceAttention()
  const pluginClient = useWorkspacePluginClient()
  const [byTask, setByTask] = useState<ReadonlyMap<string, readonly TaskAttentionItem[]>>(() => new Map())
  const [provenanceRevision, setProvenanceRevision] = useState(0)
  const generation = useRef(0)
  const relevant = useMemo(
    () => blockers.filter((blocker): blocker is WorkspaceAttentionBlocker & { sessionId: string } => Boolean(blocker.inbox && blocker.sessionId)),
    [blockers],
  )
  const sessionKey = useMemo(
    () => Array.from(new Set(relevant.map((blocker) => blocker.sessionId))).sort().join("\u0000"),
    [relevant],
  )
  const loadedTaskKeys = useMemo(() => new Set(tasks.map((task) => taskKey(task.adapterId, task.id))), [tasks])

  useEffect(() => {
    const invalidate = () => setProvenanceRevision((current) => current + 1)
    window.addEventListener(WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT, invalidate)
    return () => window.removeEventListener(WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT, invalidate)
  }, [])

  useEffect(() => {
    const current = ++generation.current
    const sessionIds = sessionKey ? sessionKey.split("\u0000") : []
    if (sessionIds.length === 0 || loadedTaskKeys.size === 0) {
      setByTask(new Map())
      return
    }
    void pluginClient.postJson<{ ok?: boolean } & SessionTaskResolution>("/api/boring-tasks/sessions/tasks", { sessionIds })
      .then((resolution) => {
        if (current !== generation.current) return
        const taskKeysBySession = new Map(resolution.matches.map((match) => [
          match.sessionId,
          match.tasks.map((task) => taskKey(task.adapterId, task.taskId)).filter((key) => loadedTaskKeys.has(key)),
        ]))
        const next = new Map<string, TaskAttentionItem[]>()
        for (const blocker of relevant) {
          for (const key of taskKeysBySession.get(blocker.sessionId) ?? []) {
            const currentItems = next.get(key) ?? []
            currentItems.push({
              id: blocker.id,
              title: blocker.label || blocker.reason,
              kind: blocker.inbox!.kind,
              sessionId: blocker.sessionId,
              createdAt: blocker.inbox?.createdAt,
              blocker,
            })
            next.set(key, currentItems)
          }
        }
        for (const items of next.values()) items.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
        setByTask(next)
      })
      .catch(() => {
        if (current === generation.current) setByTask(new Map())
      })
    return () => { generation.current += 1 }
  }, [loadedTaskKeys, pluginClient, provenanceRevision, relevant, sessionKey])

  return byTask
}

export function taskAttentionKey(task: Pick<BoringTaskCard, "adapterId" | "id">): string {
  return taskKey(task.adapterId, task.id)
}
