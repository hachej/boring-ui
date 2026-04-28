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
import { useCommandRegistry } from "../registry"
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import type { CommandConfig } from "../registry/types"

const MAX_RESULTS = 50
const MAX_RECENT = 10
const RECENT_STORAGE_KEY = "boring-ui-v2:command-palette:recent"

export interface CommandPaletteProps {
  fileSearchFn?: (query: string) => string[]
  onOpenFile?: (path: string) => void
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function saveRecent(items: string[]): void {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT)))
  } catch { /* quota */ }
}

function addToRecent(key: string): void {
  const recent = loadRecent().filter((r) => r !== key)
  recent.unshift(key)
  saveRecent(recent)
}

export function CommandPalette({ fileSearchFn, onOpenFile }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const commandRegistry = useCommandRegistry()
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
      () => [{ key: "k", mod: true, allowInEditable: true, handler: openPalette }],
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

  const fileResults = useMemo(() => {
    if (isCommandMode || !searchQuery || !fileSearchFn) return []
    return fileSearchFn(searchQuery).slice(0, MAX_RESULTS)
  }, [isCommandMode, searchQuery, fileSearchFn])

  const commandResults = useMemo(() => {
    if (!isCommandMode) return []
    const active = commandRegistry.getActiveCommands()
    if (!searchQuery) return active.slice(0, MAX_RESULTS)
    const lower = searchQuery.toLowerCase()
    return active.filter((c) => c.title.toLowerCase().includes(lower)).slice(0, MAX_RESULTS)
  }, [isCommandMode, commandRegistry, searchQuery])

  const recentFiles = useMemo(() => {
    if (isCommandMode || searchQuery) return []
    return loadRecent()
  }, [isCommandMode, searchQuery])

  const handleFileSelect = useCallback(
    (path: string) => {
      addToRecent(path)
      onOpenFile?.(path)
      setOpen(false)
    },
    [onOpenFile],
  )

  const handleCommandSelect = useCallback(
    (cmd: CommandConfig) => {
      addToRecent(`cmd:${cmd.id}`)
      cmd.run()
      setOpen(false)
    },
    [],
  )

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
          <DialogDescription>Search files or type &gt; for commands</DialogDescription>
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
                  : "Search files or type > to run a command"
              }
              value={query}
              onValueChange={setQuery}
              className="h-12 bg-transparent text-base focus-visible:ring-0"
            />
          </div>

          <CommandList className="max-h-[440px] overflow-y-auto py-1">
            <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
              {isCommandMode ? "No matching commands" : "No files found"}
            </CommandEmpty>

            {!isCommandMode && recentFiles.length > 0 && !searchQuery && (
              <CommandGroup heading="Recent">
                {recentFiles.map((path) => (
                  <CommandItem
                    key={path}
                    value={path}
                    onSelect={() => handleFileSelect(path)}
                    className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-[color:oklch(from_var(--accent)_l_c_h/0.10)] aria-selected:text-foreground"
                  >
                    <ClockIcon className="size-4 shrink-0 text-muted-foreground/70 group-aria-selected:text-[color:var(--accent)]" />
                    <FilePathLabel path={path} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!isCommandMode && fileResults.length > 0 && (
              <CommandGroup heading="Files">
                {fileResults.map((path) => (
                  <CommandItem
                    key={path}
                    value={path}
                    onSelect={() => handleFileSelect(path)}
                    className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-[color:oklch(from_var(--accent)_l_c_h/0.10)] aria-selected:text-foreground"
                  >
                    <FileIcon className="size-4 shrink-0 text-muted-foreground/70 group-aria-selected:text-[color:var(--accent)]" />
                    <FilePathLabel path={path} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

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
              {isCommandMode ? "Commands" : "Files"}
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

function FilePathLabel({ path }: { path: string }) {
  const lastSlash = path.lastIndexOf("/")
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : ""
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
      <span className="truncate font-medium text-foreground">{name}</span>
      {dir ? (
        <span className="truncate text-xs text-muted-foreground/70">{dir}</span>
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
