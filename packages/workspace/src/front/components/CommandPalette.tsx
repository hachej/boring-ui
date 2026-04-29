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
  CommandShortcut,
} from "./ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import { useCatalogs } from "../plugin/useCatalogs"
import { useCommands } from "../plugin/useCommands"
import type { CommandConfig } from "../registry/types"
import type { CatalogConfig } from "../../shared/plugin/types"
import { PluginErrorBoundary } from "../plugin/PluginErrorBoundary"
import type { ExplorerRow } from "./DataExplorer/types"
import {
  loadRecent,
  addCatalogToRecent,
  addCommandToRecent,
} from "./recent"
import type { RecentEntry } from "./recent"

const MAX_RESULTS = 50

export type CommandPaletteProps = Record<string, never>

interface CatalogSearchGroup {
  catalog: CatalogConfig
  rows: ExplorerRow[]
  loading: boolean
  error?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Search failed"
}

function isActiveCommand(cmd: CommandConfig): boolean {
  if (!cmd.when) return true
  try {
    return cmd.when()
  } catch {
    return false
  }
}

export function CommandPalette(_props?: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [catalogGroups, setCatalogGroups] = useState<CatalogSearchGroup[]>([])
  const catalogs = useCatalogs()
  const commands = useCommands()
  const inputRef = useRef<HTMLInputElement>(null)
  const priorFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  const isCommandMode = query.startsWith(">")
  const searchQuery = isCommandMode ? query.slice(1).trim() : query.trim()

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

  useEffect(() => {
    if (isCommandMode || !searchQuery) {
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
          query: searchQuery,
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
  }, [catalogs, isCommandMode, searchQuery])

  const commandResults = useMemo(() => {
    if (!isCommandMode) return []
    const active = commands.filter(isActiveCommand)
    if (!searchQuery) return active.slice(0, MAX_RESULTS)
    const lower = searchQuery.toLowerCase()
    return active.filter((c) => {
      if (c.title.toLowerCase().includes(lower)) return true
      return c.keywords?.some((keyword) => keyword.toLowerCase().includes(lower)) ?? false
    }).slice(0, MAX_RESULTS)
  }, [commands, isCommandMode, searchQuery])

  const recentEntries = useMemo((): RecentEntry[] => {
    if (isCommandMode || searchQuery) return []
    const entries = loadRecent()
    return entries.filter((entry) => {
      if (entry.type === "catalog") {
        return catalogs.some((c) => c.id === entry.catalogId)
      }
      return commands.some((c) => c.id === entry.commandId)
    })
  }, [isCommandMode, searchQuery, catalogs, commands])

  const handleCatalogSelect = useCallback((catalog: CatalogConfig, row: ExplorerRow) => {
    addCatalogToRecent(catalog.id, row)
    catalog.onSelect(row)
    setOpen(false)
  }, [])

  const handleCommandSelect = useCallback(
    (cmd: CommandConfig) => {
      addCommandToRecent(cmd.id, cmd.title)
      cmd.run()
      setOpen(false)
    },
    [],
  )

  const handleRecentSelect = useCallback((entry: RecentEntry) => {
    if (entry.type === "catalog") {
      const catalog = catalogs.find((c) => c.id === entry.catalogId)
      if (catalog) {
        addCatalogToRecent(catalog.id, entry.rowSnapshot)
        catalog.onSelect(entry.rowSnapshot)
      }
    } else {
      const cmd = commands.find((c) => c.id === entry.commandId)
      if (cmd) {
        addCommandToRecent(cmd.id, cmd.title)
        cmd.run()
      }
    }
    setOpen(false)
  }, [catalogs, commands])

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
          <DialogDescription>Search catalogs or type &gt; for commands</DialogDescription>
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
           * Mode pill ("Command") sits inline AHEAD of the
           * input wrapper, both share the cmdk-emitted single
           * 1px divider underneath.
           */}
          <div className="relative flex items-stretch [&>[data-slot=command-input-wrapper]]:flex-1 [&>[data-slot=command-input-wrapper]]:h-auto">
            {isCommandMode ? (
              <span className="my-2 ml-3 inline-flex shrink-0 items-center gap-1 self-center rounded-md bg-[color:oklch(from_var(--accent)_l_c_h/0.12)] px-2 py-0.5 text-xs font-medium text-[color:var(--accent)]">
                <TerminalIcon className="size-3" />
                Command
              </span>
            ) : null}
            <CommandInput
              ref={inputRef}
              placeholder={
                isCommandMode
                  ? "Run a command..."
                  : "Search catalogs or type > to run a command"
              }
              value={query}
              onValueChange={setQuery}
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
                    {cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center justify-between border-t border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-medium tracking-wide uppercase">
              {isCommandMode ? "Commands" : "Catalogs"}
            </span>
            <div className="flex items-center gap-3">
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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/60 bg-background px-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  )
}

export { formatShortcut } from "../hooks/useKeyboardShortcuts"
