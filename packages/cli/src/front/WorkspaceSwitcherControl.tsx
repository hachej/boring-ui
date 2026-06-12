import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
} from "@hachej/boring-ui-kit"
import { ChevronsUpDown, Plus, Settings } from "lucide-react"

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
  getWorkspaceHref?: (workspaceId: string) => string
  onCreateWorkspace?: () => void
  onOpenWorkspaceSettings?: (workspaceId: string) => void
}

function workspaceInitial(name: string): string {
  return (name.trim()[0] ?? "W").toUpperCase()
}

function OpenInNewTabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
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
  getWorkspaceHref,
  onCreateWorkspace,
  onOpenWorkspaceSettings,
}: WorkspaceSwitcherControlProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Low-collision Mac shortcut. Avoid common browser/app shortcuts like
      // Cmd+K, Cmd+P, Cmd+O, Cmd+W, Cmd+L, Cmd+F, Cmd+R, Cmd+S. Do not ignore
      // editable targets: the chat composer is usually focused, and Cmd+Shift+K
      // does not insert text.
      if (event.isComposing) return
      if (!event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey) return
      if (event.key.toLowerCase() !== "k" && event.code !== "KeyK") return
      event.preventDefault()
      event.stopPropagation()
      triggerRef.current?.focus()
      setActiveIndex(currentIndex >= 0 ? currentIndex : firstAvailableIndex)
      setOpen(true)
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [currentIndex, firstAvailableIndex])

  useEffect(() => {
    if (!open) return
    const next = currentIndex >= 0 ? currentIndex : firstAvailableIndex
    setActiveIndex(next)
    window.setTimeout(() => itemRefs.current[next]?.focus(), 0)
  }, [currentIndex, firstAvailableIndex, open])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) setActiveIndex(currentIndex >= 0 ? currentIndex : firstAvailableIndex)
    setOpen(nextOpen)
  }, [currentIndex, firstAvailableIndex])

  const selectActiveWorkspace = useCallback(() => {
    const workspace = workspaces[activeIndex]
    if (!workspace || workspace.available === false) return
    onSelectWorkspace(workspace.id)
    setOpen(false)
  }, [activeIndex, onSelectWorkspace, workspaces])

  const moveActiveWorkspace = useCallback((direction: 1 | -1) => {
    setActiveIndex((index) => {
      const base = index >= 0 ? index : (currentIndex >= 0 ? currentIndex : firstAvailableIndex)
      const next = nextAvailableIndex(workspaces, base, direction)
      window.setTimeout(() => itemRefs.current[next]?.focus(), 0)
      return next
    })
  }, [currentIndex, firstAvailableIndex, workspaces])

  const handlePickerNavigationKey = useCallback((event: KeyboardEvent | ReactKeyboardEvent) => {
    if (!open) return
    if (event.target instanceof Element && event.target.closest('[data-workspace-new-tab-button="true"]')) return
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
      setOpen(false)
      triggerRef.current?.focus()
    }
  }, [moveActiveWorkspace, open, selectActiveWorkspace])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => handlePickerNavigationKey(event)
    // Capture globally so navigation still works if the chat composer/browser
    // focus does not land on the menu after the shortcut opens it.
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [handlePickerNavigationKey, open])

  const handleMenuKeyDown = useCallback((event: ReactKeyboardEvent) => {
    handlePickerNavigationKey(event)
  }, [handlePickerNavigationKey])

  const openWorkspaceInNewTab = useCallback((workspaceId: string) => {
    const href = getWorkspaceHref?.(workspaceId) ?? `/workspace/${encodeURIComponent(workspaceId)}`
    window.open(href, "_blank", "noopener,noreferrer")
  }, [getWorkspaceHref])

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
    <div className="-ml-1 flex h-8 min-w-0 items-center gap-1.5">
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

      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            aria-label={`Workspace menu: ${switcherLabel}`}
            title="Workspace picker (⌘⇧K)"
            className="group h-8 min-w-0 justify-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="max-w-[15rem] truncate text-[13px] font-normal text-muted-foreground">
              {switcherLabel}
            </span>
            <Kbd className="ml-1 border-0 bg-transparent p-0 text-[10px] leading-none text-muted-foreground/60 shadow-none group-hover:text-muted-foreground">⌘⇧K</Kbd>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={6}
          onKeyDownCapture={handleMenuKeyDown}
          className="w-[21rem] rounded-xl border-border/70 bg-popover p-1.5 text-popover-foreground shadow-2xl"
        >
          <div className="max-h-80 overflow-y-auto">
            {workspaces.map((workspace, index) => {
              const isCurrent = currentWorkspace?.id === workspace.id
              const isActive = activeIndex === index
              const available = workspace.available !== false
              return (
                <div key={workspace.id} className="group relative w-full">
                  <DropdownMenuItem
                    ref={(node) => { itemRefs.current[index] = node }}
                    aria-label={available ? workspace.name : `${workspace.name}. Folder unavailable.`}
                    data-current={isCurrent ? "true" : "false"}
                    data-active={isActive ? "true" : "false"}
                    disabled={!available}
                    onFocus={() => setActiveIndex(index)}
                    onPointerMove={() => { if (available) setActiveIndex(index) }}
                    onSelect={() => onSelectWorkspace(workspace.id)}
                    style={{
                      paddingRight: 72,
                      backgroundColor: isActive
                        ? "color-mix(in oklch, var(--foreground) 10%, transparent)"
                        : isCurrent
                          ? "color-mix(in oklch, var(--foreground) 5%, transparent)"
                          : undefined,
                    }}
                    className="relative gap-3 rounded-lg px-2.5 py-2.5 pl-3 text-[13px] focus:text-foreground data-[active=true]:text-foreground data-[current=true]:text-foreground"
                  >
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: isActive ? "var(--foreground)" : "transparent" }}
                      className="absolute bottom-2 left-1 top-2 w-0.5 rounded-full"
                    />
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
                  </DropdownMenuItem>
                  {available ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-workspace-new-tab-button="true"
                      aria-label={`Open ${workspace.name} in new tab`}
                      title="Open in new tab"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        openWorkspaceInNewTab(workspace.id)
                      }}
                      style={{ right: 6, top: "50%", transform: "translateY(-50%)" }}
                      className="absolute z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-foreground/10 hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <OpenInNewTabIcon className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          {(onCreateWorkspace || (currentWorkspace && onOpenWorkspaceSettings)) ? <DropdownMenuSeparator className="-mx-1.5 my-1" /> : null}

          {onCreateWorkspace ? (
            <DropdownMenuItem
              aria-label={createLabel}
              onSelect={(event: Event) => {
                event.preventDefault()
                onCreateWorkspace()
              }}
              className="gap-3 rounded-lg px-2.5 py-2.5 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span>{createLabel}</span>
                <span className="text-xs text-muted-foreground">{createDescription}</span>
              </span>
            </DropdownMenuItem>
          ) : null}

          {currentWorkspace && onOpenWorkspaceSettings ? (
            <DropdownMenuItem
              aria-label={settingsLabel}
              onSelect={() => onOpenWorkspaceSettings(currentWorkspace.id)}
              className="gap-3 rounded-lg px-2.5 py-2.5 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span>{settingsLabel}</span>
                <span className="text-xs text-muted-foreground">{settingsDescription}</span>
              </span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
