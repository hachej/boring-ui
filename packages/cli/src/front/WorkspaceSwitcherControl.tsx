import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button, Kbd } from "@hachej/boring-ui-kit"
import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react"

export interface WorkspaceSwitcherControlItem {
  id: string
  name: string
  available?: boolean
  path?: string
}

export interface WorkspaceSwitcherControlProps {
  appTitle?: string
  workspaces: WorkspaceSwitcherControlItem[]
  activeWorkspaceId?: string | null
  emptyLabel?: string
  createLabel?: string
  createDescription?: string
  settingsLabel?: string
  settingsDescription?: string
  onSelectWorkspace: (workspaceId: string) => void
  onCreateWorkspace?: () => void
  onOpenWorkspaceSettings?: (workspaceId: string) => void
}

function workspaceInitial(name: string): string {
  return (name.trim()[0] ?? "W").toUpperCase()
}

function nextAvailableIndex(
  workspaces: WorkspaceSwitcherControlItem[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (workspaces.length === 0) return -1
  for (let step = 1; step <= workspaces.length; step++) {
    const index = (currentIndex + direction * step + workspaces.length) % workspaces.length
    if (workspaces[index]?.available !== false) return index
  }
  return -1
}

export function WorkspaceSwitcherControl({
  appTitle = "Boring",
  workspaces,
  activeWorkspaceId,
  emptyLabel = "Create your first workspace",
  createLabel = "Create workspace",
  createDescription = "Start a clean project space",
  settingsLabel = "Workspace settings",
  settingsDescription = "Rename, runtime, deletion",
  onSelectWorkspace,
  onCreateWorkspace,
  onOpenWorkspaceSettings,
}: WorkspaceSwitcherControlProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const currentWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const switcherLabel = currentWorkspace?.name ?? "Select workspace"
  const currentIndex = useMemo(
    () => workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId && workspace.available !== false),
    [activeWorkspaceId, workspaces],
  )
  const firstAvailableIndex = useMemo(
    () => workspaces.findIndex((workspace) => workspace.available !== false),
    [workspaces],
  )
  const [activeIndex, setActiveIndex] = useState(() => currentIndex >= 0 ? currentIndex : firstAvailableIndex)

  const resetActiveIndex = useCallback(() => {
    const next = currentIndex >= 0 ? currentIndex : firstAvailableIndex
    setActiveIndex(next)
    window.setTimeout(() => itemRefs.current[next]?.focus(), 0)
  }, [currentIndex, firstAvailableIndex])

  const openPicker = useCallback(() => {
    setOpen(true)
    triggerRef.current?.focus()
    resetActiveIndex()
  }, [resetActiveIndex])

  const closePicker = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const moveActiveWorkspace = useCallback((direction: 1 | -1) => {
    setActiveIndex((index) => {
      const base = index >= 0 ? index : (currentIndex >= 0 ? currentIndex : firstAvailableIndex)
      const next = nextAvailableIndex(workspaces, base, direction)
      window.setTimeout(() => itemRefs.current[next]?.focus(), 0)
      return next
    })
  }, [currentIndex, firstAvailableIndex, workspaces])

  const selectWorkspaceAt = useCallback((index: number) => {
    const workspace = workspaces[index]
    if (!workspace || workspace.available === false) return
    onSelectWorkspace(workspace.id)
    setOpen(false)
  }, [onSelectWorkspace, workspaces])

  const selectActiveWorkspace = useCallback(() => {
    selectWorkspaceAt(activeIndex)
  }, [activeIndex, selectWorkspaceAt])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return

      if (event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey && (event.key.toLowerCase() === "k" || event.code === "KeyK")) {
        event.preventDefault()
        event.stopPropagation()
        openPicker()
        return
      }

      if (!open) return
      if (event.metaKey || event.altKey || event.ctrlKey) return

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        moveActiveWorkspace(event.key === "ArrowDown" ? 1 : -1)
        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
        selectActiveWorkspace()
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        closePicker()
      }
    }

    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [closePicker, moveActiveWorkspace, open, openPicker, selectActiveWorkspace])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [open])

  useEffect(() => {
    if (open) resetActiveIndex()
  }, [open, resetActiveIndex])

  if (workspaces.length === 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onCreateWorkspace}
        disabled={!onCreateWorkspace}
        className="-ml-1 h-8 gap-2 rounded-md px-1 pr-2.5 hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          style={{ width: 28, height: 28 }}
          className="flex shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
        >
          {appTitle.charAt(0).toUpperCase()}
        </span>
        <span className="text-[13px] font-medium text-foreground">
          {emptyLabel}
        </span>
      </Button>
    )
  }

  return (
    <div ref={rootRef} className="-ml-1 flex h-8 min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        style={{ width: 28, height: 28 }}
        className="flex shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
      >
        {appTitle.charAt(0).toUpperCase()}
      </span>
      <span className="truncate text-[13px] font-medium text-foreground">
        {appTitle}
      </span>
      <span aria-hidden="true" className="text-muted-foreground/30">/</span>

      <div className="relative min-w-0">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="boring-local-workspace-picker"
          aria-label={`Workspace menu: ${switcherLabel}`}
          title="Workspace picker (⌘⇧K)"
          onClick={() => {
            if (open) {
              setOpen(false)
              return
            }
            openPicker()
          }}
          className="group h-8 min-w-0 justify-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="max-w-[15rem] truncate text-[13px] font-normal text-muted-foreground">
            {switcherLabel}
          </span>
          <Kbd className="ml-1 border-0 bg-transparent p-0 text-[10px] leading-none text-muted-foreground/60 shadow-none group-hover:text-muted-foreground">⌘⇧K</Kbd>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
        </Button>

        {open ? (
          <div
            id="boring-local-workspace-picker"
            role="listbox"
            aria-label="Workspaces"
            aria-activedescendant={activeIndex >= 0 ? `boring-workspace-option-${workspaces[activeIndex]?.id}` : undefined}
            className="absolute left-0 top-full z-50 mt-1.5 w-[21rem] rounded-xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-2xl"
          >
            <div className="max-h-80 overflow-y-auto">
              {workspaces.map((workspace, index) => {
                const isCurrent = currentWorkspace?.id === workspace.id
                const isActive = activeIndex === index
                const available = workspace.available !== false
                return (
                  <button
                    ref={(node) => { itemRefs.current[index] = node }}
                    id={`boring-workspace-option-${workspace.id}`}
                    key={workspace.id}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    disabled={!available}
                    data-current={isCurrent ? "true" : "false"}
                    data-active={isActive ? "true" : "false"}
                    onFocus={() => setActiveIndex(index)}
                    onMouseEnter={() => { if (available) setActiveIndex(index) }}
                    onClick={() => selectWorkspaceAt(index)}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[13px] outline-none disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-foreground/[0.06] data-[active=true]:text-foreground data-[current=true]:bg-foreground/[0.08] data-[current=true]:text-foreground"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-xs font-semibold text-muted-foreground">
                      {workspaceInitial(workspace.name)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{workspace.name}</span>
                      {available ? (
                        workspace.path ? <span className="truncate text-xs text-muted-foreground">{workspace.path}</span> : null
                      ) : (
                        <span className="truncate text-xs text-destructive">Folder unavailable</span>
                      )}
                    </span>
                    {isCurrent ? <Check className="h-4 w-4 text-foreground" aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>

            {(onCreateWorkspace || (currentWorkspace && onOpenWorkspaceSettings)) ? <div className="-mx-1.5 my-1 h-px bg-border" /> : null}

            {onCreateWorkspace ? (
              <button
                type="button"
                aria-label={createLabel}
                onClick={onCreateWorkspace}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[13px] outline-none hover:bg-foreground/[0.06] focus:bg-foreground/[0.06] focus:text-foreground"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span>{createLabel}</span>
                  <span className="text-xs text-muted-foreground">{createDescription}</span>
                </span>
              </button>
            ) : null}

            {currentWorkspace && onOpenWorkspaceSettings ? (
              <button
                type="button"
                aria-label={settingsLabel}
                onClick={() => onOpenWorkspaceSettings(currentWorkspace.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[13px] outline-none hover:bg-foreground/[0.06] focus:bg-foreground/[0.06] focus:text-foreground"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span>{settingsLabel}</span>
                  <span className="text-xs text-muted-foreground">{settingsDescription}</span>
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
