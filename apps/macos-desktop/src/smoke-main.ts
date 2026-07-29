import { writeFile } from "node:fs/promises"
import { app, type BrowserWindow } from "electron"
import { runDesktopApplication } from "./application.js"

async function writeSmokeReport(window: BrowserWindow): Promise<void> {
  const reportPath = process.env.BORING_DESKTOP_SMOKE_REPORT_PATH
  if (!reportPath) throw new Error("BORING_DESKTOP_SMOKE_REPORT_PATH is required by the smoke entry")
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const workspaceId = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '')
      const workspaceHeaders = { 'x-boring-workspace-id': workspaceId }
      const [root, workspaces, diagnostics, plugins] = await Promise.all([
        fetch(location.origin + '/'),
        fetch(location.origin + '/api/v1/workspaces'),
        fetch(location.origin + '/api/v1/runtime-plugin-diagnostics', { headers: workspaceHeaders }),
        fetch(location.origin + '/api/v1/agent-plugins', { headers: workspaceHeaders }),
      ])
      return {
        origin: location.origin,
        rootStatus: root.status,
        workspacesStatus: workspaces.status,
        diagnosticsStatus: diagnostics.status,
        pluginsStatus: plugins.status,
        plugins: plugins.ok ? (await plugins.json()).map((plugin) => plugin.id) : [],
      }
    })()`)
    await writeFile(reportPath, JSON.stringify({ ok: true, ...result }, null, 2), "utf8")
  } catch (error) {
    process.exitCode = 1
    await writeFile(reportPath, JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2), "utf8")
  } finally {
    app.quit()
  }
}

runDesktopApplication({ onWindowLoaded: writeSmokeReport })
