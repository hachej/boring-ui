import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from './lib'
import { IconButton } from './icon-button'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastInput {
  title?: string
  description?: string
  variant?: ToastVariant
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
  for (const listener of listeners) listener(toasts)
}

function addToast(input: ToastInput): string {
  const id = `t${++nextId}`
  const record: ToastRecord = { ...input, id, createdAt: Date.now(), durationMs: input.durationMs ?? 3000 }
  toasts = [...toasts, record]
  emit()
  if (record.durationMs && record.durationMs > 0) setTimeout(() => dismissToast(id), record.durationMs)
  return id
}

export function dismissToast(id: string) {
  const before = toasts.length
  toasts = toasts.filter((toast) => toast.id !== id)
  if (toasts.length !== before) emit()
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => listeners.delete(listener)
}

export function getActiveToasts(): ToastRecord[] {
  return toasts
}

export function clearToasts() {
  if (!toasts.length) return
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
  return typeof input === 'string' ? { title: input, variant } : { variant, ...input }
}

export const toast: ToastApi = Object.assign(
  (input: string | ToastInput) => addToast(normalize(input, 'info')),
  {
    success: (input: string | ToastInput) => addToast(normalize(input, 'success')),
    error: (input: string | ToastInput) => addToast(normalize(input, 'error')),
    info: (input: string | ToastInput) => addToast(normalize(input, 'info')),
    dismiss: dismissToast,
  },
)

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: 'border-accent/40 bg-background text-foreground [&_[data-toast-icon]]:text-accent',
  error: 'border-destructive/50 bg-background text-foreground [&_[data-toast-icon]]:text-destructive',
  info: 'border-border bg-background text-foreground [&_[data-toast-icon]]:text-foreground/70',
}

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: '✓',
  error: '!',
  info: 'i',
}

export interface ToasterProps {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  className?: string
}

export function Toaster({ position = 'bottom-right', className }: ToasterProps) {
  const [items, setItems] = React.useState<ToastRecord[]>(() => toasts)

  React.useEffect(() => subscribeToasts(setItems), [])

  if (typeof document === 'undefined') return null

  const node = (
    <div
      role="region"
      aria-label="Notifications"
      data-testid="toaster"
      className={cn(
        'pointer-events-none fixed z-[1000] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2',
        position === 'bottom-right' && 'bottom-4 right-4 items-end',
        position === 'bottom-left' && 'bottom-4 left-4 items-start',
        position === 'top-right' && 'top-4 right-4 items-end',
        position === 'top-left' && 'top-4 left-4 items-start',
        className,
      )}
    >
      {items.map((item) => {
        const variant = item.variant ?? 'info'
        return (
          <div
            key={item.id}
            role="status"
            data-testid="toast"
            data-variant={variant}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-2.5 rounded-md border px-3 py-2 shadow-md',
              'animate-in fade-in slide-in-from-bottom-2 duration-150',
              VARIANT_CLASS[variant],
            )}
          >
            <span data-toast-icon className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[11px] font-semibold leading-none">
              {VARIANT_ICON[variant]}
            </span>
            <div className="min-w-0 flex-1">
              {item.title && <div className="text-sm font-medium leading-snug">{item.title}</div>}
              {item.description && <div className={cn('text-xs text-muted-foreground', item.title ? 'mt-0.5' : 'leading-snug')}>{item.description}</div>}
            </div>
            <IconButton type="button" variant="ghost" size="icon-xs" onClick={() => dismissToast(item.id)} aria-label="Dismiss" className="shrink-0 text-muted-foreground/70">
              <span aria-hidden="true" className="text-[13px] leading-none">×</span>
            </IconButton>
          </div>
        )
      })}
    </div>
  )

  return createPortal(node, document.body)
}
