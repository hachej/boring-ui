import { useEffect, useMemo, useState } from "react"
import { IconButton } from "@hachej/boring-ui-kit"
import { useAppLeftOverlayChrome, type BoringFrontAppLeftOverlayProps } from "@hachej/boring-workspace/plugin"
import { X } from "lucide-react"
import type { BoringTaskAdapter } from "../shared"
import { createGitHubIssuesAdapter } from "./githubIssuesAdapter"
import { createHttpTaskAdapter, listHttpTaskSources } from "./httpTaskAdapter"
import { createMockTaskAdapter } from "./mockAdapter"
import { TaskKanbanBoard } from "./TaskKanbanBoard"

const demoAdapters = [
  createMockTaskAdapter(),
  createGitHubIssuesAdapter({ owner: "hachej", repo: "boring-ui" }),
]

function TasksGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.75 6.9l.45.45 1.05-1.2M4.75 11.9l.45.45 1.05-1.2M4.75 16.9l.45.45 1.05-1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TasksOverlay({ onClose }: BoringFrontAppLeftOverlayProps) {
  const { headerInsetStart, headerInsetEnd } = useAppLeftOverlayChrome()
  const [httpAdapters, setHttpAdapters] = useState<BoringTaskAdapter[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadSources = async () => {
      try {
        const sources = await listHttpTaskSources()
        if (!cancelled) setHttpAdapters(sources.map((source) => createHttpTaskAdapter(source)))
      } catch {
        if (!cancelled) setHttpAdapters([])
      }
    }
    void loadSources()
    return () => { cancelled = true }
  }, [])

  const adapters = useMemo(() => {
    if (httpAdapters === null) return null
    if (httpAdapters.length > 0) return httpAdapters
    return demoAdapters
  }, [httpAdapters])

  return (
    <div data-boring-workspace-part="tasks-overlay" className="flex h-full min-h-0 flex-col bg-background">
      <header className={[
        "flex h-12 shrink-0 items-center justify-between border-b border-border/60",
        headerInsetStart ? "pl-12" : "pl-4",
        headerInsetEnd ? "pr-16" : "pr-4",
      ].join(" ")}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <TasksGlyph className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">Tasks</h2>
            <p className="truncate text-xs text-muted-foreground">Adapter-mapped Kanban board</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close tasks"
            title="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>
      {adapters ? (
        <TaskKanbanBoard adapters={adapters} />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center p-4 text-sm text-muted-foreground">Loading task sources…</div>
      )}
    </div>
  )
}

export { TasksGlyph }
