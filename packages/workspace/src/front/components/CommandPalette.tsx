"use client"

import { useCallback, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ClockIcon,
  CornerDownLeft,
  FileIcon,
  MessageSquare,
  MessageSquarePlus,
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
import { postUiCommand } from "../bridge"
import {
  CATALOG_MODE_LABEL,
  searchCommands,
  type CatalogSearchGroup,
  type PaletteMode,
} from "./commandPaletteHelpers"
import { PluginErrorBoundary } from "../plugin/PluginErrorBoundary"
import { useWorkspaceContextOptional } from "../provider/WorkspaceProvider"
import { useCommandPaletteSelection } from "./useCommandPaletteSelection"
import { useCommandPaletteChrome } from "./useCommandPaletteChrome"
import { useCommandPaletteCatalogSearch } from "./useCommandPaletteCatalogSearch"
import type { CatalogConfig, CatalogRow, CatalogSearchResult } from "../../shared/plugins/types"
import type { CommandConfig } from "../registry/types"
import type { RecentEntry } from "./recent"

export interface CommandPaletteSessionItem {
  id: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
}

export interface CommandPaletteSessionSearchConfig {
  sessions: CommandPaletteSessionItem[]
  activeId?: string | null
  openIds?: readonly string[]
  search?: (sessions: readonly CommandPaletteSessionItem[], query: string) => CommandPaletteSessionItem[]
  onSwitch: (id: string) => void
  onOpenAsTab: (id: string) => void
}

export interface CommandPaletteProps {
  sessionSearch?: CommandPaletteSessionSearchConfig
  apiBaseUrl?: string
  authHeaders?: Record<string, string>
}

const FILES_CATALOG_ID = "files"

function fileRowFromPath(path: string): CatalogRow {
  const lastSlash = path.lastIndexOf("/")
  return {
    id: path,
    title: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
    subtitle: lastSlash >= 0 ? path.slice(0, lastSlash + 1) : undefined,
  }
}

function toFileSearchGlob(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return trimmed
  const glob = /[*?\[\]{}]/.test(trimmed) ? trimmed : `*${trimmed}*`
  return glob.replace(/[a-z]/gi, (char) => {
    const lower = char.toLowerCase()
    const upper = char.toUpperCase()
    return lower === upper ? char : `[${upper}${lower}]`
  })
}

function emptySearchResult(): CatalogSearchResult {
  return { items: [], total: 0, hasMore: false }
}

function defaultSessionSearch(
  sessions: readonly CommandPaletteSessionItem[],
  query: string,
): CommandPaletteSessionItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...sessions]
  return sessions.filter((session) => {
    const title = session.title || session.id
    return title.toLowerCase().includes(normalized) || session.id.toLowerCase().includes(normalized)
  })
}

function joinApiUrl(base: string | undefined, path: string): string {
  if (!base) return path
  return `${base.replace(/\/$/, "")}${path}`
}

function createFallbackFilesCatalog(options?: { apiBaseUrl?: string; authHeaders?: Record<string, string> }): CatalogConfig {
  return {
    id: FILES_CATALOG_ID,
    label: "Files",
    adapter: {
      async search({ query, limit, signal }) {
        const trimmed = query.trim()
        if (!trimmed || signal?.aborted) return emptySearchResult()
        const params = new URLSearchParams({ q: toFileSearchGlob(trimmed) })
        if (limit != null) params.set("limit", String(limit))
        const response = await fetch(joinApiUrl(options?.apiBaseUrl, `/api/v1/files/search?${params.toString()}`), {
          credentials: "include",
          headers: options?.authHeaders,
          signal,
        })
        if (!response.ok) throw new Error(`File search failed (${response.status})`)
        const payload = await response.json() as { results?: unknown }
        const paths = Array.isArray(payload.results)
          ? payload.results.filter((path): path is string => typeof path === "string")
          : []
        if (signal?.aborted) return emptySearchResult()
        return { items: paths.map(fileRowFromPath), total: paths.length, hasMore: false }
      },
    },
    onSelect(row) {
      postUiCommand({ kind: "openFile", params: { path: row.id } })
    },
  }
}

export function CommandPalette({ sessionSearch, apiBaseUrl, authHeaders }: CommandPaletteProps = {}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<PaletteMode>(() => sessionSearch ? "chats" : "catalogs")
  const registeredCatalogs = useCatalogs()
  const commands = useCommands()
  const workspaceCtx = useWorkspaceContextOptional()
  const fallbackFilesCatalog = useMemo(
    () => createFallbackFilesCatalog({ apiBaseUrl, authHeaders }),
    [apiBaseUrl, authHeaders],
  )
  const catalogs = useMemo(() => (
    registeredCatalogs.some((catalog) => catalog.id === FILES_CATALOG_ID)
      ? registeredCatalogs
      : [fallbackFilesCatalog, ...registeredCatalogs]
  ), [fallbackFilesCatalog, registeredCatalogs])
  const pluginLabelMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const plugin of workspaceCtx?.registeredPlugins ?? []) {
      if (plugin.label) map[plugin.id] = plugin.label
    }
    return map
  }, [workspaceCtx?.registeredPlugins])
  const hasChatMode = Boolean(sessionSearch)
  const isChatMode = mode === "chats"
  const isCatalogMode = mode === "catalogs"
  const isCommandMode = mode === "commands"
  const searchQuery = query.trim()

  const catalogGroups = useCommandPaletteCatalogSearch({
    catalogs,
    isCommandMode: !isCatalogMode,
    searchQuery,
  })

  const { inputRef, switchMode, handleInputKeyDown } = useCommandPaletteChrome({
    open,
    setOpen,
    mode,
    setMode,
    setQuery,
    defaultMode: hasChatMode ? "chats" : "catalogs",
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

  const sessionResults = useMemo(() => {
    if (!sessionSearch || !isChatMode) return []
    const results = sessionSearch.search
      ? sessionSearch.search(sessionSearch.sessions, searchQuery)
      : defaultSessionSearch(sessionSearch.sessions, searchQuery)
    return results.slice(0, 8)
  }, [isChatMode, searchQuery, sessionSearch])

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
        className="cmdk-shell flex flex-col gap-0 overflow-hidden border-border/60 bg-background p-0 shadow-none backdrop-blur-0 [&>button.dialog-close]:hidden"
        style={{ height: 520, width: "min(640px, calc(100vw - 2rem))", maxWidth: 640 }}
        showCloseButton={false}
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search sources or switch to commands</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col bg-transparent">
          <PaletteSearchHeader
            inputRef={inputRef}
            hasChatMode={hasChatMode}
            isChatMode={isChatMode}
            isCatalogMode={isCatalogMode}
            isCommandMode={isCommandMode}
            query={query}
            onQueryChange={handleQueryChange}
            onInputKeyDown={handleInputKeyDown}
            onSwitchMode={switchMode}
            loading={isCatalogMode && catalogGroups.some((group) => group.loading)}
          />

          <CommandList
            className="min-h-0 flex-1 overflow-y-auto py-1"
            style={{ maxHeight: "none" }}
          >
            <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
              {isCommandMode ? "No matching commands" : isChatMode ? "No matching chats" : "No catalog results"}
            </CommandEmpty>

            <RecentResultsSection
              isCatalogMode={isCatalogMode}
              recentEntries={recentEntries}
              searchQuery={searchQuery}
              onRecentSelect={handleRecentSelect}
            />
            <SessionSearchResultsSection
              isChatMode={isChatMode}
              sessionSearch={sessionSearch}
              sessions={sessionResults}
              close={() => setOpen(false)}
            />
            <CatalogResultsSections
              catalogGroups={catalogGroups}
              isCatalogMode={isCatalogMode}
              onCatalogSelect={handleCatalogSelect}
            />
            <CommandResultsSection
              commandResults={commandResults}
              isCommandMode={isCommandMode}
              pluginLabelMap={pluginLabelMap}
              onCommandSelect={handleCommandSelect}
            />
          </CommandList>

          <PaletteFooter mode={mode} />
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function PaletteSearchHeader({
  inputRef,
  hasChatMode,
  isChatMode,
  isCatalogMode,
  isCommandMode,
  query,
  onQueryChange,
  onInputKeyDown,
  onSwitchMode,
  loading,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  hasChatMode: boolean
  isChatMode: boolean
  isCatalogMode: boolean
  isCommandMode: boolean
  query: string
  onQueryChange: (next: string) => void
  onInputKeyDown: React.KeyboardEventHandler<HTMLInputElement>
  onSwitchMode: (mode: PaletteMode) => void
  loading?: boolean
}) {
  return (
    <div className="relative shrink-0">
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
          {hasChatMode ? (
            <ModeButton
              active={isChatMode}
              icon={<MessageSquare className="size-3" />}
              label="Chats"
              onClick={() => onSwitchMode("chats")}
            />
          ) : null}
          <ModeButton
            active={isCatalogMode}
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
              : isChatMode
                ? "Search chats..."
                : "Search sources or type > for commands"
          }
          value={query}
          onValueChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          className="h-12 bg-transparent text-base focus-visible:ring-0"
        />
      </div>
      {/* Slim loading strip — sits on the cmdk-emitted border-b so it never
          shifts layout when results are refreshing. */}
      <div
        aria-hidden="true"
        className={
          loading
            ? "pointer-events-none absolute inset-x-0 bottom-0 h-px animate-pulse bg-[color:var(--accent)] opacity-80"
            : "pointer-events-none absolute inset-x-0 bottom-0 h-px bg-transparent"
        }
      />
    </div>
  )
}

function RecentResultsSection({
  isCatalogMode,
  recentEntries,
  searchQuery,
  onRecentSelect,
}: {
  isCatalogMode: boolean
  recentEntries: RecentEntry[]
  searchQuery: string
  onRecentSelect: (entry: RecentEntry) => void
}) {
  if (!isCatalogMode || recentEntries.length === 0 || searchQuery) return null

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

function SessionSearchResultsSection({
  isChatMode,
  sessionSearch,
  sessions,
  close,
}: {
  isChatMode: boolean
  sessionSearch?: CommandPaletteSessionSearchConfig
  sessions: CommandPaletteSessionItem[]
  close: () => void
}) {
  if (!isChatMode || !sessionSearch || sessions.length === 0) return null
  const openSet = new Set(sessionSearch.openIds ?? [])
  const activeId = sessionSearch.activeId ?? null

  return (
    <CommandGroup heading="Chats">
      {sessions.map((session) => {
        const title = session.title || "Untitled"
        const active = session.id === activeId
        const open = openSet.has(session.id)
        return (
          <CommandItem
            key={`chat-session:${session.id}`}
            value={`chat-session:${session.id}:${title}`}
            onSelect={() => {
              if (!active) sessionSearch.onSwitch(session.id)
              close()
            }}
            className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-[color:oklch(from_var(--accent)_l_c_h/0.10)] aria-selected:text-foreground"
          >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground/70 group-aria-selected:text-[color:var(--accent)]" />
            <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
              <span className="truncate font-medium text-foreground">{title}</span>
              {active ? (
                <span className="shrink-0 rounded bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--accent)]">active</span>
              ) : open ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">open</span>
              ) : null}
            </span>
            <button
              type="button"
              aria-label={`Open ${title} in new chat pane`}
              title="Open in new chat pane"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                sessionSearch.onOpenAsTab(session.id)
                close()
              }}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 group-aria-selected:opacity-100"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

function CatalogResultsSections({
  catalogGroups,
  isCatalogMode,
  onCatalogSelect,
}: {
  catalogGroups: CatalogSearchGroup[]
  isCatalogMode: boolean
  onCatalogSelect: (catalog: CatalogConfig, row: CatalogRow) => void
}) {
  if (!isCatalogMode) return null

  return (
    <>
      {catalogGroups
        .filter((group) => group.error || group.rows.length > 0)
        .map((group) => (
          <CommandGroup key={group.catalog.id} heading={group.catalog.label}>
            {group.error ? (
              <CatalogErrorRow catalogId={group.catalog.id} error={group.error} />
            ) : null}
            {group.rows.map((row) => (
              <CommandItem
                key={`${group.catalog.id}:${row.id}`}
                value={`${group.catalog.id}:${row.id}`}
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

function PaletteFooter({ mode }: { mode: PaletteMode }) {
  const label = mode === "commands" ? "Commands" : mode === "chats" ? "Chats" : CATALOG_MODE_LABEL
  return (
    <div className="flex items-center justify-between border-t border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
      <span className="font-medium tracking-wide uppercase">
        {label}
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

function CatalogRowLabel({ row }: { row: CatalogRow }) {
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
