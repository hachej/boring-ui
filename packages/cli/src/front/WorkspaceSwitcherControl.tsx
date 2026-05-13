import { useEffect, useRef, useState } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
} from "@hachej/boring-ui-kit"
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

function focusCurrentMenuItem() {
  window.setTimeout(() => {
    const content = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]')
    const current = content?.querySelector<HTMLElement>('[data-current="true"]:not([data-disabled])')
    const first = content?.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]:not([data-disabled])')
    ;(current ?? first)?.focus()
  }, 0)
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const currentWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const switcherLabel = currentWorkspace?.name ?? "Select workspace"

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
      setOpen(true)
      focusCurrentMenuItem()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [])

  if (workspaces.length === 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onCreateWorkspace}
        disabled={!onCreateWorkspace}
        className="-ml-1 h-8 gap-2 rounded-md px-1 pr-2.5 hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
      >
        {appTitle.charAt(0).toUpperCase()}
      </span>
      <span className="truncate text-[13px] font-medium text-foreground">
        {appTitle}
      </span>
      <span aria-hidden="true" className="text-muted-foreground/30">/</span>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            aria-label={`Workspace menu: ${switcherLabel}`}
            title="Workspace picker (⌘⇧K)"
            className="h-8 min-w-0 justify-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-foreground/[0.04] focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="max-w-[15rem] truncate text-[13px] font-normal text-muted-foreground">
              {switcherLabel}
            </span>
            <Kbd className="ml-1 border-0 bg-transparent p-0 text-[11px] text-muted-foreground/75 shadow-none">⌘⇧K</Kbd>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="w-[21rem] rounded-xl border-border/70 bg-popover p-1.5 text-popover-foreground shadow-2xl"
        >
          <div className="max-h-80 overflow-y-auto">
            {workspaces.map((workspace) => {
              const isCurrent = currentWorkspace?.id === workspace.id
              const available = workspace.available !== false
              return (
                <DropdownMenuItem
                  key={workspace.id}
                  aria-label={workspace.name}
                  data-current={isCurrent ? "true" : "false"}
                  disabled={!available}
                  onSelect={() => onSelectWorkspace(workspace.id)}
                  className="gap-3 rounded-lg px-2.5 py-2.5 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground data-[current=true]:bg-foreground/[0.08] data-[current=true]:text-foreground"
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
                </DropdownMenuItem>
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
