import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react"
import { AlertCircle, CircleDot, Link2, MessageSquare, MoreHorizontal, Trash2, X } from "lucide-react"
import { useWorkspacePluginClient } from "@hachej/boring-workspace"
import { useWorkspaceShellCapabilities, type WorkspaceShellAnchorRect } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard, BoringTaskSessionBinding } from "../shared"

interface TaskCardProps {
  task: BoringTaskCard
  draggable: boolean
  unmapped?: boolean
  deleteEnabled?: boolean
  compact?: boolean
  onDelete?: (task: BoringTaskCard) => void
  onDragStart: (event: DragEvent<HTMLElement>, task: BoringTaskCard) => void
  onDragEnd: () => void
}

function ExternalLinkGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-9 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function rectFromElement(element: HTMLElement): WorkspaceShellAnchorRect {
  const rect = element.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
}

interface CreatedPiChatSession { id?: unknown; title?: unknown }
interface TaskSessionListResponse { links?: BoringTaskSessionBinding[] }
interface TaskSessionLinkResponse { link?: BoringTaskSessionBinding }
interface PiSessionSummary { id: string; title?: string; updatedAt?: string; createdAt?: string }
interface ManageSessionsSearchResponse { action?: string; sessions?: PiSessionSummary[] }

type TaskSessionActivityStatus = "idle" | "queued" | "working" | "error" | "missing"
interface TaskSessionActivity { status: TaskSessionActivityStatus; source?: "live-runtime" | "persisted"; updatedAt?: string }
interface SessionActivityResponse {
  activities?: Array<{ sessionId: string; status: "idle" | "queued" | "working" | "error"; source: "live-runtime" | "persisted"; updatedAt?: string }>
  omittedSessionIds?: string[]
}

const TASK_SESSION_ACTIVITY_POLL_MS = 15_000
const TASK_SESSION_ACTIVITY_MAX_IDS = 100

function taskDisplayRef(task: BoringTaskCard): string {
  return task.number || task.id
}

function taskChatTitle(task: BoringTaskCard): string {
  return `${taskDisplayRef(task)}: ${task.title}`
}

function taskChatDraft(task: BoringTaskCard): string {
  return [
    `Let's work on ${taskDisplayRef(task)}: ${task.title}`,
    "",
    `Task ID: ${task.id}`,
    `Display ref: ${taskDisplayRef(task)}`,
    `Status: ${task.statusId}`,
    task.url ? `URL: ${task.url}` : null,
  ].filter(Boolean).join("\n")
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return "just now"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function activityRank(status: TaskSessionActivityStatus): number {
  if (status === "working") return 4
  if (status === "queued") return 3
  if (status === "error") return 2
  return 1
}

function activityLabel(activity: TaskSessionActivity | undefined, loading: boolean): string {
  if (!activity) return loading ? "Checking activity" : "Activity pending"
  if (activity.status === "working") return "Working"
  if (activity.status === "queued") return "Queued"
  if (activity.status === "error") return "Needs attention"
  if (activity.status === "missing") return "Activity unavailable"
  return "Idle"
}

function newestTimestampMs(link: BoringTaskSessionBinding, activity: TaskSessionActivity | undefined): number {
  const activityMs = activity?.updatedAt ? new Date(activity.updatedAt).getTime() : Number.NaN
  const linkMs = new Date(link.createdAt).getTime()
  return Math.max(Number.isFinite(activityMs) ? activityMs : 0, Number.isFinite(linkMs) ? linkMs : 0)
}

export function TaskCard({ task, draggable, unmapped = false, deleteEnabled = false, compact = false, onDelete, onDragStart, onDragEnd }: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [openingChat, setOpeningChat] = useState(false)
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [sessionLinks, setSessionLinks] = useState<BoringTaskSessionBinding[]>([])
  const [sessionLinksLoaded, setSessionLinksLoaded] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [linkQuery, setLinkQuery] = useState("")
  const [linkSearchResults, setLinkSearchResults] = useState<PiSessionSummary[]>([])
  const [linkSearchLoading, setLinkSearchLoading] = useState(false)
  const [sessionActivities, setSessionActivities] = useState<Record<string, TaskSessionActivity>>({})
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const shell = useWorkspaceShellCapabilities()
  const pluginClient = useWorkspacePluginClient()
  const tags = task.tags?.slice(0, 4) ?? []
  const hiddenTagCount = Math.max((task.tags?.length ?? 0) - tags.length, 0)
  const pullRequests = task.pullRequests?.slice(0, 2) ?? []
  const hiddenPullRequestCount = Math.max((task.pullRequests?.length ?? 0) - pullRequests.length, 0)
  const chatTitle = taskChatTitle(task)
  const linkedSessionIds = useMemo(() => new Set(sessionLinks.map((link) => link.sessionId)), [sessionLinks])
  const visibleActivityLinks = useMemo(() => sessionLinks.slice(0, TASK_SESSION_ACTIVITY_MAX_IDS), [sessionLinks])
  const sortedSessionLinks = useMemo(() => {
    return [...sessionLinks].sort((a, b) => {
      const aActivity = sessionActivities[a.sessionId]
      const bActivity = sessionActivities[b.sessionId]
      const rankDelta = activityRank(bActivity?.status ?? "idle") - activityRank(aActivity?.status ?? "idle")
      if (rankDelta !== 0) return rankDelta
      return newestTimestampMs(b, bActivity) - newestTimestampMs(a, aActivity)
    })
  }, [sessionActivities, sessionLinks])
  const rollupStatus = useMemo<TaskSessionActivityStatus>(() => sortedSessionLinks.reduce<TaskSessionActivityStatus>((status, link) => {
    const candidate = sessionActivities[link.sessionId]?.status ?? "idle"
    return activityRank(candidate) > activityRank(status) ? candidate : status
  }, "idle"), [sessionActivities, sortedSessionLinks])
  const workingLinks = useMemo(() => sessionLinks.filter((link) => sessionActivities[link.sessionId]?.status === "working"), [sessionActivities, sessionLinks])
  const workingCount = workingLinks.length
  const activeCount = sessionLinks.filter((link) => {
    const status = sessionActivities[link.sessionId]?.status
    return status === "working" || status === "queued" || status === "error"
  }).length
  const rollupText = activityLabel({ status: rollupStatus }, activityLoading)

  const stopCardAction = (event: MouseEvent<HTMLElement>) => event.stopPropagation()

  const refreshSessionActivity = useCallback(async (links: BoringTaskSessionBinding[]): Promise<Record<string, TaskSessionActivity>> => {
    const sessionIds = [...new Set(links.map((link) => link.sessionId))].slice(0, TASK_SESSION_ACTIVITY_MAX_IDS)
    if (sessionIds.length === 0) {
      setSessionActivities({})
      setActivityError(null)
      return {}
    }
    setActivityLoading(true)
    try {
      const body = await pluginClient.postJson<SessionActivityResponse>("/api/v1/agent/pi-chat/sessions/activity", { sessionIds })
      const next: Record<string, TaskSessionActivity> = {}
      for (const entry of body.activities ?? []) {
        next[entry.sessionId] = { status: entry.status, source: entry.source, updatedAt: entry.updatedAt }
      }
      for (const sessionId of body.omittedSessionIds ?? []) next[sessionId] = { status: "missing" }
      setSessionActivities((current) => ({ ...current, ...next }))
      setActivityError(null)
      return next
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : "Failed to load chat activity")
      throw error
    } finally {
      setActivityLoading(false)
    }
  }, [pluginClient])

  const loadSessionLinks = useCallback(async (): Promise<BoringTaskSessionBinding[]> => {
    const body = await pluginClient.postJson<TaskSessionListResponse>("/api/boring-tasks/sessions/list", { adapterId: task.adapterId, taskId: task.id })
    const links = body.links ?? []
    setSessionLinks(links)
    setSessionLinksLoaded(true)
    if (links.length > 0) void refreshSessionActivity(links).catch(() => undefined)
    return links
  }, [pluginClient, refreshSessionActivity, task.adapterId, task.id])

  useEffect(() => {
    let cancelled = false
    void pluginClient.postJson<TaskSessionListResponse>("/api/boring-tasks/sessions/list", { adapterId: task.adapterId, taskId: task.id })
      .then((body) => {
        if (cancelled) return
        const links = body.links ?? []
        setSessionLinks(links)
        setSessionLinksLoaded(true)
        if (links.length > 0) void refreshSessionActivity(links).catch(() => undefined)
      })
      .catch(() => {
        if (!cancelled) setSessionLinksLoaded(true)
      })
    return () => { cancelled = true }
  }, [pluginClient, refreshSessionActivity, task.adapterId, task.id])

  useEffect(() => {
    if (!sessionLinksLoaded || visibleActivityLinks.length === 0) return
    const interval = window.setInterval(() => { void refreshSessionActivity(visibleActivityLinks).catch(() => undefined) }, TASK_SESSION_ACTIVITY_POLL_MS)
    return () => window.clearInterval(interval)
  }, [refreshSessionActivity, sessionLinksLoaded, visibleActivityLinks])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onSessionStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; working?: unknown }>).detail
      const sessionId = typeof detail?.sessionId === "string" ? detail.sessionId : null
      if (!sessionId || !linkedSessionIds.has(sessionId)) return
      setSessionActivities((current) => ({
        ...current,
        [sessionId]: { status: detail.working ? "working" : "idle", source: "live-runtime", updatedAt: new Date().toISOString() },
      }))
    }
    window.addEventListener("boring:chat-session-status", onSessionStatus)
    return () => window.removeEventListener("boring:chat-session-status", onSessionStatus)
  }, [linkedSessionIds])

  const openLinkedChat = async (link: BoringTaskSessionBinding, anchor?: WorkspaceShellAnchorRect) => {
    const sessions = await pluginClient.getJson<PiSessionSummary[]>(`/api/v1/agent/pi-chat/sessions?limit=1&activeSessionId=${encodeURIComponent(link.sessionId)}`)
    const session = sessions.find((candidate) => candidate.id === link.sessionId)
    if (!session) {
      setSessionPanelOpen(true)
      setSessionError("That linked chat session is no longer available. You can unlink it or link another session.")
      return
    }
    const title = session.title ?? link.title ?? chatTitle
    shell.openDetachedChat(link.sessionId, { anchor, title, composingEnabled: true })
    window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", { detail: { sessionId: link.sessionId, title, composingEnabled: true } }))
    void refreshSessionActivity([link]).catch(() => undefined)
  }

  const createAndLinkChat = async (anchor?: WorkspaceShellAnchorRect) => {
    setOpeningChat(true)
    setSessionError(null)
    try {
      const session = await pluginClient.postJson<CreatedPiChatSession>("/api/v1/agent/pi-chat/sessions", { title: chatTitle })
      if (typeof session.id !== "string" || session.id.length === 0) throw new Error("Chat session was not created.")
      let linked: BoringTaskSessionBinding
      try {
        const response = await pluginClient.postJson<TaskSessionLinkResponse>("/api/boring-tasks/sessions/link", {
          adapterId: task.adapterId,
          taskId: task.id,
          sessionId: session.id,
          title: chatTitle,
        })
        if (!response.link) throw new Error("Task session binding was not created.")
        linked = response.link
      } catch (error) {
        setSessionPanelOpen(true)
        setSessionError(`Created chat ${session.id}, but failed to bind it to this task. Use Link existing to attach it before opening. ${error instanceof Error ? error.message : ""}`.trim())
        return
      }
      setSessionLinks((current) => current.some((candidate) => candidate.id === linked.id) ? current : [linked, ...current])
      setSessionLinksLoaded(true)
      void refreshSessionActivity([linked]).catch(() => undefined)
      const initialDraft = taskChatDraft(task)
      shell.openDetachedChat(session.id, { anchor, title: chatTitle, initialDraft, composingEnabled: true })
      window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", { detail: { sessionId: session.id, title: chatTitle, initialDraft, composingEnabled: true } }))
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Failed to open task chat")
    } finally {
      setOpeningChat(false)
    }
  }

  const openTaskChat = (event: MouseEvent<HTMLButtonElement>) => {
    stopCardAction(event)
    const anchor = rectFromElement(event.currentTarget)
    setSessionError(null)
    void (async () => {
      const links = sessionLinksLoaded ? sessionLinks : await loadSessionLinks()
      if (links.length === 0) {
        await createAndLinkChat(anchor)
        return
      }
      const activity = await refreshSessionActivity(links).catch(() => sessionActivities)
      const working = links.filter((link) => activity[link.sessionId]?.status === "working")
      if (working.length === 1) {
        await openLinkedChat(working[0], anchor)
        return
      }
      setSessionPanelOpen((current) => working.length > 1 ? true : !current)
    })().catch((error) => setSessionError(error instanceof Error ? error.message : "Failed to open task chat"))
  }

  const unlinkSession = (event: MouseEvent<HTMLButtonElement>, link: BoringTaskSessionBinding) => {
    stopCardAction(event)
    setSessionError(null)
    setSessionLinks((current) => current.filter((candidate) => candidate.id !== link.id))
    setSessionActivities((current) => {
      const next = { ...current }
      delete next[link.sessionId]
      return next
    })
    void pluginClient.postJson("/api/boring-tasks/sessions/unlink", { bindingId: link.id })
      .catch((error) => {
        setSessionLinks((current) => current.some((candidate) => candidate.id === link.id) ? current : [link, ...current])
        setSessionError(error instanceof Error ? error.message : "Failed to unlink session")
      })
  }

  const searchExistingSessions = (event: MouseEvent<HTMLButtonElement>) => {
    stopCardAction(event)
    setLinkSearchLoading(true)
    setSessionError(null)
    void pluginClient.postJson<ManageSessionsSearchResponse>("/api/boring-tasks/sessions/search", { query: linkQuery })
      .then((body) => setLinkSearchResults(body.sessions ?? []))
      .catch((error) => setSessionError(error instanceof Error ? error.message : "Failed to search sessions"))
      .finally(() => setLinkSearchLoading(false))
  }

  const linkExistingSession = (event: MouseEvent<HTMLButtonElement>, session: PiSessionSummary) => {
    stopCardAction(event)
    setSessionError(null)
    void pluginClient.postJson<TaskSessionLinkResponse>("/api/boring-tasks/sessions/link", {
      adapterId: task.adapterId,
      taskId: task.id,
      sessionId: session.id,
      title: session.title ?? chatTitle,
    }).then((body) => {
      if (!body.link) throw new Error("Task session binding was not created.")
      setSessionLinks((current) => current.some((candidate) => candidate.id === body.link!.id) ? current : [body.link!, ...current])
      setSessionLinksLoaded(true)
      void refreshSessionActivity([body.link!]).catch(() => undefined)
    }).catch((error) => setSessionError(error instanceof Error ? error.message : "Failed to link session"))
  }

  const deleteTask = (event: MouseEvent<HTMLButtonElement>) => {
    stopCardAction(event)
    setMenuOpen(false)
    onDelete?.(task)
  }

  const chatButton = (
    <button type="button" draggable={false} onClick={openTaskChat} className="relative grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Open chat for ${taskDisplayRef(task)}. ${rollupText}${workingCount > 0 ? `, ${workingCount} working` : ""}.`} title={workingCount === 1 ? "Open working task chat" : "Open task chats"} disabled={openingChat} aria-expanded={sessionPanelOpen}>
      <MessageSquare className={["size-3.5", openingChat ? "motion-safe:animate-pulse" : ""].join(" ")} strokeWidth={1.75} />
      {activeCount > 0 ? <CircleDot className="absolute -bottom-0.5 -right-0.5 size-2.5 text-emerald-500 motion-safe:animate-pulse" aria-hidden="true" /> : null}
      {sessionLinks.length > 0 ? <span className={["absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold leading-4", workingCount > 0 ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground"].join(" ")} aria-label={workingCount > 0 ? `${workingCount} working linked chats` : `${sessionLinks.length} linked chats`}>{workingCount > 0 ? workingCount : sessionLinks.length}</span> : null}
      <span className="sr-only" aria-live="polite">Task chat activity: {rollupText}</span>
    </button>
  )

  const taskSessionPanel = sessionPanelOpen ? (
    <section className="mt-3 w-full rounded-xl border border-border bg-muted/20 p-2 text-xs" aria-label={`Linked chat sessions for ${taskDisplayRef(task)}`} onClick={(event) => event.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground">Task chats</span>
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close task chats" onClick={() => setSessionPanelOpen(false)}><X className="size-3" /></button>
      </div>
      {sessionError ? <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive" role="alert">{sessionError}</p> : null}
      {activityError ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-200" role="status">
          <span className="inline-flex min-w-0 items-center gap-1"><AlertCircle className="size-3 shrink-0" /> Activity refresh failed.</span>
          <button type="button" className="rounded-md px-2 py-0.5 font-medium hover:bg-amber-500/15" onClick={(event) => { stopCardAction(event); void refreshSessionActivity(visibleActivityLinks).catch(() => undefined) }}>Retry</button>
        </div>
      ) : null}
      {activityLoading && sessionLinks.length > 0 ? <p className="mb-2 text-[10px] text-muted-foreground" role="status">Checking chat activity…</p> : null}
      {sessionLinks.length > TASK_SESSION_ACTIVITY_MAX_IDS ? <p className="mb-2 text-[10px] text-muted-foreground">Activity is shown for the first {TASK_SESSION_ACTIVITY_MAX_IDS} linked chats.</p> : null}
      {sessionLinks.length > 0 ? (
        <ul className="space-y-1">
          {sortedSessionLinks.map((link) => {
            const activity = sessionActivities[link.sessionId]
            const statusText = activityLabel(activity, activityLoading)
            const isWorking = activity?.status === "working"
            return (
              <li key={link.id} className="flex items-center gap-2 rounded-lg bg-background/70 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{link.title ?? link.sessionId}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span>{relativeTime(activity?.updatedAt ?? link.createdAt)}</span>
                    <span className={["inline-flex items-center gap-1 font-medium", isWorking ? "text-emerald-600 dark:text-emerald-300" : activity?.status === "error" ? "text-destructive" : ""].join(" ")}>
                      <CircleDot className={["size-2", isWorking ? "motion-safe:animate-pulse" : ""].join(" ")} aria-hidden="true" />
                      {statusText}
                    </span>
                    {activity?.source === "persisted" ? <span>persisted</span> : null}
                  </div>
                </div>
                <button type="button" className="rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10" onClick={(event) => { stopCardAction(event); void openLinkedChat(link, rectFromElement(event.currentTarget)) }}>Open</button>
                <button type="button" className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={(event) => unlinkSession(event, link)}>Unlink</button>
              </li>
            )
          })}
        </ul>
      ) : <p className="text-muted-foreground">No linked chats yet.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-lg border border-border bg-background px-2 py-1 font-medium hover:bg-muted" disabled={openingChat} onClick={(event) => { stopCardAction(event); void createAndLinkChat(rectFromElement(event.currentTarget)) }}>Start new chat</button>
        <label className="flex min-w-0 flex-1 items-center gap-1">
          <span className="sr-only">Search existing chats</span>
          <input className="min-w-24 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-foreground" value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="Search chats" />
        </label>
        <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 font-medium hover:bg-muted" disabled={linkSearchLoading} onClick={searchExistingSessions}><Link2 className="size-3" /> Link existing</button>
      </div>
      {linkSearchResults.length > 0 ? (
        <ul className="mt-2 space-y-1" aria-label="Session search results">
          {linkSearchResults.map((session) => (
            <li key={session.id} className="flex items-center gap-2 rounded-lg bg-background/70 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">{session.title ?? session.id}</span>
              <button type="button" className="rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10" disabled={sessionLinks.some((link) => link.sessionId === session.id)} onClick={(event) => linkExistingSession(event, session)}>Link</button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  ) : null

  if (compact) {
    return (
      <article
        draggable={draggable}
        onDragStart={(event) => onDragStart(event, task)}
        onDragEnd={onDragEnd}
        className={[
          "group flex min-w-0 flex-wrap items-center gap-2 rounded-xl border bg-background px-3 py-2 shadow-sm transition",
          draggable ? "cursor-grab hover:border-foreground/30 hover:shadow-md active:cursor-grabbing" : "cursor-default",
          unmapped ? "border-dashed border-amber-400/60 bg-amber-500/5" : "border-border",
        ].join(" ")}
        data-task-id={task.id}
      >
        <span className="shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{task.number}</span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={task.title}>{task.title}</h3>
        {task.epic ? <span className="hidden max-w-36 shrink-0 truncate rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary sm:inline-block">{task.epic.title}</span> : null}
        {tags.slice(0, 2).map((tag) => <span key={tag} className="hidden max-w-28 shrink-0 truncate rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground md:inline-block">{tag}</span>)}
        {pullRequests.slice(0, 1).map((pr) => pr.url ? (
          <a key={pr.id} href={pr.url} target="_blank" rel="noreferrer" draggable={false} onClick={(event) => event.stopPropagation()} className="hidden max-w-64 shrink-0 truncate rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300 lg:inline-block" title={pr.title} aria-label={`Open pull request ${pr.number}: ${pr.title}`}>
            PR {pr.number} <span className="font-medium">{pr.title}</span>
          </a>
        ) : (
          <span key={pr.id} className="hidden max-w-64 shrink-0 truncate rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 lg:inline-block" title={pr.title}>PR {pr.number} <span className="font-medium">{pr.title}</span></span>
        ))}
        <div className="flex shrink-0 items-center gap-0.5">
          {chatButton}
          {task.url ? (
            <a href={task.url} target="_blank" rel="noreferrer" draggable={false} onClick={(event) => event.stopPropagation()} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Open ${task.number} in native task system`} title="Open in native task system">
              <ExternalLinkGlyph className="size-3.5" />
            </a>
          ) : null}
          <div className="relative">
            <button type="button" draggable={false} onClick={(event) => { stopCardAction(event); setMenuOpen((current) => !current) }} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Open actions for ${task.number}`} aria-expanded={menuOpen} title="Task actions">
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl">
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={!deleteEnabled} onClick={deleteTask} title={deleteEnabled ? "Delete issue" : "This task source cannot delete issues"}>
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                  Delete issue
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {taskSessionPanel}
      </article>
    )
  }

  return (
    <article
      draggable={draggable}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      className={[
        "group rounded-xl border bg-background p-3 shadow-sm transition",
        draggable ? "cursor-grab hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-md active:cursor-grabbing" : "cursor-default",
        unmapped ? "border-dashed border-amber-400/60 bg-amber-500/5" : "border-border",
      ].join(" ")}
      data-task-id={task.id}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{task.number}</span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-foreground" title={task.title}>{task.title}</h3>
        <div className="flex shrink-0 items-center gap-0.5">
          {chatButton}
          {task.url ? (
            <a href={task.url} target="_blank" rel="noreferrer" draggable={false} onClick={(event) => event.stopPropagation()} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Open ${task.number} in native task system`} title="Open in native task system">
              <ExternalLinkGlyph className="size-3.5" />
            </a>
          ) : null}
          <div className="relative">
            <button type="button" draggable={false} onClick={(event) => { stopCardAction(event); setMenuOpen((current) => !current) }} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Open actions for ${task.number}`} aria-expanded={menuOpen} title="Task actions">
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl">
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={!deleteEnabled} onClick={deleteTask} title={deleteEnabled ? "Delete issue" : "This task source cannot delete issues"}>
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                  Delete issue
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {taskSessionPanel}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {unmapped ? <span className="rounded-full border border-amber-400/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">Unmapped</span> : null}
        {task.epic ? <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{task.epic.title}</span> : null}
        {tags.map((tag) => <span key={tag} className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span>)}
        {hiddenTagCount > 0 ? <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">+{hiddenTagCount}</span> : null}
      </div>
      {pullRequests.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
          {pullRequests.map((pr) => pr.url ? (
            <a key={pr.id} href={pr.url} target="_blank" rel="noreferrer" draggable={false} onClick={(event) => event.stopPropagation()} className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300" title={pr.title} aria-label={`Open pull request ${pr.number}: ${pr.title}`}>
              <span className="shrink-0">PR {pr.number}</span><span className="truncate font-medium">{pr.title}</span>
            </a>
          ) : (
            <span key={pr.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300" title={pr.title}>
              <span className="shrink-0">PR {pr.number}</span><span className="truncate font-medium">{pr.title}</span>
            </span>
          ))}
          {hiddenPullRequestCount > 0 ? <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">+{hiddenPullRequestCount} PR</span> : null}
        </div>
      ) : null}
    </article>
  )
}
