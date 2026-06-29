"use client"

import type { ReactNode } from "react"

export function SessionSubSection({ title, empty, children }: { title: string; empty?: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  if (!hasChildren && !empty) return null
  return (
    <div className="space-y-1">
      <div className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
        {title}
      </div>
      <div className="space-y-0.5">
        {hasChildren ? children : <div className="px-2 py-1.5 text-xs text-muted-foreground/60">{empty}</div>}
      </div>
    </div>
  )
}
