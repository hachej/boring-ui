"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FileIcon } from "lucide-react"
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

  const openPalette = useCallback(() => {
    if (!open && document.activeElement instanceof HTMLElement) {
      priorFocusRef.current = document.activeElement
    }
    setOpen(true)
  }, [open])

  useKeyboardShortcuts({
    shortcuts: useMemo(
      () => [
        { key: "p", mod: true, allowInEditable: true, handler: openPalette },
        { key: "k", mod: true, allowInEditable: true, handler: openPalette },
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
        className="overflow-hidden p-0"
        showCloseButton={false}
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search files or type &gt; for commands</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            placeholder={isCommandMode ? "Type a command..." : "Search files... (type > for commands)"}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {isCommandMode ? "No matching commands" : "No files found"}
            </CommandEmpty>

            {!isCommandMode && recentFiles.length > 0 && !searchQuery && (
              <CommandGroup heading="Recent">
                {recentFiles.map((path) => (
                  <CommandItem key={path} value={path} onSelect={() => handleFileSelect(path)}>
                    <FileIcon className="mr-2 size-4" />
                    {path}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!isCommandMode && fileResults.length > 0 && (
              <CommandGroup heading="Files">
                {fileResults.map((path) => (
                  <CommandItem key={path} value={path} onSelect={() => handleFileSelect(path)}>
                    <FileIcon className="mr-2 size-4" />
                    {path}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {isCommandMode && commandResults.length > 0 && (
              <CommandGroup heading="Commands">
                {commandResults.map((cmd) => (
                  <CommandItem key={cmd.id} value={cmd.title} onSelect={() => handleCommandSelect(cmd)}>
                    {cmd.title}
                    {cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export { formatShortcut } from "../hooks/useKeyboardShortcuts"
