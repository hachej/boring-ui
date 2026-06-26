import { cn } from '../../lib'

export type NoticeLevel = 'info' | 'warning' | 'error'

export function noticeSurfaceClass(level: NoticeLevel, className?: string): string {
  return cn(
    'rounded-[var(--radius-md)] border px-3 py-2 text-[13px] leading-5 shadow-none',
    level === 'error' && 'border-destructive/25 bg-destructive/[0.07] text-foreground',
    level === 'warning' && 'border-amber-500/25 bg-amber-500/[0.07] text-foreground',
    level === 'info' && 'border-border/60 bg-muted/35 text-foreground',
    className,
  )
}

export function noticeIconClass(level: NoticeLevel, className?: string): string {
  return cn(
    'mt-0.5 size-4 shrink-0',
    level === 'error' && 'text-destructive',
    level === 'warning' && 'text-amber-600 dark:text-amber-300',
    level === 'info' && 'text-muted-foreground',
    className,
  )
}

export function noticeTextClass(className?: string): string {
  return cn('min-w-0 whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]', className)
}
