import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { CliWorkspaceShell } from "./App"
import "@hachej/boring-workspace/globals.css"
import "@hachej/boring-agent/front/styles.css"
import "./app.css"

;(window as Window & { __BORING_CLI_FRONT_BUILD__?: string }).__BORING_CLI_FRONT_BUILD__ = "2026-06-29T14:45Z"

function reloadAfterStaleAssetError() {
  const storageKey = "boring-ui:asset-reload-attempted-at"
  const lastAttempt = Number(window.sessionStorage.getItem(storageKey) ?? 0)
  if (Date.now() - lastAttempt < 10_000) return
  window.sessionStorage.setItem(storageKey, String(Date.now()))
  window.location.reload()
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault()
  reloadAfterStaleAssetError()
})

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason?.message ?? event.reason ?? "")
  if (message.includes("dynamically imported module") || message.includes("Failed to fetch dynamically imported module")) {
    event.preventDefault()
    reloadAfterStaleAssetError()
  }
})

window.setTimeout(() => {
  window.sessionStorage.removeItem("boring-ui:asset-reload-attempted-at")
}, 30_000)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CliWorkspaceShell />
  </StrictMode>,
)
