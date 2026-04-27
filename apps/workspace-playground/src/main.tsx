import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { WorkspaceShell } from "./App"
import "@boring/workspace/globals.css"
import "./app.css"

// The playground is the standalone dev surface for @boring/workspace.
// Auth, DB, user management, config — all of that belongs to @boring/core
// and is exercised separately by apps/full-app. The whole point of this
// app is being able to test workspace components without a backend, so
// we deliberately do NOT wrap in <BoringApp>; just a plain BrowserRouter.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/workspace/:id" element={<WorkspaceShell />} />
        <Route path="/*" element={<WorkspaceShell />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
