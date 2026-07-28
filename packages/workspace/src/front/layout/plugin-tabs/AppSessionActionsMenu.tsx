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
  const suppressCloseAutoFocus = useRef(false)
  const setMenuOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange(next)
  }
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
          aria-label={`More options for ${title}`}
          title="More"
          onPointerDown={() => { suppressCloseAutoFocus.current = false }}
          onKeyDown={() => { suppressCloseAutoFocus.current = false }}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
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
        onPointerDownCapture={() => { suppressCloseAutoFocus.current = true }}
        onPointerDownOutside={() => { suppressCloseAutoFocus.current = true }}
        onEscapeKeyDown={() => { suppressCloseAutoFocus.current = false }}
        onCloseAutoFocus={(event) => {
          if (suppressCloseAutoFocus.current) event.preventDefault()
        }}
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
          <DropdownMenuItem
            onSelect={() => {
              setMenuOpen(false)
              onRename()
            }}
            className="gap-2 text-[13px]"
          >
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
        ) : null}
        {canRename && onDelete ? <DropdownMenuSeparator /> : null}
        {onDelete ? (
          <DropdownMenuItem
            onSelect={() => void onDelete(sessionId)}
            variant="destructive"
            className="gap-2 text-[13px]"
          >
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
