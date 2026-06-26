import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WorkspaceShell, projectsPreviewMode } from "./App"
import { ProjectsNavPreview } from "./ProjectsNavPreview"
import "@hachej/boring-workspace/globals.css"
import "@hachej/boring-agent/front/styles.css"
import "./app.css"

// The playground is the standalone dev surface for @hachej/boring-workspace.
// Auth, DB, user management, config — all of that belongs to @hachej/boring-core
// and is exercised separately by apps/full-app. This app still starts the
// workspace/agent dev backend for files, sessions, and UI bridge routes, but
// deliberately does NOT wrap in <BoringApp>.
// ?projects=1 / ?projects=single render the WorkspaceProjectsNav design harness.
const previewMode = projectsPreviewMode()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {previewMode ? <ProjectsNavPreview single={previewMode === "single"} /> : <WorkspaceShell />}
  </StrictMode>,
)
