"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { CheckIcon, AlertCircleIcon, InfoIcon, XIcon } from "lucide-react"
import { IconButton } from "@boring/ui"
import { cn } from "../lib/utils"

export type ToastVariant = "info" | "success" | "error"

export interface ToastInput {
  /** Bold first line. */
  title?: string
  /** Body text — falls back to title when omitted. */
  description?: string
  /** Visual treatment. Default: "info". */
  variant?: ToastVariant
  /** Auto-dismiss timeout in ms. Default 3000. Pass 0 to disable. */
  durationMs?: number
}

export interface ToastRecord extends ToastInput {
  id: string
  createdAt: number
}

type Listener = (toasts: ToastRecord[]) => void

let toasts: ToastRecord[] = []
const listeners = new Set<Listener>()
let nextId = 0

function emit() {
  for (const l of listeners) l(toasts)
}

function addToast(input: ToastInput): string {
  const id = `t${++nextId}`
  const record: ToastRecord = {
    ...input,
    id,
    createdAt: Date.now(),
    durationMs: input.durationMs ?? 3000,
  }
  toasts = [...toasts, record]
  emit()
  if (record.durationMs && record.durationMs > 0) {
    // Setting timeout in module scope is fine — only fires while a Toaster is
    // mounted to render anything.
    setTimeout(() => dismissToast(id), record.durationMs)
  }
  return id
}

export function dismissToast(id: string) {
  const before = toasts.length
  toasts = toasts.filter((t) => t.id !== id)
  if (toasts.length !== before) emit()
}

/** Subscribe to toast changes. Returns an unsubscribe fn. Test helper. */
export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn)
  fn(toasts)
  return () => {
    listeners.delete(fn)
  }
}

/** Returns a snapshot of active toasts. Test helper. */
export function getActiveToasts(): ToastRecord[] {
  return toasts
}

/** Clear every toast immediately. Test helper. */
export function clearToasts() {
  if (toasts.length === 0) return
  toasts = []
  emit()
}

export interface ToastApi {
  (input: string | ToastInput): string
  success: (input: string | ToastInput) => string
  error: (input: string | ToastInput) => string
  info: (input: string | ToastInput) => string
  dismiss: (id: string) => void
}

function normalize(input: string | ToastInput, variant: ToastVariant): ToastInput {
  return typeof input === "string"
    ? { title: input, variant }
    : { variant, ...input }
}

/**
 * App-global toast notification. Module-level so any code in the workspace
 * package (utility helpers, store actions, …) can call it without prop
 * drilling. Rendered by the `<Toaster />` mounted by `WorkspaceProvider`.
 */
export const toast: ToastApi = Object.assign(
  (input: string | ToastInput) => addToast(normalize(input, "info")),
  {
    success: (input: string | ToastInput) =>
      addToast(normalize(input, "success")),
    error: (input: string | ToastInput) =>
      addToast(normalize(input, "error")),
    info: (input: string | ToastInput) => addToast(normalize(input, "info")),
    dismiss: dismissToast,
  },
)

const VARIANT_ICON: Record<ToastVariant, typeof CheckIcon> = {
  success: CheckIcon,
  error: AlertCircleIcon,
  info: InfoIcon,
}

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success:
    "border-accent/40 bg-background text-foreground [&_[data-toast-icon]]:text-accent",
  error:
    "border-destructive/50 bg-background text-foreground [&_[data-toast-icon]]:text-destructive",
  info: "border-border bg-background text-foreground [&_[data-toast-icon]]:text-foreground/70",
}

export interface ToasterProps {
  /** Where to anchor the stack. Default: bottom-right. */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  className?: string
}

/**
 * Mount once near the app root (WorkspaceProvider already does this). Reads
 * from the module-level store so any caller of `toast(...)` can render here.
 */
export function Toaster({ position = "bottom-right", className }: ToasterProps) {
  const [items, setItems] = useState<ToastRecord[]>(() => toasts)

  useEffect(() => subscribeToasts(setItems), [])

  if (typeof document === "undefined") return null

  const node = (
    <div
      role="region"
      aria-label="Notifications"
      data-testid="toaster"
      className={cn(
        "pointer-events-none fixed z-[1000] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2",
        position === "bottom-right" && "bottom-4 right-4 items-end",
        position === "bottom-left" && "bottom-4 left-4 items-start",
        position === "top-right" && "top-4 right-4 items-end",
        position === "top-left" && "top-4 left-4 items-start",
        className,
      )}
    >
      {items.map((t) => {
        const variant = t.variant ?? "info"
        const Icon = VARIANT_ICON[variant]
        return (
          <div
            key={t.id}
            role="status"
            data-testid="toast"
            data-variant={variant}
            className={cn(
              "pointer-events-auto flex w-full items-start gap-2.5 rounded-md border px-3 py-2 shadow-md",
              "animate-in fade-in slide-in-from-bottom-2 duration-150",
              VARIANT_CLASS[variant],
            )}
          >
            <Icon
              data-toast-icon
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1">
              {t.title && (
                <div className="text-sm font-medium leading-snug">
                  {t.title}
                </div>
              )}
              {t.description && (
                <div
                  className={cn(
                    "text-xs text-muted-foreground",
                    t.title ? "mt-0.5" : "leading-snug",
                  )}
                >
                  {t.description}
                </div>
              )}
            </div>
            <IconButton
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="shrink-0 text-muted-foreground/70"
            >
              <XIcon className="h-3 w-3" strokeWidth={2} />
            </IconButton>
          </div>
        )
      })}
    </div>
  )

  return createPortal(node, document.body)
}
