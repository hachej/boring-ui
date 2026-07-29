import { randomBytes } from "node:crypto"
import { app, BrowserWindow, dialog, session } from "electron"
import { startEmbeddedBoringUiServer } from "@hachej/boring-ui-cli/server"
import { DesktopLifecycle } from "./lifecycle.js"
import {
  createSecureWindowOptions,
  DESKTOP_CAPABILITY_HEADER,
  hardenDesktopWindow,
  installDesktopCapability,
} from "./security.js"

export interface DesktopApplicationOptions {
  onWindowLoaded?(window: BrowserWindow): Promise<void> | void
}

export function runDesktopApplication(options: DesktopApplicationOptions = {}): void {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()
  if (!hasSingleInstanceLock) {
    app.quit()
    return
  }

  let lifecycle: DesktopLifecycle | undefined
  let quitAfterCleanup = false

  function createLifecycle(): DesktopLifecycle {
    const capabilityToken = randomBytes(32).toString("hex")
    return new DesktopLifecycle({
      startServer: async () => await startEmbeddedBoringUiServer({
        registryPath: process.env.BORING_UI_WORKSPACES_PATH,
        requestCapability: {
          headerName: DESKTOP_CAPABILITY_HEADER,
          token: capabilityToken,
        },
      }),
      createWindow: async (server) => {
        const removeCapability = installDesktopCapability(session.defaultSession, server.origin, capabilityToken)
        const window = new BrowserWindow(createSecureWindowOptions())
        const removeHardening = hardenDesktopWindow(window, server.origin)
        let cleaned = false
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          removeHardening()
          removeCapability()
        }
        window.once("ready-to-show", () => window.show())
        window.on("closed", () => lifecycle?.windowClosed(window))
        try {
          await window.loadURL(server.initialUrl)
          await options.onWindowLoaded?.(window)
        } catch (error) {
          cleanup()
          if (!window.isDestroyed()) window.close()
          throw error
        }
        return { window, cleanup }
      },
      reportStartupError(error) {
        dialog.showErrorBox(
          "Boring UI could not start",
          error instanceof Error ? error.message : String(error),
        )
      },
    })
  }

  function activateDesktop(): void {
    void lifecycle?.activate().catch((error) => {
      dialog.showErrorBox(
        "Boring UI could not open a window",
        error instanceof Error ? error.message : String(error),
      )
    })
  }

  app.on("second-instance", activateDesktop)
  app.on("activate", activateDesktop)

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("before-quit", (event) => {
    if (quitAfterCleanup) return
    event.preventDefault()
    void (lifecycle?.stop() ?? Promise.resolve())
      .catch((error) => console.error("[boring-ui-desktop] shutdown failed", error))
      .finally(() => {
        quitAfterCleanup = true
        app.quit()
      })
  })

  void app.whenReady().then(async () => {
    lifecycle = createLifecycle()
    await lifecycle.start()
  }).catch(() => {
    app.quit()
  })
}
