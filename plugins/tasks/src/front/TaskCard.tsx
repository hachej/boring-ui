import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react"
import { MessageSquarePlus, MoreHorizontal, Trash2 } from "lucide-react"
import { emitWorkspaceTaskProvenanceChanged, useWorkspacePluginClient, type WorkspacePluginClient } from "@hachej/boring-workspace"
import { useWorkspaceShellCapabilities, type WorkspaceShellAnchorRect, type WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard } from "../shared"
import { TaskSessionDisclosure, TASK_SESSION_LINKS_CHANGED_EVENT } from "./TaskSessionDisclosure"
import { TaskAttentionDisclosure } from "./TaskAttentionDisclosure"
import type { TaskAttentionItem } from "./useTaskAttention"

interface TaskCardProps {
  task: BoringTaskCard
  draggable: boolean
  unmapped?: boolean
  deleteEnabled?: boolean
  compact?: boolean
  attention?: readonly TaskAttentionItem[]
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

function taskChatDraft(task: BoringTaskCard): string {
  return [
    `Let's work on ${task.number}: ${task.title}`,
    "",
    `Task ID: ${task.number}`,
    `Status: ${task.statusId}`,
    task.url ? `URL: ${task.url}` : null,
  ].filter(Boolean).join("\n")
}

export function openBrowserLocalTaskChat(
  task: BoringTaskCard,
  anchor: WorkspaceShellAnchorRect,
  shell: WorkspaceShellCapabilities,
  pluginClient: Pick<WorkspacePluginClient, "postJson">,
) {
  const title = `${task.number}: ${task.title}`
  const options = {
    anchor,
    title,
    initialDraft: taskChatDraft(task),
    composingEnabled: true,
    onNativeSessionPersisted: async (sessionId: string) => {
      await pluginClient.postJson("/api/boring-tasks/sessions/link", {
        adapterId: task.adapterId,
        taskId: task.id,
        sessionId,
      })
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(TASK_SESSION_LINKS_CHANGED_EVENT, {
          detail: { adapterId: task.adapterId, taskId: task.id },
        }))
        emitWorkspaceTaskProvenanceChanged()
      }
    },
  }
  const result = shell.openBrowserLocalDetachedChat(options)
  if (result.success || typeof window === "undefined") return result
  window.dispatchEvent(new CustomEvent("boring-workspace:open-browser-local-detached-chat", { detail: options }))
  return { success: true as const }
}

export function TaskCard({ task, draggable, unmapped = false, deleteEnabled = false, compact = false, attention = [], onDelete, onDragStart, onDragEnd }: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [menuOpen])
  const shell = useWorkspaceShellCapabilities()
  const pluginClient = useWorkspacePluginClient()
  const tags = task.tags?.slice(0, 4) ?? []
  const hiddenTagCount = Math.max((task.tags?.length ?? 0) - tags.length, 0)
  const pullRequests = task.pullRequests?.slice(0, 2) ?? []
  const hiddenPullRequestCount = Math.max((task.pullRequests?.length ?? 0) - pullRequests.length, 0)

  const stopCardAction = (event: MouseEvent<HTMLElement>) => event.stopPropagation()

  const openTaskChat = (event: MouseEvent<HTMLButtonElement>) => {
    stopCardAction(event)
    const result = openBrowserLocalTaskChat(task, rectFromElement(event.currentTarget), shell, pluginClient)
    if (!result.success) console.error("Failed to open task chat", result.message)
  }

  const deleteTask = (event: MouseEvent<HTMLButtonElement>) => {
    stopCardAction(event)
    setMenuOpen(false)
    onDelete?.(task)
  }

  if (compact) {
    return (
      <article
        draggable={draggable}
        onDragStart={(event) => onDragStart(event, task)}
        onDragEnd={onDragEnd}
        className={[
          "group flex min-w-0 items-center gap-2 rounded-xl border bg-background px-3 py-2 shadow-sm transition",
          draggable ? "cursor-grab hover:border-foreground/30 hover:shadow-md active:cursor-grabbing" : "cursor-default",
          unmapped ? "border-dashed border-amber-400/60 bg-amber-500/5" : "border-border",
          "flex-wrap",
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
          <button type="button" draggable={false} onClick={openTaskChat} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Start new chat for ${task.number}`} title="Start new task chat">
            <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
          </button>
          <div ref={menuRef} className="relative">
            <button type="button" draggable={false} onClick={(event) => { stopCardAction(event); setMenuOpen((current) => !current) }} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Open actions for ${task.number}`} aria-expanded={menuOpen} title="Task actions">
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl">
                {task.url ? (
                  <a href={task.url} target="_blank" rel="noreferrer" draggable={false} onClick={(event) => { event.stopPropagation(); setMenuOpen(false) }} className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left hover:bg-muted" aria-label={`Open ${task.number} in native task system`}>
                    <ExternalLinkGlyph className="size-3.5 shrink-0" />
                    Open source task
                  </a>
                ) : null}
                <div className="my-1 border-t border-border/60" />
                <button type="button" className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={!deleteEnabled} onClick={deleteTask} title={deleteEnabled ? "Delete issue" : "This task source cannot delete issues"}>
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                  Delete issue
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="w-full shrink-0 pt-0.5">
          <TaskAttentionDisclosure items={attention} shell={shell} />
          <TaskSessionDisclosure task={task} shell={shell} pluginClient={pluginClient} />
        </div>
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
          <button type="button" draggable={false} onClick={openTaskChat} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Start new chat for ${task.number}`} title="Start new task chat">
            <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
          </button>
          <div ref={menuRef} className="relative">
            <button type="button" draggable={false} onClick={(event) => { stopCardAction(event); setMenuOpen((current) => !current) }} className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label={`Open actions for ${task.number}`} aria-expanded={menuOpen} title="Task actions">
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl">
                {task.url ? (
                  <a href={task.url} target="_blank" rel="noreferrer" draggable={false} onClick={(event) => { event.stopPropagation(); setMenuOpen(false) }} className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left hover:bg-muted" aria-label={`Open ${task.number} in native task system`}>
                    <ExternalLinkGlyph className="size-3.5 shrink-0" />
                    Open source task
                  </a>
                ) : null}
                <div className="my-1 border-t border-border/60" />
                <button type="button" className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={!deleteEnabled} onClick={deleteTask} title={deleteEnabled ? "Delete issue" : "This task source cannot delete issues"}>
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                  Delete issue
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
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
      <div className="mt-2 border-t border-border/60 pt-1">
        <TaskAttentionDisclosure items={attention} shell={shell} />
        <TaskSessionDisclosure task={task} shell={shell} pluginClient={pluginClient} />
      </div>
    </article>
  )
}
