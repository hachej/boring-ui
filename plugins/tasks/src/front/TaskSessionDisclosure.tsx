import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { ChevronDown, ExternalLink, MessageSquare, MoreHorizontal, Unlink } from "lucide-react"
import { HumanArtifactList, emitWorkspaceTaskProvenanceChanged, openHumanArtifact, type WorkspacePluginClient } from "@hachej/boring-workspace"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard, BoringTaskSessionLink, SessionHandoverResolution, SessionHandoverSummary } from "../shared"

export const TASK_SESSION_LINKS_CHANGED_EVENT = "boring-tasks:session-links-changed"

export interface TaskSessionActivity {
  sessionId: string
  title: string
  updatedAt: string
  status: "idle" | "hydrating" | "submitted" | "streaming" | "aborting" | "error"
  queuedCount: number
  hasError: boolean
}

export type TaskSessionDisplayStatus = "Working" | "Queued" | "Error" | "Idle"

export type TaskSessionLinkDisclosure = Omit<BoringTaskSessionLink, "sessionId"> & { sessionId?: string }

export interface TaskSessionRow {
  link: TaskSessionLinkDisclosure
  activity?: TaskSessionActivity
  available: boolean
  status: TaskSessionDisplayStatus
}

interface LinkListResponse { ok: true; links: TaskSessionLinkDisclosure[] }
interface ActivityResponse { sessions: TaskSessionActivity[]; omittedSessionIds: string[] }

function statusFor(activity: TaskSessionActivity | undefined): TaskSessionDisplayStatus {
  if (!activity) return "Idle"
  if (["hydrating", "submitted", "streaming", "aborting"].includes(activity.status)) return "Working"
  if (activity.queuedCount > 0) return "Queued"
  if (activity.hasError || activity.status === "error") return "Error"
  return "Idle"
}

export function buildTaskSessionRows(
  links: TaskSessionLinkDisclosure[],
  sessions: TaskSessionActivity[],
  omittedSessionIds: string[],
): TaskSessionRow[] {
  const activityById = new Map(sessions.map((activity) => [activity.sessionId, activity]))
  const omitted = new Set(omittedSessionIds)
  return links.map((link): TaskSessionRow => {
    const activity = link.sessionId ? activityById.get(link.sessionId) : undefined
    const available = Boolean(link.sessionId && activity) && !omitted.has(link.sessionId ?? "")
    return { link, activity: available ? activity : undefined, available, status: statusFor(available ? activity : undefined) }
  }).sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1
    const leftTime = left.activity?.updatedAt ?? left.link.createdAt
    const rightTime = right.activity?.updatedAt ?? right.link.createdAt
    return rightTime.localeCompare(leftTime) || right.link.createdAt.localeCompare(left.link.createdAt)
  })
}

function relativeTime(value: string, now = Date.now()): string {
  const delta = Date.parse(value) - now
  if (!Number.isFinite(delta)) return "Unknown time"
  const absolute = Math.abs(delta)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  if (absolute < 60_000) return formatter.format(Math.round(delta / 1_000), "second")
  if (absolute < 3_600_000) return formatter.format(Math.round(delta / 60_000), "minute")
  if (absolute < 86_400_000) return formatter.format(Math.round(delta / 3_600_000), "hour")
  return formatter.format(Math.round(delta / 86_400_000), "day")
}

function dispatchExactChatEvent(type: "boring-workspace:open-detached-chat" | "boring-workspace:open-full-chat", sessionId: string, title?: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(type, { detail: { sessionId, ...(title ? { title } : {}) } }))
}

export function TaskSessionDisclosure({
  task,
  shell,
  pluginClient,
}: {
  task: BoringTaskCard
  shell: WorkspaceShellCapabilities
  pluginClient: Pick<WorkspacePluginClient, "postJson">
}) {
  const [expanded, setExpanded] = useState(false)
  const [links, setLinks] = useState<TaskSessionLinkDisclosure[] | null>(null)
  const [activity, setActivity] = useState<ActivityResponse>({ sessions: [], omittedSessionIds: [] })
  const [handovers, setHandovers] = useState<ReadonlyMap<string, SessionHandoverSummary>>(() => new Map())
  const [unavailableArtifacts, setUnavailableArtifacts] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openMenuLinkId, setOpenMenuLinkId] = useState<string | null>(null)
  const eventOrigin = useRef({})

  useEffect(() => {
    if (!openMenuLinkId) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      const menuRoot = target instanceof Element
        ? target.closest<HTMLElement>("[data-task-session-actions-root]")
        : null
      if (menuRoot?.dataset.taskSessionActionsRoot !== openMenuLinkId) setOpenMenuLinkId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuLinkId(null)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [openMenuLinkId])

  const loadLinks = useCallback(async () => {
    try {
      const response = await pluginClient.postJson<LinkListResponse>("/api/boring-tasks/sessions/list", {
        adapterId: task.adapterId,
        taskId: task.id,
      })
      setLinks(response.links)
      setError(null)
      return response.links
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load linked sessions.")
      return null
    }
  }, [pluginClient, task.adapterId, task.id])

  const loadActivity = useCallback(async (nextLinks: TaskSessionLinkDisclosure[]) => {
    const sessionIds = nextLinks.flatMap((link) => link.sessionId ? [link.sessionId] : [])
    if (sessionIds.length === 0) {
      setActivity({ sessions: [], omittedSessionIds: [] })
      return
    }
    try {
      const response = await pluginClient.postJson<ActivityResponse>("/api/v1/agent/pi-chat/sessions/activity", {
        sessionIds: sessionIds.slice(0, 50),
      })
      setActivity(response)
      setError(null)
    } catch (cause) {
      setActivity({ sessions: [], omittedSessionIds: sessionIds.slice(0, 50) })
      setError(cause instanceof Error ? cause.message : "Could not load session activity.")
    }
  }, [pluginClient])

  const loadHandovers = useCallback(async (nextLinks: TaskSessionLinkDisclosure[]) => {
    const sessionIds = nextLinks.flatMap((link) => link.sessionId ? [link.sessionId] : [])
    if (sessionIds.length === 0) {
      setHandovers(new Map())
      return
    }
    try {
      const response = await pluginClient.postJson<{ ok: true } & SessionHandoverResolution>("/api/boring-tasks/sessions/handovers", {
        sessionIds: Array.from(new Set(sessionIds.slice(0, 20))),
      })
      setHandovers(new Map(response.matches.map((match) => [match.sessionId, match.handover] as const)))
    } catch {
      setHandovers(new Map())
    }
  }, [pluginClient])

  const refresh = useCallback(async (includeActivity: boolean) => {
    setLoading(true)
    const nextLinks = await loadLinks()
    if (includeActivity && nextLinks) await Promise.all([loadActivity(nextLinks), loadHandovers(nextLinks)])
    setLoading(false)
  }, [loadActivity, loadHandovers, loadLinks])

  useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  useEffect(() => {
    const onLinksChanged = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as { adapterId?: unknown; taskId?: unknown; origin?: unknown } | undefined
      if (detail?.origin === eventOrigin.current || detail?.adapterId !== task.adapterId || detail.taskId !== task.id) return
      void refresh(expanded)
    }
    window.addEventListener(TASK_SESSION_LINKS_CHANGED_EVENT, onLinksChanged)
    return () => window.removeEventListener(TASK_SESSION_LINKS_CHANGED_EVENT, onLinksChanged)
  }, [expanded, refresh, task.adapterId, task.id])

  const rows = useMemo(
    () => buildTaskSessionRows(links ?? [], activity.sessions, activity.omittedSessionIds),
    [activity, links],
  )

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const next = !expanded
    setExpanded(next)
    if (!next) setOpenMenuLinkId(null)
    if (next) void refresh(true)
  }

  const openPopover = (event: MouseEvent<HTMLButtonElement>, row: TaskSessionRow) => {
    event.stopPropagation()
    const sessionId = row.link.sessionId
    if (!sessionId) return
    const result = shell.openDetachedChat(sessionId, { title: row.activity?.title, composingEnabled: true })
    if (!result.success) dispatchExactChatEvent("boring-workspace:open-detached-chat", sessionId, row.activity?.title)
  }

  const openFull = (event: MouseEvent<HTMLButtonElement>, row: TaskSessionRow) => {
    event.stopPropagation()
    setOpenMenuLinkId(null)
    const sessionId = row.link.sessionId
    if (!sessionId) return
    const result = shell.openFullChat(sessionId)
    if (!result.success) dispatchExactChatEvent("boring-workspace:open-full-chat", sessionId)
  }

  const unlinkSession = async (event: MouseEvent<HTMLButtonElement>, row: TaskSessionRow) => {
    event.stopPropagation()
    setOpenMenuLinkId(null)
    if (!window.confirm(`Unlink this chat from ${task.number}? The transcript will be kept.`)) return
    try {
      await pluginClient.postJson("/api/boring-tasks/sessions/unlink", { linkId: row.link.id })
      setLinks((current) => current?.filter((link) => link.id !== row.link.id) ?? current)
      setActivity((current) => ({
        sessions: current.sessions.filter((session) => session.sessionId !== row.link.sessionId),
        omittedSessionIds: current.omittedSessionIds.filter((sessionId) => sessionId !== row.link.sessionId),
      }))
      setHandovers((current) => {
        if (!row.link.sessionId) return current
        const next = new Map(current)
        next.delete(row.link.sessionId)
        return next
      })
      window.dispatchEvent(new CustomEvent(TASK_SESSION_LINKS_CHANGED_EVENT, {
        detail: { adapterId: task.adapterId, taskId: task.id, origin: eventOrigin.current },
      }))
      emitWorkspaceTaskProvenanceChanged()
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlink session.")
    }
  }

  const count = links?.length
  return (
    <div className="w-full" data-task-session-disclosure="true" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ChevronDown className={["size-3 transition-transform duration-150 motion-reduce:transition-none", expanded ? "rotate-0" : "-rotate-90"].join(" ")} aria-hidden="true" />
        <span>{count === undefined ? "Sessions" : `${count} ${count === 1 ? "session" : "sessions"}`}</span>
        {loading ? <span className="ml-auto text-[10px] font-normal">Refreshing…</span> : null}
      </button>

      {expanded ? (
        <div className="mt-1 grid gap-1 border-t border-border/60 pt-1.5">
          {rows.length === 0 && !loading ? (
            <p className="px-1.5 py-1 text-[11px] text-muted-foreground">No linked sessions yet.</p>
          ) : rows.map((row) => {
            const timestamp = row.activity?.updatedAt ?? row.link.createdAt
            const fullTimestamp = Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toLocaleString() : timestamp
            const sessionId = row.link.sessionId
            const handover = sessionId ? handovers.get(sessionId) : undefined
            return (
              <div key={row.link.id} className="rounded-lg">
              <div className="group/session relative flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1.5 hover:bg-muted/50 focus-within:bg-muted/50">
                <span className={[
                  "size-1.5 shrink-0 rounded-full",
                  row.status === "Working" ? "bg-emerald-500" : row.status === "Queued" ? "bg-amber-500" : row.status === "Error" ? "bg-destructive" : "bg-muted-foreground/40",
                ].join(" ")} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-foreground">{row.available ? row.activity?.title || "Untitled session" : "Unavailable session"}</p>
                  <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>{row.available ? row.status : "Unavailable"}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={timestamp} title={fullTimestamp}>{relativeTime(timestamp)}</time>
                  </p>
                </div>
                {row.available && sessionId ? (
                  <button type="button" onClick={(event) => openPopover(event, row)} className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40" aria-label={`Open ${row.activity?.title ?? "session"} in popover`} title="Open chat">
                    <MessageSquare className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
                <div className="relative shrink-0" data-task-session-actions-root={row.link.id}>
                  <button type="button" onClick={(event) => { event.stopPropagation(); setOpenMenuLinkId((current) => current === row.link.id ? null : row.link.id) }} className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40" aria-label={`Open session actions for ${task.number}`} aria-expanded={openMenuLinkId === row.link.id} title="Session actions">
                    <MoreHorizontal className="size-3" aria-hidden="true" />
                  </button>
                  {openMenuLinkId === row.link.id ? (
                    <div className="absolute right-0 top-7 z-40 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl">
                      {row.available && sessionId ? (
                        <button type="button" onClick={(event) => openFull(event, row)} className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left hover:bg-muted" aria-label={`Open ${row.activity?.title ?? "session"} in full chat`}>
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          Open in full chat
                        </button>
                      ) : null}
                      <button type="button" onClick={(event) => void unlinkSession(event, row)} className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left text-destructive hover:bg-destructive/10" aria-label={`Unlink session from ${task.number}`}>
                        <Unlink className="size-3.5" aria-hidden="true" />
                        Unlink from task
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              {handover ? (
                <HumanArtifactList
                  artifacts={handover.artifacts}
                  unavailableArtifactIds={unavailableArtifacts.get(sessionId!)}
                  className="border-t border-border/50 px-1 pb-1 pt-1"
                  onOpen={(artifact) => {
                    const result = openHumanArtifact(shell, artifact, { sessionId: sessionId! })
                    if (result.success) return
                    setUnavailableArtifacts((current) => {
                      const next = new Map(current)
                      next.set(sessionId!, new Set([...(current.get(sessionId!) ?? []), artifact.id]))
                      return next
                    })
                  }}
                />
              ) : null}
              </div>
            )
          })}
          {error ? <p role="status" className="px-1.5 py-1 text-[10px] text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
