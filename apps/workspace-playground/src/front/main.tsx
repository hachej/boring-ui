import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WorkspaceShell } from "./App"
import "@boring/agent/front/styles.css"
import "./app.css"

// The playground is the standalone dev surface for @boring/workspace.
// Auth, DB, user management, config — all of that belongs to @boring/core
// and is exercised separately by apps/full-app. This app still starts the
// workspace/agent dev backend for files, sessions, and UI bridge routes, but
// deliberately does NOT wrap in <BoringApp>.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceShell />
  </StrictMode>,
)
