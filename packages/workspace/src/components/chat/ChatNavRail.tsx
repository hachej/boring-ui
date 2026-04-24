"use client"

import { Layers3, Settings2 } from "lucide-react"
import { cn } from "../../lib/utils"
import { useChatShell } from "./context"

interface RailButtonProps {
  label: string
  shortcut?: string
  active?: boolean
  accent?: boolean
  onClick?: () => void
  children: React.ReactNode
}

function RailButton({ label, shortcut, active, accent, onClick, children }: RailButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent text-foreground",
        accent && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
      )}
    >
      {active && !accent && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary"
        />
      )}
      {children}
    </button>
  )
}

export function ChatNavRail() {
  const { surfaceOpen, toggleSurface } = useChatShell()

  return (
    <div className="flex h-full w-full flex-col items-center gap-2 border-r border-border bg-background py-3">
      <div
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
      >
        B
      </div>

      <div className="my-1 h-px w-6 bg-border" />

      <RailButton
        label={surfaceOpen ? "Hide workbench" : "Show workbench"}
        shortcut="⌘2"
        active={surfaceOpen}
        onClick={toggleSurface}
      >
        <Layers3 className="h-4 w-4" />
      </RailButton>

      <div className="flex-1" />

      <RailButton label="Settings">
        <Settings2 className="h-4 w-4" />
      </RailButton>
    </div>
  )
}
