"use client"

import { useCallback, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ClockIcon,
  CornerDownLeft,
  FileIcon,
  TerminalIcon,
} from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Button,
  CommandShortcut,
  Kbd,
} from "@hachej/boring-ui-kit"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@hachej/boring-ui-kit"
import { useCatalogs } from "../plugin/useCatalogs"
import { useCommands } from "../plugin/useCommands"
import {
  CATALOG_MODE_LABEL,
  searchCommands,
  type CatalogSearchGroup,
  type PaletteMode,
} from "./commandPaletteHelpers"
import { PluginErrorBoundary } from "../plugin/PluginErrorBoundary"
import type { ExplorerRow } from "../../shared/types/explorer"
import { useWorkspaceContextOptional } from "../provider/WorkspaceProvider"
import { useCommandPaletteSelection } from "./useCommandPaletteSelection"
import { useCommandPaletteChrome } from "./useCommandPaletteChrome"
import { useCommandPaletteCatalogSearch } from "./useCommandPaletteCatalogSearch"
import type { CatalogConfig } from "../../shared/plugins/types"
import type { CommandConfig } from "../registry/types"
import type { RecentEntry } from "./recent"

export type CommandPaletteProps = Record<string, never>

export function CommandPalette(_props?: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<PaletteMode>("catalogs")
  const catalogs = useCatalogs()
  const commands = useCommands()
  const workspaceCtx = useWorkspaceContextOptional()
  const pluginLabelMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const plugin of workspaceCtx?.registeredPlugins ?? []) {
      if (plugin.label) map[plugin.id] = plugin.label
    }
    return map
  }, [workspaceCtx?.registeredPlugins])
  const isCommandMode = mode === "commands"
  const searchQuery = query.trim()

  const catalogGroups = useCommandPaletteCatalogSearch({
    catalogs,
    isCommandMode,
    searchQuery,
  })

  const { inputRef, switchMode, handleInputKeyDown } = useCommandPaletteChrome({
    open,
    setOpen,
    mode,
    setMode,
    setQuery,
  })

  const handleQueryChange = useCallback((next: string) => {
    if (next.startsWith(">")) {
      setMode("commands")
      setQuery(next.slice(1))
      return
    }
    setQuery(next)
  }, [])

  const commandResults = useMemo(() => {
    if (!isCommandMode) return []
    return searchCommands(commands, searchQuery)
  }, [commands, isCommandMode, searchQuery])

  const {
    recentEntries,
    handleCatalogSelect,
    handleCommandSelect,
    handleRecentSelect,
  } = useCommandPaletteSelection({
    catalogs,
    commands,
    isCommandMode,
    searchQuery,
    close: () => setOpen(false),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="cmdk-shell overflow-hidden border-border/60 p-0 shadow-2xl backdrop-blur-md sm:!max-w-[640px] [&>button.dialog-close]:hidden"
        showCloseButton={false}
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search catalogs or switch to commands</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="bg-transparent">
          <PaletteSearchHeader
            inputRef={inputRef}
            isCommandMode={isCommandMode}
            query={query}
            onQueryChange={handleQueryChange}
            onInputKeyDown={handleInputKeyDown}
            onSwitchMode={switchMode}
          />

          <CommandList className="max-h-[440px] overflow-y-auto py-1">
            <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
              {isCommandMode ? "No matching commands" : "No catalog results"}
            </CommandEmpty>

            <RecentResultsSection
              isCommandMode={isCommandMode}
              recentEntries={recentEntries}
              searchQuery={searchQuery}
              onRecentSelect={handleRecentSelect}
            />
            <CatalogResultsSections
              catalogGroups={catalogGroups}
              isCommandMode={isCommandMode}
              onCatalogSelect={handleCatalogSelect}
            />
            <CommandResultsSection
              commandResults={commandResults}
              isCommandMode={isCommandMode}
              pluginLabelMap={pluginLabelMap}
              onCommandSelect={handleCommandSelect}
            />
          </CommandList>

          <PaletteFooter isCommandMode={isCommandMode} />
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function PaletteSearchHeader({
  inputRef,
  isCommandMode,
  query,
  onQueryChange,
  onInputKeyDown,
  onSwitchMode,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  isCommandMode: boolean
  query: string
  onQueryChange: (next: string) => void
  onInputKeyDown: React.KeyboardEventHandler<HTMLInputElement>
  onSwitchMode: (mode: PaletteMode) => void
}) {
  return (
    <>
      {/**
       * Don't add another border-b on this outer wrapper —
       * shadcn's <CommandInput> renders its own wrapper div
       * (data-slot="command-input-wrapper") with `border-b`
       * baked in. Stacking a second border-b on this parent
       * caused the double-line under the input the user
       * reported as a "strange border".
       *
       * Mode switcher sits inline AHEAD of the input wrapper, both
       * share the cmdk-emitted single 1px divider underneath.
       */}
      <div className="relative flex items-stretch [&>[data-slot=command-input-wrapper]]:flex-1 [&>[data-slot=command-input-wrapper]]:h-auto">
        <div
          role="group"
          aria-label="Palette mode"
          className="my-2 ml-3 inline-flex shrink-0 self-center rounded-md border border-border/60 bg-muted/40 p-0.5"
        >
          <ModeButton
            active={!isCommandMode}
            icon={<FileIcon className="size-3" />}
            label={CATALOG_MODE_LABEL}
            onClick={() => onSwitchMode("catalogs")}
          />
          <ModeButton
            active={isCommandMode}
            icon={<TerminalIcon className="size-3" />}
            label="Commands"
            onClick={() => onSwitchMode("commands")}
          />
        </div>
        <CommandInput
          ref={inputRef}
          placeholder={
            isCommandMode
              ? "Run a command..."
              : "Search catalogs or type > for commands"
          }
          value={query}
          onValueChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          className="h-12 bg-transparent text-base focus-visible:ring-0"
        />
      </div>
    </>
  )
}

function RecentResultsSection({
  isCommandMode,
  recentEntries,
  searchQuery,
  onRecentSelect,
}: {
  isCommandMode: boolean
  recentEntries: RecentEntry[]
  searchQuery: string
  onRecentSelect: (entry: RecentEntry) => void
}) {
  if (isCommandMode || recentEntries.length === 0 || searchQuery) return null

  return (
    <CommandGroup heading="Recent">
      {recentEntries.map((entry) => {
        const key =
          entry.type === "catalog"
            ? `recent:catalog:${entry.catalogId}:${entry.rowId}`
            : `recent:command:${entry.commandId}`
        return (
          <CommandItem
            key={key}
            value={key}
            onSelect={() => onRecentSelect(entry)}
            className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-[color:oklch(from_var(--accent)_l_c_h/0.10)] aria-selected:text-foreground"
          >
            {entry.type === "catalog" ? (
              <>
                <ClockIcon className="size-4 shrink-0 text-muted-foreground/70 group-aria-selected:text-[color:var(--accent)]" />
                <CatalogRowLabel row={entry.rowSnapshot} />
              </>
            ) : (
              <>
                <TerminalIcon className="size-4 shrink-0 text-muted-foreground/70 group-aria-selected:text-[color:var(--accent)]" />
                <span className="flex-1 truncate">{entry.titleSnapshot}</span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  command
                </span>
              </>
            )}
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

function CatalogResultsSections({
  catalogGroups,
  isCommandMode,
  onCatalogSelect,
}: {
  catalogGroups: CatalogSearchGroup[]
  isCommandMode: boolean
  onCatalogSelect: (catalog: CatalogConfig, row: ExplorerRow) => void
}) {
  if (isCommandMode) return null

  return (
    <>
      {catalogGroups
        .filter((group) => group.loading || group.error || group.rows.length > 0)
        .map((group) => (
          <CommandGroup key={group.catalog.id} heading={group.catalog.label}>
            {group.loading ? <CatalogLoadingRow catalogId={group.catalog.id} /> : null}
            {group.error ? (
              <CatalogErrorRow catalogId={group.catalog.id} error={group.error} />
            ) : null}
            {group.rows.map((row) => (
              <CommandItem
                key={`${group.catalog.id}:${row.id}`}
                value={`${group.catalog.id}:${row.id}:${row.title}:${row.subtitle ?? ""}`}
                onSelect={() => onCatalogSelect(group.catalog, row)}
                className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-[color:oklch(from_var(--accent)_l_c_h/0.10)] aria-selected:text-foreground"
              >
                <PluginErrorBoundary
                  pluginId={group.catalog.pluginId ?? group.catalog.id}
                  contributionKind="catalog-row"
                  contributionId={row.id}
                >
                  <FileIcon className="size-4 shrink-0 text-muted-foreground/70 group-aria-selected:text-[color:var(--accent)]" />
                  <CatalogRowLabel row={row} />
                </PluginErrorBoundary>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
    </>
  )
}

function CatalogLoadingRow({ catalogId }: { catalogId: string }) {
  return (
    <CommandItem
      value={`${catalogId}:loading`}
      disabled
      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm"
    >
      <FileIcon className="size-4 shrink-0 text-muted-foreground/70" />
      <span className="text-muted-foreground">Searching...</span>
    </CommandItem>
  )
}

function CatalogErrorRow({ catalogId, error }: { catalogId: string; error: string }) {
  return (
    <CommandItem
      value={`${catalogId}:error`}
      disabled
      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm"
    >
      <FileIcon className="size-4 shrink-0 text-destructive/70" />
      <span className="text-destructive">{error}</span>
    </CommandItem>
  )
}

function CommandResultsSection({
  commandResults,
  isCommandMode,
  pluginLabelMap,
  onCommandSelect,
}: {
  commandResults: CommandConfig[]
  isCommandMode: boolean
  pluginLabelMap: Record<string, string>
  onCommandSelect: (cmd: CommandConfig) => void
}) {
  if (!isCommandMode || commandResults.length === 0) return null

  return (
    <CommandGroup heading="Commands">
      {commandResults.map((cmd) => (
        <CommandItem
          key={cmd.id}
          value={cmd.title}
          onSelect={() => onCommandSelect(cmd)}
          className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-[color:oklch(from_var(--accent)_l_c_h/0.10)] aria-selected:text-foreground"
        >
          <TerminalIcon className="size-4 shrink-0 text-muted-foreground/70 group-aria-selected:text-[color:var(--accent)]" />
          <span className="flex-1 truncate">{cmd.title}</span>
          {pluginLabelMap[cmd.pluginId ?? ""] && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {pluginLabelMap[cmd.pluginId ?? ""]}
            </span>
          )}
          {cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function PaletteFooter({ isCommandMode }: { isCommandMode: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
      <span className="font-medium tracking-wide uppercase">
        {isCommandMode ? "Commands" : CATALOG_MODE_LABEL}
      </span>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Kbd>tab</Kbd>
          <span>switch</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>
            <ArrowUp className="size-3" />
          </Kbd>
          <Kbd>
            <ArrowDown className="size-3" />
          </Kbd>
          <span>navigate</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>
            <CornerDownLeft className="size-3" />
          </Kbd>
          <span>open</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
          <span>close</span>
        </span>
      </div>
    </div>
  )
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "h-7 gap-1.5 px-2 text-xs font-medium",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {icon}
      {label}
    </Button>
  )
}

function CatalogRowLabel({ row }: { row: ExplorerRow }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
      <span className="truncate font-medium text-foreground">{row.title}</span>
      {row.subtitle ? (
        <span className="truncate text-xs text-muted-foreground/70">{row.subtitle}</span>
      ) : null}
      {row.meta ? (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">{row.meta}</span>
      ) : null}
    </span>
  )
}

export { formatShortcut } from "../hooks/useKeyboardShortcuts"
