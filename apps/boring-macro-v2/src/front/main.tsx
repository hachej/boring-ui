import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { DeckPane } from "./panes/DeckPane"
import "@boring/workspace/globals.css"
import "./app.css"

// Standalone deck route: /present?path=<deck>. Boots the SPA into deck-only
// mode so the page can be opened in a new browser tab as a presentation
// surface without the chat shell or workbench chrome. We use a query param
// (not a path segment) because Vite's SPA fallback doesn't rewrite paths
// ending in extensions like `.md` to index.html, and the deck/ working
// directory would also collide with a `/deck/` URL prefix.
const url = new URL(window.location.href)
const deckPath =
  url.pathname === "/present" || url.pathname === "/present/"
    ? url.searchParams.get("path")
    : null

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {deckPath ? (
      <div className="h-full bg-background text-foreground">
        <DeckPane params={{ path: deckPath }} />
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
)
