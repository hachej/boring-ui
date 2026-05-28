import { Fragment, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { IDockviewPanelHeaderProps } from "dockview-react"
import { X, Loader2 } from "lucide-react"
import { getFileIcon } from "../registry/getFileIcon"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"
import { useEvent, workspaceEvents } from "../events"

type ClosablePanelApi = {
  id?: string
  close?: () => void
  setActive?: () => void
}

type ClosablePanel = ClosablePanelApi | { api?: ClosablePanelApi; id?: string }

type ClosablePanelSnapshot = {
  id?: string
  close?: () => void
}

function panelApi(panel: ClosablePanel): ClosablePanelApi {
  return "api" in panel && panel.api ? panel.api : panel
}

function panelSnapshot(panel: ClosablePanel): ClosablePanelSnapshot {
  const api = panelApi(panel)
  return {
    id: api.id ?? ("id" in panel ? panel.id : undefined),
    close: api.close ? () => api.close?.() : undefined,
  }
}

function siblingPanels(props: IDockviewPanelHeaderProps): ClosablePanel[] {
  const groupPanels = (props.api as { group?: { panels?: ClosablePanel[] } }).group?.panels
  if (Array.isArray(groupPanels)) return groupPanels
  const containerPanels = (props.containerApi as { panels?: ClosablePanel[] }).panels
  return Array.isArray(containerPanels) ? containerPanels : []
}

function readStringParam(params: unknown, key: string): string | null {
  if (!params || typeof params !== "object") return null
  const value = (params as Record<string, unknown>)[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Browser can reject when the page is not focused; fall through to legacy copy.
    }
  }
  if (typeof document === "undefined") throw new Error("Clipboard not available")
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  let ok = false
  try {
    textarea.focus()
    textarea.select()
    ok = document.execCommand?.("copy") ?? false
  } finally {
    textarea.remove()
  }
  if (!ok) throw new Error("Clipboard not available")
}

export function ShadcnTab(props: IDockviewPanelHeaderProps) {
  const { api } = props
  const [title, setTitle] = useState(api.title ?? api.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sync = () => setTitle(api.title ?? api.id)
    sync()
    const sub = api.onDidTitleChange?.(sync)
    return () => sub?.dispose?.()
  }, [api])

  useEffect(() => {
    if (!menu) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [menu])

  const isDirty = title.endsWith(" ●")
  const displayTitle = isDirty ? title.slice(0, -2) : title
  const Icon = getFileIcon(displayTitle)
  const filePath = readStringParam(props.params, "path")
  const otherTabs = siblingPanels(props)
    .map(panelSnapshot)
    .filter((sibling) => sibling.id !== api.id && sibling.close)

  // Subscribe to editor save lifecycle keyed by panelId. The badge
  // flips on at save:start and off at save:end (regardless of ok).
  // Keyed by panelId, not path, so a rename mid-save still resolves.
  const [isSaving, setIsSaving] = useState(false)
  useEvent(workspaceEvents.editorSaveStart, (p) => {
    if (p.panelId === api.id) setIsSaving(true)
  })
  useEvent(workspaceEvents.editorSaveEnd, (p) => {
    if (p.panelId === api.id) setIsSaving(false)
  })

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    api.close()
  }

  const openContextMenu = (e: React.MouseEvent | React.PointerEvent) => {
    if (!filePath && otherTabs.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const handleCopy = (text: string) => {
    setMenu(null)
    void copyText(text)
  }

  const handleCloseOthers = () => {
    setMenu(null)
    api.setActive?.()
    for (const sibling of otherTabs) sibling.close?.()
  }

  const contextMenu =
    menu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[1000] min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {filePath ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleCopy(filePath)}
              >
                Copy path
              </button>
            ) : null}
            {otherTabs.length > 0 ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                onClick={handleCloseOthers}
              >
                Close other tabs
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null

  return (
    <Fragment>
      <div
        className={cn(
          "group relative flex h-full w-full min-w-0 items-center gap-1.5 pl-2.5 pr-7 select-none",
          "text-[12.5px] leading-none tracking-tight",
          "cursor-pointer transition-colors",
        )}
        title={isDirty ? `${displayTitle} (unsaved changes)` : displayTitle}
        onPointerDown={(e) => {
          if (e.button === 2) openContextMenu(e)
        }}
        onContextMenu={openContextMenu}
      >
        {isSaving ? (
          <Loader2
            data-testid="tab-saving-spinner"
            aria-label="Saving"
            className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--accent)]"
            strokeWidth={2}
          />
        ) : (
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground/70",
              "[.dv-active-tab_&]:text-[color:var(--accent)] [.active-tab_&]:text-[color:var(--accent)]",
            )}
            strokeWidth={1.5}
          />
        )}
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{displayTitle}</span>
        {isDirty ? (
          <span
            aria-hidden="true"
            className={cn(
              "mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/35",
              "[.dv-active-tab_&]:bg-foreground/45 [.active-tab_&]:bg-foreground/45",
            )}
          />
        ) : null}
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground opacity-0",
            "focus-visible:opacity-100 group-hover:opacity-100",
            "[.dv-active-tab_&]:opacity-50 [.active-tab_&]:opacity-50",
            "[.dv-active-tab_&]:hover:opacity-100 [.active-tab_&]:hover:opacity-100",
          )}
          onClick={handleClose}
          aria-label={`Close ${displayTitle}`}
        >
          <X className="h-3 w-3" strokeWidth={2.25} />
        </IconButton>
      </div>
      {contextMenu}
    </Fragment>
  )
}
