import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WorkspaceShell } from "./App"
// Order is load-bearing and documented by `@hachej/boring-agent`'s own stylesheet:
// workspace globals, then agent, then app overrides. `app.css` must stay LAST —
// it is the only root that scans this app's sources (see the note in that file).
import "@hachej/boring-workspace/globals.css"
import "@hachej/boring-agent/front/styles.css"
import "./app.css"

// The playground is the standalone dev surface for @hachej/boring-workspace.
// Auth, DB, user management, config — all of that belongs to @hachej/boring-core
// and is exercised separately by apps/full-app. This app still starts the
// workspace/agent dev backend for files, sessions, and UI bridge routes, but
// deliberately does NOT wrap in <BoringApp>.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceShell />
  </StrictMode>,
)
