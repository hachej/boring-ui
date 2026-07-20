"use client"

import { useRef, useState } from "react"
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
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
  onRename,
  onDelete,
  onOpenChange,
}: {
  sessionId: string
  title: string
  canCopy: boolean
  canRename: boolean
  onRename: () => void
  onDelete?: (id: string) => void | Promise<unknown>
  onOpenChange: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const pointerOpened = useRef(false)
  const setMenuOpen = (next: boolean) => { setOpen(next); onOpenChange(next) }
  const copy = async () => {
    if (!globalThis.isSecureContext || !navigator.clipboard?.writeText) {
      toast.error({ title: "Could not copy session ID", description: "Use HTTPS and allow clipboard access." })
      return
    }
    try {
      await navigator.clipboard.writeText(sessionId)
      toast.success({ title: "Session ID copied", description: sessionId })
    } catch {
      toast.error({ title: "Could not copy session ID", description: "Use HTTPS and allow clipboard access." })
    }
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
          onPointerDown={() => { pointerOpened.current = true }}
          onKeyDown={() => { pointerOpened.current = false }}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        onCloseAutoFocus={(event) => { if (pointerOpened.current) event.preventDefault() }}
        onClick={(event) => event.stopPropagation()}
        className="w-48 border-border/50"
      >
        {canCopy ? (
          <DropdownMenuItem onSelect={() => void copy()} className="gap-2 text-[13px]">
            <Copy className="h-3.5 w-3.5" /> Copy session ID
          </DropdownMenuItem>
        ) : null}
        {canCopy && (canRename || onDelete) ? <DropdownMenuSeparator /> : null}
        {canRename ? (
          <DropdownMenuItem onSelect={() => { setMenuOpen(false); onRename() }} className="gap-2 text-[13px]">
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
        ) : null}
        {canRename && onDelete ? <DropdownMenuSeparator /> : null}
        {onDelete ? (
          <DropdownMenuItem onSelect={() => void onDelete(sessionId)} variant="destructive" className="gap-2 text-[13px]">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
