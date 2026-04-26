import { useEffect, useRef } from 'react'

export interface Binding {
  shortcut: string
  handler: (event: KeyboardEvent) => void
}

const MAC_PLATFORM_RE = /Mac|iPod|iPhone|iPad/

type ParsedShortcut = {
  key: string
  cmd: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

function normalizeKey(key: string): string {
  const lowered = key.toLowerCase()
  if (lowered === 'space') return ' '
  if (lowered === 'esc') return 'escape'
  return lowered
}

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)

  if (parts.length === 0) {
    return {
      key: '',
      cmd: false,
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
    }
  }

  const key = normalizeKey(parts[parts.length - 1] ?? '')
  const modifiers = parts.slice(0, -1)

  return {
    key,
    cmd: modifiers.includes('cmd'),
    ctrl: modifiers.includes('ctrl'),
    meta: modifiers.includes('meta'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt') || modifiers.includes('option'),
  }
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return MAC_PLATFORM_RE.test(navigator.platform)
}

function matchesBinding(
  event: KeyboardEvent,
  parsed: ParsedShortcut,
  macPlatform: boolean,
): boolean {
  const expectedMeta = parsed.meta || (parsed.cmd && macPlatform)
  const expectedCtrl = parsed.ctrl || (parsed.cmd && !macPlatform)
  const expectedShift = parsed.shift
  const expectedAlt = parsed.alt

  if (event.metaKey !== expectedMeta) return false
  if (event.ctrlKey !== expectedCtrl) return false
  if (event.shiftKey !== expectedShift) return false
  if (event.altKey !== expectedAlt) return false

  return normalizeKey(event.key) === parsed.key
}

export function useKeyboardShortcuts(bindings: Binding[]): void {
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  useEffect(() => {
    if (typeof window === 'undefined') return

    const macPlatform = isMacPlatform()
    const parsedBindings = bindingsRef.current.map((binding) => ({
      binding,
      parsed: parseShortcut(binding.shortcut),
    }))

    const onKeyDown = (event: KeyboardEvent) => {
      for (const { binding, parsed } of parsedBindings) {
        if (!parsed.key) continue
        if (!matchesBinding(event, parsed, macPlatform)) continue

        event.preventDefault()
        binding.handler(event)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [bindings])
}
