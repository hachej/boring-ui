"use client"

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { copyText } from "../../lib/clipboard"
import { toast } from "../../toast"

function useMenuTriggerDragGuard(suppressedRef: MutableRefObject<boolean>) {
  const cleanupRef = useRef<(() => void) | null>(null)

  const clear = useCallback(() => {
    suppressedRef.current = false
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [suppressedRef])

  useEffect(() => clear, [clear])

  const arm = useCallback((releaseEvents: readonly ("pointerup" | "pointercancel" | "mouseup")[]) => {
    if (suppressedRef.current) return
    suppressedRef.current = true
    const release = () => clear()
    for (const eventName of releaseEvents) {
      document.addEventListener(eventName, release, { capture: true, once: true })
    }
    window.addEventListener("blur", release, { once: true })
    cleanupRef.current = () => {
      for (const eventName of releaseEvents) {
        document.removeEventListener(eventName, release, true)
      }
      window.removeEventListener("blur", release)
    }
  }, [clear, suppressedRef])

  return {
    armForPointer: () => arm(["pointerup", "pointercancel"]),
    armForMouse: () => arm(["mouseup"]),
    clear,
  }
}

export function AppSessionActionsMenu({
  sessionId,
  title,
  canRename,
  onRequestRename,
  onDelete,
  onOpenChange,
  dragSuppressedRef,
}: {
  sessionId: string
  title: string
  canRename: boolean
  onRequestRename: () => void
  onDelete?: (id: string) => void
  onOpenChange: (open: boolean) => void
  /** Shared with the draggable row to suppress a trigger-originated native drag. */
  dragSuppressedRef: MutableRefObject<boolean>
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const preventRenameCloseAutoFocusRef = useRef(false)
  const openedByPointerRef = useRef(false)
  const { armForPointer, armForMouse, clear } = useMenuTriggerDragGuard(dragSuppressedRef)

  const setMenuOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange(nextOpen)
  }

  const copySessionId = () => {
    // The HTTP fallback briefly focuses a hidden textarea. Keyboard users need
    // focus restored, while pointer users should not receive a stray trigger
    // focus ring after choosing a menu item.
    const fallbackFocusTarget = openedByPointerRef.current ? null : triggerRef.current
    void copyText(sessionId, { fallbackFocusTarget }).then((copied) => {
      if (copied) {
        toast.success({ title: "Session ID copied", description: sessionId })
      } else {
        toast.error({ title: "Could not copy session ID", description: "Use HTTPS and allow clipboard access." })
      }
    })
  }

  const requestRename = () => {
    // Radix restores focus to its trigger on close. Mark this before closing so
    // the inline field can take focus after the close lifecycle completes.
    preventRenameCloseAutoFocusRef.current = true
    setMenuOpen(false)
    onRequestRename()
  }

  return (
    <DropdownMenu open={open} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          draggable={false}
          aria-label={`More options for ${title}`}
          title="More"
          onPointerDown={() => {
            openedByPointerRef.current = true
            armForPointer()
          }}
          onMouseDown={armForMouse}
          onKeyDown={() => {
            openedByPointerRef.current = false
          }}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            clear()
            event.preventDefault()
            event.stopPropagation()
          }}
          className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:size-6"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          if (preventRenameCloseAutoFocusRef.current) {
            event.preventDefault()
            preventRenameCloseAutoFocusRef.current = false
          } else if (openedByPointerRef.current) {
            event.preventDefault()
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className="w-48 border-border/50 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.55)]"
      >
        <DropdownMenuItem onSelect={copySessionId} className="gap-2 text-[13px]">
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy session ID
        </DropdownMenuItem>
        {canRename || onDelete ? <DropdownMenuSeparator /> : null}
        {canRename ? (
          <DropdownMenuItem onSelect={requestRename} className="gap-2 text-[13px]">
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Rename
          </DropdownMenuItem>
        ) : null}
        {canRename && onDelete ? <DropdownMenuSeparator /> : null}
        {onDelete ? (
          <DropdownMenuItem onSelect={() => onDelete(sessionId)} variant="destructive" className="gap-2 text-[13px]">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
