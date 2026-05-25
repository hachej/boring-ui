import type { PaneProps } from "@hachej/boring-workspace"
import type { DeckThemeOptions } from "../shared"
import { DeckScaffoldState } from "./components"

export interface DeckPaneProps extends PaneProps<{ path?: string }> {
  pathPrefix?: string
  theme?: DeckThemeOptions
}

export function DeckPane({ params, pathPrefix = "deck/", theme }: DeckPaneProps) {
  return (
    <div className={theme?.className}>
      <DeckScaffoldState>
        Deck scaffold for {pathPrefix}
        {params?.path ? ` (${params.path})` : ""}
      </DeckScaffoldState>
    </div>
  )
}
