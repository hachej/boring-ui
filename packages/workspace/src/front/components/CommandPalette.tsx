"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import { useCatalogs } from "../plugin/useCatalogs"
import { useCommands } from "../plugin/useCommands"
import type { CatalogConfig } from "../../shared/plugins/types"
import {
  CATALOG_MODE_LABEL,
  MAX_RESULTS,
  errorMessage,
  searchCommands,
  type CatalogSearchGroup,
  type PaletteMode,
} from "./CommandPalette.helpers"
import { PluginErrorBoundary } from "../plugin/PluginErrorBoundary"
import type { ExplorerRow } from "./DataExplorer/types"
import { useWorkspaceContextOptional } from "../provider/WorkspaceProvider"
import { useCommandPaletteSelection } from "./useCommandPaletteSelection"

export type CommandPaletteProps = Record<string, never>

export function CommandPalette(_props?: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<PaletteMode>("catalogs")
  const [debouncedCatalogQuery, setDebouncedCatalogQuery] = useState("")
  const [catalogGroups, setCatalogGroups] = useState<CatalogSearchGroup[]>([])
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
  const inputRef = useRef<HTMLInputElement>(null)
  const priorFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  const isCommandMode = mode === "commands"
  const searchQuery = query.trim()

  useEffect(() => {
    if (isCommandMode) {
      setDebouncedCatalogQuery("")
      return
    }
    const timer = setTimeout(() => setDebouncedCatalogQuery(searchQuery), 180)
    return () => clearTimeout(timer)
  }, [isCommandMode, searchQuery])

  // cmdk's CommandInput captures Escape and preventDefaults to clear its
  // own value before the event can reach Radix's onEscapeKeyDown — so the
  // first Escape press feels like a no-op and users have to press twice.
  // Attach a window-level keydown at capture phase while the palette is
  // open so we always win the race and close on the first press.
  //
  // Same pattern for pointerdown: clicking the dialog overlay should close
  // the palette on the first click. Radix has onPointerDownOutside +
  // onOpenChange wired but in combination with cmdk's Command primitive
  // those callbacks don't fire reliably (the overlay click reaches Radix
  // but Radix decides not to dismiss). A window-level pointerdown that
  // checks "is the click inside dialog-content?" lets us close on the
  // first click outside, regardless of which primitive intercepts what.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      const content = document.querySelector('[data-slot="dialog-content"]')
      if (content && !content.contains(target)) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    window.addEventListener("pointerdown", onPointerDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
      window.removeEventListener("pointerdown", onPointerDown, { capture: true })
    }
  }, [open])

  const openPalette = useCallback(() => {
    if (!open && document.activeElement instanceof HTMLElement) {
      priorFocusRef.current = document.activeElement
    }
    setOpen(true)
  }, [open])

  useKeyboardShortcuts({
    shortcuts: useMemo(
      () => [
        { key: "k", mod: true, allowInEditable: true, handler: openPalette },
        { key: "p", mod: true, allowInEditable: true, handler: openPalette },
      ],
      [openPalette],
    ),
  })

  useEffect(() => {
    if (open) {
      setQuery("")
      setMode("catalogs")
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    } else if (wasOpenRef.current) {
      const prior = priorFocusRef.current
      if (prior && prior.isConnected) {
        prior.focus()
      }
      priorFocusRef.current = null
    }
    wasOpenRef.current = open
  }, [open])

  const switchMode = useCallback((nextMode: PaletteMode) => {
    setMode(nextMode)
    setQuery((current) => current.replace(/^>\s*/, ""))
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const toggleMode = useCallback(() => {
    switchMode(mode === "commands" ? "catalogs" : "commands")
  }, [mode, switchMode])

  const handleQueryChange = useCallback((next: string) => {
    if (next.startsWith(">")) {
      setMode("commands")
      setQuery(next.slice(1))
      return
    }
    setQuery(next)
  }, [])

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab") return
    event.preventDefault()
    event.stopPropagation()
    toggleMode()
  }, [toggleMode])

  useEffect(() => {
    if (isCommandMode || !debouncedCatalogQuery) {
      setCatalogGroups([])
      return
    }

    const controller = new AbortController()
    const activeCatalogs = [...catalogs]
    setCatalogGroups(
      activeCatalogs.map((catalog) => ({
        catalog,
        rows: [],
        loading: true,
      })),
    )

    const updateCatalog = (
      catalog: CatalogConfig,
      next: Omit<CatalogSearchGroup, "catalog">,
    ) => {
      if (controller.signal.aborted) return
      setCatalogGroups((groups) =>
        groups.map((group) =>
          group.catalog.id === catalog.id ? { catalog, ...next } : group,
        ),
      )
    }

    for (const catalog of activeCatalogs) {
      try {
        const result = catalog.adapter.search({
          query: debouncedCatalogQuery,
          filters: {},
          limit: MAX_RESULTS,
          offset: 0,
          signal: controller.signal,
        })
        void Promise.resolve(result).then(
          (result) => {
            updateCatalog(catalog, {
              rows: result.items.slice(0, MAX_RESULTS),
              loading: false,
            })
          },
          (error) => {
            updateCatalog(catalog, {
              rows: [],
              loading: false,
              error: errorMessage(error),
            })
          },
        )
      } catch (error) {
        updateCatalog(catalog, {
          rows: [],
          loading: false,
          error: errorMessage(error),
        })
      }
    }

    return () => {
      controller.abort()
    }
  }, [catalogs, debouncedCatalogQuery, isCommandMode])

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
        className="cmdk-shell overflow-hidden border-border/60 p-0 shadow-2xl backdrop-blur-md sm:max-w-[640px] [&>button.dialog-close]:hidden"
        showCloseButton={false}
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search catalogs or switch to commands</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="bg-transparent">
          {/*
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
                onClick={() => switchMode("catalogs")}
              />
              <ModeButton
                active={isCommandMode}
                icon={<TerminalIcon className="size-3" />}
                label="Commands"
                onClick={() => switchMode("commands")}
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
              onValueChange={handleQueryChange}
              onKeyDown={handleInputKeyDown}
              className="h-12 bg-transparent text-base focus-visible:ring-0"
            />
          </div>

          <CommandList className="max-h-[440px] overflow-y-auto py-1">
            <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
              {isCommandMode ? "No matching commands" : "No catalog results"}
            </CommandEmpty>

            {!isCommandMode && recentEntries.length > 0 && !searchQuery && (
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
                      onSelect={() => handleRecentSelect(entry)}
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
            )}

            {!isCommandMode &&
              catalogGroups
                .filter((group) => group.loading || group.error || group.rows.length > 0)
                .map((group) => (
                  <CommandGroup key={group.catalog.id} heading={group.catalog.label}>
                    {group.loading ? (
                      <CommandItem
                        value={`${group.catalog.id}:loading`}
                        disabled
                        className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm"
                      >
                        <FileIcon className="size-4 shrink-0 text-muted-foreground/70" />
                        <span className="text-muted-foreground">Searching...</span>
                      </CommandItem>
                    ) : null}
                    {group.error ? (
                      <CommandItem
                        value={`${group.catalog.id}:error`}
                        disabled
                        className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm"
                      >
                        <FileIcon className="size-4 shrink-0 text-destructive/70" />
                        <span className="text-destructive">{group.error}</span>
                      </CommandItem>
                    ) : null}
                    {group.rows.map((row) => (
                      <CommandItem
                        key={`${group.catalog.id}:${row.id}`}
                        value={`${group.catalog.id}:${row.id}:${row.title}:${row.subtitle ?? ""}`}
                        onSelect={() => handleCatalogSelect(group.catalog, row)}
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

            {isCommandMode && commandResults.length > 0 && (
              <CommandGroup heading="Commands">
                {commandResults.map((cmd) => (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.title}
                    onSelect={() => handleCommandSelect(cmd)}
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
            )}
          </CommandList>

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
        </Command>
      </DialogContent>
    </Dialog>
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
