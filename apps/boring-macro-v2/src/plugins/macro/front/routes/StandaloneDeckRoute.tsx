import type { ReactNode } from "react"
import type { PaneProps } from "@boring/workspace"
import { DeckPane } from "../panels/DeckPane"

function currentDeckPath(): string | null {
  if (typeof window === "undefined") return null
  const url = new URL(window.location.href)
  if (url.pathname !== "/present" && url.pathname !== "/present/") return null
  return url.searchParams.get("path")
}

const standalonePaneApi = {
  onDidParametersChange: () => ({ dispose() {} }),
} as unknown as PaneProps<{ path: string }>["api"]
const standaloneContainerApi = {} as PaneProps<{ path: string }>["containerApi"]

export function MacroStandaloneDeckRoute({ fallback }: { fallback: ReactNode }) {
  const deckPath = currentDeckPath()
  if (!deckPath) return <>{fallback}</>

  return (
    <div className="h-full bg-background text-foreground">
      <DeckPane
        params={{ path: deckPath }}
        api={standalonePaneApi}
        containerApi={standaloneContainerApi}
      />
    </div>
  )
}
