"use client"

import { useRef, useState } from "react"
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { toast } from "../../toast"

export function AppSessionActionsMenu({
  sessionId,
  title,
  canCopy,
  canRename,
  canPin = false,
  pinned = false,
  archived = false,
  onTogglePinned,
  onRename,
  onToggleArchived,
  onDelete,
  onOpenChange,
}: {
  sessionId: string
  title: string
  canCopy: boolean
  canRename: boolean
  canPin?: boolean
  pinned?: boolean
  archived?: boolean
  onTogglePinned?: (id: string) => void
  onRename: () => void
  /** Visibility only — the transcript is kept, so this is never destructive. */
  onToggleArchived?: (id: string, archived: boolean) => unknown
  onDelete?: (id: string) => unknown
  onOpenChange: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const suppressCloseAutoFocus = useRef(false)
  const setMenuOpen = (next: boolean) => { setOpen(next); onOpenChange(next) }
  const copy = async () => {
    if (await copyText(sessionId)) {
      toast.success({ title: "Session ID copied", description: sessionId })
      return
    }
    toast.error({ title: "Could not copy session ID", description: "Allow clipboard access and try again." })
  }
  return (
    <DropdownMenu open={open} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          draggable={false}
          aria-label={`Chat actions for ${title}`}
          title="Chat actions"
          onPointerDown={() => { suppressCloseAutoFocus.current = false }}
          onKeyDown={() => { suppressCloseAutoFocus.current = false }}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
          // Sized by `.app-left-session-secondary-action` (globals.css) from
          // the same `--app-session-action-slot` that reserves this button's
          // place in the strip, exactly like the split / quick-chat shortcuts.
          className="app-left-session-secondary-action grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-boring-workspace-part="app-left-menu"
        align="end"
        sideOffset={6}
        onPointerDownCapture={() => { suppressCloseAutoFocus.current = true }}
        onPointerDownOutside={() => { suppressCloseAutoFocus.current = true }}
        onEscapeKeyDown={() => { suppressCloseAutoFocus.current = false }}
        onCloseAutoFocus={(event) => { if (suppressCloseAutoFocus.current) event.preventDefault() }}
        onClick={(event) => event.stopPropagation()}
        className="w-48 border-border/50"
      >
        {canPin && onTogglePinned ? (
          <DropdownMenuItem onSelect={() => onTogglePinned(sessionId)} className="gap-2 text-[13px]">
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {pinned ? "Unpin chat" : "Pin chat"}
          </DropdownMenuItem>
        ) : null}
        {canPin && onTogglePinned && (canCopy || canRename || onToggleArchived || onDelete)
          ? <DropdownMenuSeparator />
          : null}
        {canCopy ? (
          <DropdownMenuItem onSelect={() => void copy()} className="gap-2 text-[13px]">
            <Copy className="h-3.5 w-3.5" /> Copy session ID
          </DropdownMenuItem>
        ) : null}
        {canCopy && (canRename || onToggleArchived || onDelete) ? <DropdownMenuSeparator /> : null}
        {canRename ? (
          <DropdownMenuItem onSelect={() => { setMenuOpen(false); onRename() }} className="gap-2 text-[13px]">
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
        ) : null}
        {canRename && (onToggleArchived || onDelete) ? <DropdownMenuSeparator /> : null}
        {onToggleArchived ? (
          <DropdownMenuItem onSelect={() => void onToggleArchived(sessionId, !archived)} className="gap-2 text-[13px]">
            {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {archived ? "Unarchive session" : "Archive session"}
          </DropdownMenuItem>
        ) : null}
        {onToggleArchived && onDelete ? <DropdownMenuSeparator /> : null}
        {onDelete ? (
          <DropdownMenuItem onSelect={() => void onDelete(sessionId)} variant="destructive" className="gap-2 text-[13px]">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through for HTTP dev URLs and browsers that deny Clipboard API access.
    }
  }

  if (typeof document === "undefined") return false
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  const writeCopyData = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.clipboardData.setData("text/plain", text)
    event.preventDefault()
  }
  document.addEventListener("copy", writeCopyData, { once: true })
  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand?.("copy") ?? false
  } catch {
    return false
  } finally {
    document.removeEventListener("copy", writeCopyData)
    document.body.removeChild(textarea)
  }
}
