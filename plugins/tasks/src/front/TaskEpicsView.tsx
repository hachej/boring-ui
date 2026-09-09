import { useId, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import type { BoringTaskCard } from "../shared"
import { NO_EPIC_GROUP_KEY, isTerminalColumnId, type TaskEpicGroup } from "./taskEpicsModel"

interface TaskEpicsViewProps {
  groups: readonly TaskEpicGroup[]
  hiddenEpicCount: number
  hiddenTaskCount: number
  showClosed: boolean
  onShowClosedChange: (showClosed: boolean) => void
  expandedEpicKeys: ReadonlySet<string>
  onToggleEpic: (key: string) => void
  renderTask: (task: BoringTaskCard) => ReactNode
}

function StatusPill({ title, count, color, terminal }: { title: string; count: number; color?: string; terminal: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4",
        terminal ? "border-border/60 bg-muted/30 text-muted-foreground" : "border-border bg-background text-foreground",
      ].join(" ")}
    >
      {color ? <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" /> : null}
      <span className="truncate">{title}</span>
      <span className="tabular-nums font-medium">{count}</span>
    </span>
  )
}

export function TaskEpicsView({
  groups,
  hiddenEpicCount,
  hiddenTaskCount,
  showClosed,
  onShowClosedChange,
  expandedEpicKeys,
  onToggleEpic,
  renderTask,
}: TaskEpicsViewProps) {
  const panelIdPrefix = useId()
  const activeCount = groups.filter((group) => group.active).length

  return (
    <div className="boring-scrollbar-discreet flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-8 overflow-hidden rounded-lg border border-border bg-background text-xs shadow-sm" role="group" aria-label="Epic activity filter">
          <button
            type="button"
            className={["px-3 font-medium", !showClosed ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"].join(" ")}
            onClick={() => onShowClosedChange(false)}
            aria-pressed={!showClosed}
          >
            Active epics
          </button>
          <button
            type="button"
            className={["px-3 font-medium", showClosed ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"].join(" ")}
            onClick={() => onShowClosedChange(true)}
            aria-pressed={showClosed}
          >
            All epics
          </button>
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {showClosed
            ? `${groups.length} epic${groups.length === 1 ? "" : "s"} · ${activeCount} active`
            : hiddenEpicCount > 0
              ? `${groups.length} active · ${hiddenEpicCount} fully closed epic${hiddenEpicCount === 1 ? "" : "s"} (${hiddenTaskCount} task${hiddenTaskCount === 1 ? "" : "s"}) hidden`
              : `${groups.length} active epic${groups.length === 1 ? "" : "s"} · none hidden`}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {hiddenEpicCount > 0
            ? `No active epics. ${hiddenEpicCount} fully closed epic${hiddenEpicCount === 1 ? " is" : "s are"} hidden — switch to “All epics” to see them.`
            : "No epics match the current filters."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const expanded = expandedEpicKeys.has(group.key)
            const panelId = `${panelIdPrefix}-${encodeURIComponent(group.key)}`
            const unassigned = group.key === NO_EPIC_GROUP_KEY
            return (
              <section
                key={group.key}
                className={[
                  "rounded-2xl border bg-muted/20",
                  unassigned ? "border-dashed border-border/70" : group.active ? "border-border/80" : "border-border/50 bg-muted/10",
                ].join(" ")}
              >
                <h3 className="m-0">
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-2xl p-3 text-left hover:bg-muted/50"
                    onClick={() => onToggleEpic(group.key)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                  >
                    <ChevronRight
                      className={["mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", expanded ? "rotate-90" : ""].join(" ")}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{group.title}</span>
                        {group.epicId ? (
                          <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                            {group.epicId}
                          </span>
                        ) : null}
                        {!group.active && !unassigned ? (
                          <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">Closed</span>
                        ) : null}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {group.statuses.map((status) => (
                          <StatusPill
                            key={status.columnId}
                            title={status.title}
                            count={status.count}
                            {...(status.color ? { color: status.color } : {})}
                            terminal={isTerminalColumnId(status.columnId)}
                          />
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {group.openCount}/{group.taskCount}
                      <span className="sr-only"> open of {group.taskCount} tasks</span>
                    </span>
                  </button>
                </h3>
                <div id={panelId} hidden={!expanded}>
                  {expanded ? (
                    <div className="flex flex-col gap-2 border-t border-border/70 p-2">
                      {group.tasks.map((task) => renderTask(task))}
                    </div>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
