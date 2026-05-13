import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { Check, ChevronsUpDown, LayoutGrid, Plus, Settings } from "lucide-react"

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
  const currentWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const switcherLabel = currentWorkspace?.name ?? "Select workspace"

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Workspace menu: ${switcherLabel}`}
          className="-ml-1 h-8 min-w-0 justify-start gap-2.5 border border-transparent px-1 py-1 text-left"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
          >
            {appTitle.charAt(0).toUpperCase()}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">
              {appTitle}
            </span>
            <span aria-hidden="true" className="text-muted-foreground/30">/</span>
            <span className="truncate text-[13px] font-normal text-muted-foreground">
              {switcherLabel}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-80 rounded-lg border-border/70 bg-[color:var(--surface-workbench-left)] p-2 shadow-2xl"
      >
        <DropdownMenuLabel className="px-2 pb-2 pt-1">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Workspaces
          </span>
        </DropdownMenuLabel>
        <div className="max-h-72 overflow-y-auto pr-1">
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
                className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-xs font-semibold text-muted-foreground">
                  {workspaceInitial(workspace.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{workspace.name}</span>
                  {available ? null : (
                    <span className="truncate text-xs text-destructive">Folder unavailable</span>
                  )}
                </span>
                {isCurrent ? <Check className="h-4 w-4 text-foreground" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            )
          })}
        </div>

        {(onCreateWorkspace || (currentWorkspace && onOpenWorkspaceSettings)) ? <DropdownMenuSeparator className="-mx-2" /> : null}

        {onCreateWorkspace ? (
          <DropdownMenuItem
            aria-label={createLabel}
            onSelect={(event: Event) => {
              event.preventDefault()
              onCreateWorkspace()
            }}
            className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
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
            className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
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
  )
}
