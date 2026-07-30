"use client"

import type { ReactNode } from "react"
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"

export function AppLeftPaneSection({
  title,
  children,
  empty,
  defaultOpen = true,
  className,
  contentClassName,
}: {
  title: string
  children: ReactNode
  empty?: string
  defaultOpen?: boolean
  className?: string
  contentClassName?: string
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  if (!hasChildren && !empty) return null

  return (
    <Disclosure defaultOpen={defaultOpen}>
      <section
        aria-label={title}
        data-boring-workspace-part="app-left-pane-section"
        data-boring-section={title.toLowerCase()}
        className={cn("space-y-0.5", className)}
      >
        <DisclosureTrigger className="h-11 w-full px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75 hover:bg-foreground/[0.045] hover:text-foreground [@media(hover:hover)_and_(min-width:640px)]:h-7">
          {title}
        </DisclosureTrigger>
        <DisclosureContent className={cn("space-y-0.5", contentClassName)}>
          {hasChildren ? children : <div className="px-2 py-1.5 text-xs text-muted-foreground/60">{empty}</div>}
        </DisclosureContent>
      </section>
    </Disclosure>
  )
}

export function SessionSubSection({ title, empty, children }: { title: ReactNode; empty?: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  if (!hasChildren && !empty) return null
  return (
    <div data-boring-workspace-part="app-left-pane-subsection" className="space-y-1">
      <div className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">
        {hasChildren ? children : <div className="px-2 py-1.5 text-xs text-muted-foreground/60">{empty}</div>}
      </div>
    </div>
  )
}
