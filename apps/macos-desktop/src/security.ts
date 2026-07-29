import type {
  BeforeSendResponse,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  OnBeforeSendHeadersListenerDetails,
  Session,
} from "electron"

export const DESKTOP_CAPABILITY_HEADER = "X-Boring-Desktop-Capability"

export function createSecureWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Boring UI",
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  }
}

export function isAllowedNavigation(origin: string, candidate: string): boolean {
  try {
    return new URL(candidate).origin === origin
  } catch {
    return false
  }
}

export function installDesktopCapability(
  electronSession: Session,
  origin: string,
  token: string,
): () => void {
  const listener = (
    details: OnBeforeSendHeadersListenerDetails,
    callback: (response: BeforeSendResponse) => void,
  ) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        [DESKTOP_CAPABILITY_HEADER]: token,
      },
    })
  }
  electronSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, listener)
  return () => electronSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, null)
}

export function hardenDesktopWindow(window: BrowserWindow, origin: string): () => void {
  const electronSession = window.webContents.session
  const denyPermission: Parameters<Session["setPermissionRequestHandler"]>[0] = (_contents, _permission, callback) => callback(false)
  const denyDownload: Parameters<Session["on"]>[1] = (event) => event.preventDefault()
  const restrictNavigation = (event: Electron.Event, target: string) => {
    if (!isAllowedNavigation(origin, target)) event.preventDefault()
  }

  electronSession.setPermissionCheckHandler(() => false)
  electronSession.setPermissionRequestHandler(denyPermission)
  electronSession.on("will-download", denyDownload)
  window.webContents.on("will-navigate", restrictNavigation)
  window.webContents.on("will-redirect", restrictNavigation)
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))

  return () => {
    electronSession.setPermissionCheckHandler(null)
    electronSession.setPermissionRequestHandler(null)
    electronSession.removeListener("will-download", denyDownload)
    window.webContents.removeListener("will-navigate", restrictNavigation)
    window.webContents.removeListener("will-redirect", restrictNavigation)
  }
}
