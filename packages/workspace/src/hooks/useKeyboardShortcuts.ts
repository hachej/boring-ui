"use client"

import { useEffect, useRef } from "react"

export interface ShortcutBinding {
  key: string
  mod?: boolean
  shift?: boolean
  handler: () => void
}

export interface UseKeyboardShortcutsOptions {
  shortcuts: ShortcutBinding[]
  enabled?: boolean
}

function matchesShortcut(e: KeyboardEvent, binding: ShortcutBinding): boolean {
  const mod = e.metaKey || e.ctrlKey
  if (binding.mod && !mod) return false
  if (!binding.mod && mod) return false
  if (binding.shift && !e.shiftKey) return false
  if (!binding.shift && e.shiftKey) return false
  return e.key.toLowerCase() === binding.key.toLowerCase()
}

export function useKeyboardShortcuts({ shortcuts, enabled = true }: UseKeyboardShortcutsOptions): void {
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      for (const binding of shortcutsRef.current) {
        if (matchesShortcut(e, binding)) {
          e.preventDefault()
          e.stopPropagation()
          binding.handler()
          return
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [enabled])
}

export function formatShortcut(binding: Pick<ShortcutBinding, "key" | "mod" | "shift">): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
  const parts: string[] = []
  if (binding.mod) parts.push(isMac ? "⌘" : "Ctrl")
  if (binding.shift) parts.push(isMac ? "⇧" : "Shift")
  const keyMap: Record<string, string> = { "\\": "\\", p: "P", b: "B", s: "S", w: "W" }
  parts.push(keyMap[binding.key] ?? binding.key.toUpperCase())
  return parts.join(isMac ? "" : "+")
}
