import { DeckScaffoldState } from "./components"

export interface StandaloneDeckRouteProps {
  path?: string
}

export function StandaloneDeckRoute({ path }: StandaloneDeckRouteProps) {
  return <DeckScaffoldState>Standalone deck scaffold{path ? ` for ${path}` : ""}</DeckScaffoldState>
}
