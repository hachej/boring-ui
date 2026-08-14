"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "../lib/utils"

/** Must match the CSS transition duration below so the exit isn't cut short. */
const TRANSITION_DURATION_MS = 150

/**
 * Chat-left management overlay (Skills, Plugins, host tools) with a short
 * enter/exit transition. The overlay content is owned by the host; this only
 * keeps the outgoing content mounted long enough to fade it back out so the
 * surface doesn't pop in and out of the chat column.
 */
export function ChatLeftOverlay({ overlay, hidden }: { overlay: ReactNode; hidden: boolean }) {
  const [rendered, setRendered] = useState<ReactNode>(overlay)
  const [open, setOpen] = useState(false)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (exitTimerRef.current !== undefined) {
      clearTimeout(exitTimerRef.current)
      exitTimerRef.current = undefined
    }
    if (overlay) {
      setRendered(overlay)
      // Paint the closed state once so the opening transition has a start value.
      const frame = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(frame)
    }
    setOpen(false)
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = undefined
      setRendered(null)
    }, TRANSITION_DURATION_MS)
    return undefined
  }, [overlay])

  useEffect(() => () => {
    if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current)
  }, [])

  if (!rendered) return null

  return (
    <div
      data-boring-workspace-part="chat-left-overlay"
      data-boring-state={open ? "open" : "closed"}
      aria-hidden={hidden}
      className={cn(
        // Above dockview sashes (z-index 999) and pane chrome so nothing from
        // the chat stage shows through or stays draggable while the overlay
        // is open. The parent stage `isolate`s, so this stays local.
        "absolute inset-0 z-[1000] flex bg-background",
        "transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        open ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
      )}
    >
      <div className="flex h-full w-full flex-col border-r border-border bg-background">
        {rendered}
      </div>
    </div>
  )
}
