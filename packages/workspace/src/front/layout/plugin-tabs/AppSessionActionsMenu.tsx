"use client"

import { Fragment, useRef, useState, type ReactNode } from "react"
import { Columns2, Copy, MoreHorizontal, Pencil, Pin, PinOff, Trash2, Zap } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hachej/boring-ui-kit"
import { toast } from "../../toast"

/**
 * ONE item list, two ways in.
 *
 * A chat row answers the same question from a hover "..." and from a
 * right-click, so the two MUST offer the same verbs in the same order — a
 * context menu that is a subset of the kebab is the classic way a surface
 * teaches its operator to distrust right-click. The items live here; the two
 * shells below only decide where the panel is anchored.
 */
/**
 * Band ordering. `shipped` is what the default hosts have always rendered;
 * `console` leads with the verbs the #1355 research put first. Explicit,
 * because reordering a menu under a host that did not ask is a behavior change
 * wearing a refactor's clothes.
 */
export type AppSessionActionOrder = "shipped" | "console"

export interface AppSessionActionItemsProps {
  sessionId: string
  title: string
  canCopy: boolean
  canRename: boolean
  canPin: boolean
  pinned: boolean
  /** Placement verbs the MENU carries. Surfaces that keep them as row icons pass false. */
  canOpenAsPane?: boolean
  canOpenDetached?: boolean
  onTogglePinned?: (id: string) => void
  onRename: () => void
  onOpenAsPane?: (id: string) => void
  onOpenDetached?: (id: string) => void
  onDelete?: (id: string) => unknown
  order?: AppSessionActionOrder
  /** Closes the shell that owns these items before a verb takes over the row. */
  onCloseMenu: () => void
}

export function hasAppSessionActions(props: {
  canCopy: boolean
  canRename: boolean
  canPin: boolean
  canOpenAsPane?: boolean
  canOpenDetached?: boolean
  onDelete?: unknown
  onTogglePinned?: unknown
}): boolean {
  return Boolean(
    (props.canPin && props.onTogglePinned)
    || props.canCopy
    || props.canRename
    || props.canOpenAsPane
    || props.canOpenDetached
    || props.onDelete,
  )
}

const itemClassName = "gap-2 text-[13px]"

export function AppSessionActionItems({
  sessionId,
  canCopy,
  canRename,
  canPin,
  pinned,
  canOpenAsPane = false,
  canOpenDetached = false,
  onTogglePinned,
  onRename,
  onOpenAsPane,
  onOpenDetached,
  onDelete,
  order = "shipped",
  onCloseMenu,
}: AppSessionActionItemsProps) {
  const copyItem = async () => {
    if (await copyText(sessionId)) {
      toast.success({ title: "Session ID copied", description: sessionId })
      return
    }
    toast.error({ title: "Could not copy session ID", description: "Allow clipboard access and try again." })
  }
  const rename = canRename ? (
    <DropdownMenuItem key="rename" onSelect={() => { onCloseMenu(); onRename() }} className={itemClassName}>
      <Pencil className="h-3.5 w-3.5" /> Rename
    </DropdownMenuItem>
  ) : null
  const pin = canPin && onTogglePinned ? (
    <DropdownMenuItem key="pin" onSelect={() => onTogglePinned(sessionId)} className={itemClassName}>
      {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      {pinned ? "Unpin chat" : "Pin chat"}
    </DropdownMenuItem>
  ) : null
  const copy = canCopy ? (
    <DropdownMenuItem key="copy" onSelect={() => void copyItem()} className={itemClassName}>
      <Copy className="h-3.5 w-3.5" /> Copy session ID
    </DropdownMenuItem>
  ) : null
  const remove = onDelete ? (
    <DropdownMenuItem key="delete" onSelect={() => void onDelete(sessionId)} variant="destructive" className={itemClassName}>
      <Trash2 className="h-3.5 w-3.5" /> Delete
    </DropdownMenuItem>
  ) : null
  const split = canOpenAsPane && onOpenAsPane ? (
    <DropdownMenuItem key="split" onSelect={() => onOpenAsPane(sessionId)} className={itemClassName}>
      <Columns2 className="h-3.5 w-3.5" /> Open in split view
    </DropdownMenuItem>
  ) : null
  const quick = canOpenDetached && onOpenDetached ? (
    <DropdownMenuItem key="quick" onSelect={() => onOpenDetached(sessionId)} className={itemClassName}>
      <Zap className="h-3.5 w-3.5" /> Open as quick chat
    </DropdownMenuItem>
  ) : null

  // console: what this chat is called and where it opens, then how it is kept.
  // shipped: exactly the bands the default hosts have always drawn.
  // Either way destruction sits alone at the bottom, one separator away from
  // anything it could be mis-clicked for.
  const bands: ReactNode[][] = order === "console"
    ? [[rename, split, quick], [pin, copy], [remove]].map((band) => band.filter(Boolean) as ReactNode[])
    : [[pin], [copy], [rename], [remove]].map((band) => band.filter(Boolean) as ReactNode[])
  const filled = bands.filter((band) => band.length > 0)
  return (
    <>
      {filled.map((band, index) => (
        // Band position IS the identity, and a Fragment keeps the menu's DOM
        // flat: Radix's roving focus walks the content's own children.
        <Fragment key={index}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {band}
        </Fragment>
      ))}
    </>
  )
}

const contentClassName = "w-48 border-border/50"

export function AppSessionActionsMenu({
  title,
  onOpenChange,
  children,
}: {
  title: string
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const suppressCloseAutoFocus = useRef(false)
  const setMenuOpen = (next: boolean) => { setOpen(next); onOpenChange(next) }
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
        className={contentClassName}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The same panel, anchored at the pointer instead of at a trigger.
 *
 * The ui-kit has no ContextMenu primitive and the repo does not carry
 * `@radix-ui/react-context-menu`. Rather than add a second menu dependency for
 * a panel that must be pixel-identical to the kebab's, the cursor becomes the
 * anchor: a zero-size, pointer-transparent trigger is parked at the click
 * point and the SAME DropdownMenu opens against it. One primitive, one set of
 * menu styles, one keyboard model — and no divergence to keep in sync later.
 */
export function AppSessionContextMenu({
  title,
  point,
  onPointChange,
  onOpenChange,
  children,
}: {
  title: string
  point: { x: number; y: number } | null
  onPointChange: (point: { x: number; y: number } | null) => void
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <DropdownMenu
      modal={false}
      open={point !== null}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) onPointChange(null)
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          data-boring-workspace-part="app-session-context-anchor"
          tabIndex={-1}
          style={{ position: "fixed", left: point?.x ?? 0, top: point?.y ?? 0, width: 0, height: 0 }}
          className="pointer-events-none"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-boring-workspace-part="app-left-menu"
        aria-label={`Chat actions for ${title}`}
        align="start"
        side="bottom"
        sideOffset={2}
        // The anchor is a phantom: focusing it back on close would strand the
        // keyboard on a zero-size span, so focus returns to the row instead
        // (the row re-focuses itself in AppSessionRow's close handler).
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
        className={contentClassName}
      >
        {children}
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
