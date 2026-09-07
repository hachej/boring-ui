"use client"

import { useEffect, useRef } from "react"

export interface ShortcutBinding {
  key: string
  mod?: boolean
  shift?: boolean
  allowInEditable?: boolean
  /**
   * Evaluated at keydown time (not at binding-creation time) once the key
   * combo otherwise matches. Return false to skip this binding entirely —
   * no preventDefault/stopPropagation, no handler call — so the event keeps
   * propagating to whatever should actually own it.
   *
   * This matters for keys like Escape: this hook listens on `document` in
   * the capture phase, which typically mounts before an on-demand overlay
   * (a Radix dropdown/dialog/popover) does. Radix's own DismissableLayer
   * also listens on `document` in the capture phase and checks
   * `event.defaultPrevented` before dismissing — so an unconditional
   * `preventDefault()` here, fired first because it mounted first, silently
   * blocks the overlay from ever closing on Escape. See #1391.
   */
  shouldHandle?: (e: KeyboardEvent) => boolean
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
  const key = binding.key.toLowerCase()
  const eventKey = e.key.toLowerCase()
  const eventCode = e.code.toLowerCase()
  return eventKey === key || eventCode === key || eventCode === `key${key}`
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest("[contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']")) {
    return true
  }
  if (target.closest("[role='textbox'], [role='searchbox'], [role='combobox']")) {
    return true
  }
  return Boolean(target.closest("input, textarea, select"))
}

export function useKeyboardShortcuts({ shortcuts, enabled = true }: UseKeyboardShortcutsOptions): void {
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      const inEditable = isEditableTarget(e.target)
      for (const binding of shortcutsRef.current) {
        if (inEditable && !binding.allowInEditable) continue
        if (matchesShortcut(e, binding)) {
          if (binding.shouldHandle && !binding.shouldHandle(e)) continue
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
