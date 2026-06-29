import { useCallback, useEffect, useMemo, useRef, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import type { PaletteMode } from './commandPaletteHelpers'

export function useCommandPaletteChrome({
  open,
  setOpen,
  mode,
  setMode,
  setQuery,
  defaultMode = 'catalogs',
}: {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  mode: PaletteMode
  setMode: Dispatch<SetStateAction<PaletteMode>>
  setQuery: Dispatch<SetStateAction<string>>
  defaultMode?: PaletteMode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const priorFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

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
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
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
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    }
  }, [open, setOpen])

  const openPalette = useCallback(() => {
    if (!open && document.activeElement instanceof HTMLElement) {
      priorFocusRef.current = document.activeElement
    }
    setOpen(true)
  }, [open, setOpen])

  useKeyboardShortcuts({
    shortcuts: useMemo(
      () => [
        { key: 'k', mod: true, allowInEditable: true, handler: openPalette },
        { key: 'p', mod: true, allowInEditable: true, handler: openPalette },
      ],
      [openPalette],
    ),
  })

  useEffect(() => {
    if (open) {
      setQuery('')
      setMode(defaultMode)
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
  }, [defaultMode, open, setMode, setQuery])

  const switchMode = useCallback((nextMode: PaletteMode) => {
    setMode(nextMode)
    setQuery((current) => current.replace(/^>\s*/, ''))
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [setMode, setQuery])

  const toggleMode = useCallback(() => {
    if (defaultMode === 'chats') {
      switchMode(mode === 'chats' ? 'catalogs' : mode === 'catalogs' ? 'commands' : 'chats')
      return
    }
    switchMode(mode === 'commands' ? 'catalogs' : 'commands')
  }, [defaultMode, mode, switchMode])

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    toggleMode()
  }, [toggleMode])

  return {
    inputRef,
    switchMode,
    handleInputKeyDown,
  }
}
