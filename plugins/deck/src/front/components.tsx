import type { ReactNode } from "react"

export interface DeckScaffoldStateProps {
  children: ReactNode
}

export function DeckScaffoldState({ children }: DeckScaffoldStateProps) {
  return <div className="p-4 text-sm text-muted-foreground">{children}</div>
}
