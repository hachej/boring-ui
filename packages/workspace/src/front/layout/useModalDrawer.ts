import { useEffect, useRef, type RefObject } from "react"

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalDrawerOptions {
  active: boolean
  containerRef: RefObject<HTMLElement | null>
  onDismiss?: () => void
  focusFallback?: () => void
  lifecycleKey?: unknown
}

/**
 * Supplies the keyboard and focus lifecycle for one active, inline drawer.
 * The listeners stay on the drawer subtree so portaled Radix layers retain
 * ownership of their own focus and Escape events.
 */
export function useModalDrawer({
  active,
  containerRef,
  onDismiss,
  focusFallback,
  lifecycleKey,
}: ModalDrawerOptions): void {
  const onDismissRef = useRef(onDismiss)
  const focusFallbackRef = useRef(focusFallback)
  onDismissRef.current = onDismiss
  focusFallbackRef.current = focusFallback

  useEffect(() => {
    if (!active) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    if (!container) return

    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(firstFocusable ?? container).focus({ preventScroll: true })

    const observer = new MutationObserver(() => {
      if (document.activeElement !== document.body || !container.isConnected) return
      const nextFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(nextFocusable ?? container).focus({ preventScroll: true })
    })
    observer.observe(container, { childList: true, subtree: true })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!onDismissRef.current) return
        event.preventDefault()
        event.stopPropagation()
        onDismissRef.current()
        return
      }
      if (event.key !== "Tab") return

      const focusables = Array.from(container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null,
      )
      if (focusables.length === 0) {
        event.preventDefault()
        container!.focus({ preventScroll: true })
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    container.addEventListener("keydown", handleKeyDown)
    return () => {
      observer.disconnect()
      container.removeEventListener("keydown", handleKeyDown)
      if (previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
        return
      }
      if (container.contains(document.activeElement)) {
        ;(document.activeElement as HTMLElement).blur()
      }
      if (container.isConnected) focusFallbackRef.current?.()
    }
  }, [active, containerRef, lifecycleKey])
}

/** Locks body scroll only for the owning ChatLayout shell. */
export function useModalDrawerScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [locked])
}
