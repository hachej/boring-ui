"use client"

import { useContext, useEffect, useRef, useState } from "react"
import type { DockviewApi } from "dockview-react"
import { ChevronRight, FolderTree, X } from "lucide-react"
import { cn } from "../../lib/utils"
import { ChatShellContext } from "./context"

export interface WorkbenchTopBarProps {
  api: DockviewApi | null
  collapsed: boolean
  onExpandFiles: () => void
  className?: string
}

interface TabInfo {
  id: string
  title: string
}

export function WorkbenchTopBar({ api, collapsed, onExpandFiles, className }: WorkbenchTopBarProps) {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const shell = useContext(ChatShellContext)

  useEffect(() => {
    if (!api) return
    const sync = () => {
      setTabs(api.panels.map((p) => ({ id: p.id, title: (p.title ?? p.id) as string })))
      setActiveId(api.activePanel?.id ?? null)
    }
    sync()
    const d1 = api.onDidAddPanel(sync)
    const d2 = api.onDidRemovePanel(sync)
    const d3 = api.onDidActivePanelChange(sync)
    return () => {
      d1.dispose()
      d2.dispose()
      d3.dispose()
    }
  }, [api])

  const activate = (id: string) => {
    if (!api) return
    const panel = api.getPanel(id)
    panel?.api.setActive()
  }

  const close = (id: string) => {
    if (!api) return
    const panel = api.getPanel(id)
    if (panel) api.removePanel(panel)
  }

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const reorder = (draggedId: string, targetId: string) => {
    if (!api || draggedId === targetId) return
    const fromIndex = tabs.findIndex((t) => t.id === draggedId)
    const toIndex = tabs.findIndex((t) => t.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const panel = api.getPanel(draggedId)
    const target = api.getPanel(targetId)
    if (!panel || !target) return
    try {
      // dockview-react: panel.api.moveTo({ group, position: { index } }) — use when available
      const moveFn = (panel.api as unknown as { moveTo?: (o: unknown) => void }).moveTo
      if (moveFn) {
        moveFn.call(panel.api, { group: target.group, position: { index: toIndex } })
      }
    } catch {
      // noop — dockview version may differ
    }
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 border-b border-border/40 bg-background px-1",
        className,
      )}
      style={{ height: 44 }}
    >
      {collapsed && (
        <button
          type="button"
          onClick={onExpandFiles}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          aria-label="Show files"
          title="Show files"
        >
          <FolderTree className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.length === 0 ? (
          <span className="px-2 text-xs text-muted-foreground/80">No file open</span>
        ) : (
          tabs.map((tab) => (
            <TabButton
              key={tab.id}
              title={tab.title}
              active={tab.id === activeId}
              draggedId={dragId}
              overId={overId}
              tabId={tab.id}
              onActivate={() => activate(tab.id)}
              onClose={() => close(tab.id)}
              onDragStart={() => setDragId(tab.id)}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onDragOver={() => setOverId(tab.id)}
              onDrop={() => {
                if (dragId) reorder(dragId, tab.id)
                setDragId(null)
                setOverId(null)
              }}
            />
          ))
        )}
      </div>

      {shell && (
        <button
          type="button"
          onClick={() => shell.setSurfaceOpen(false)}
          className={cn(
            "ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          aria-label="Close workbench"
          title="Close workbench (⌘2)"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

function TabButton({
  title,
  active,
  tabId,
  draggedId,
  overId,
  onActivate,
  onClose,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  title: string
  active: boolean
  tabId: string
  draggedId: string | null
  overId: string | null
  onActivate: () => void
  onClose: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDrop: () => void
}) {
  const isDragging = draggedId === tabId
  const isDropTarget = overId === tabId && draggedId && draggedId !== tabId
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      draggable
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onActivate()
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", tabId)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      className={cn(
        "group flex h-8 min-w-[120px] max-w-[240px] shrink-0 cursor-pointer items-center gap-2 rounded-sm pl-3 pr-1 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-background text-foreground shadow-[inset_0_-2px_0_0_var(--primary)]"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
        isDragging && "opacity-40",
        isDropTarget && "ring-2 ring-primary/60",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded",
          "text-muted-foreground opacity-0 transition-opacity",
          "hover:bg-muted hover:text-foreground",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          active && "opacity-60 hover:opacity-100",
        )}
        aria-label={`Close ${title}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
