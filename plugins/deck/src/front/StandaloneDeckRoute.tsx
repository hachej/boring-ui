import type { DeckThemeOptions, DeckWidgetDefinition } from "../shared"
import { DeckPane } from "./DeckPane"

export interface StandaloneDeckRouteProps {
  path?: string
  content?: string
  theme?: DeckThemeOptions
  widgets?: DeckWidgetDefinition[]
  onError?: (error: import("../shared").DeckError) => void
}

export function StandaloneDeckRoute({ path, content, theme, widgets, onError }: StandaloneDeckRouteProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DeckPane
        params={path ? { path } : {}}
        content={content}
        theme={theme}
        widgets={widgets}
        onError={onError}
        initialMode="present"
      />
    </div>
  )
}
