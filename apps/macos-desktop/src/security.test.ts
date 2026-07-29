import { EventEmitter } from "node:events"
import { describe, expect, test, vi } from "vitest"
import type { BrowserWindow, Session } from "electron"
import {
  createSecureWindowOptions,
  DESKTOP_CAPABILITY_HEADER,
  hardenDesktopWindow,
  installDesktopCapability,
  isAllowedNavigation,
} from "./security.js"

describe("desktop security policy", () => {
  test("uses hardened renderer defaults", () => {
    expect(createSecureWindowOptions().webPreferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    })
  })

  test("allows only the exact application origin", () => {
    const origin = "http://127.0.0.1:43210"
    expect(isAllowedNavigation(origin, `${origin}/workspace/example`)).toBe(true)
    expect(isAllowedNavigation(origin, "http://127.0.0.1:43211/")).toBe(false)
    expect(isAllowedNavigation(origin, `${origin}.attacker.invalid/`)).toBe(false)
    expect(isAllowedNavigation(origin, "not a URL")).toBe(false)
  })

  test("merges the capability for only the exact origin filter and removes the listener", () => {
    const onBeforeSendHeaders = vi.fn()
    const electronSession = { webRequest: { onBeforeSendHeaders } } as unknown as Session
    const cleanup = installDesktopCapability(electronSession, "http://127.0.0.1:43210", "secret")
    const [filter, listener] = onBeforeSendHeaders.mock.calls[0]
    expect(filter).toEqual({ urls: ["http://127.0.0.1:43210/*"] })
    const callback = vi.fn()
    listener({ requestHeaders: { Accept: "application/json" } }, callback)
    expect(callback).toHaveBeenCalledWith({
      requestHeaders: {
        Accept: "application/json",
        [DESKTOP_CAPABILITY_HEADER]: "secret",
      },
    })
    cleanup()
    expect(onBeforeSendHeaders).toHaveBeenLastCalledWith(
      { urls: ["http://127.0.0.1:43210/*"] },
      null,
    )
  })

  test("denies permissions, downloads, unexpected navigation, and new windows", () => {
    const electronSession = new EventEmitter() as EventEmitter & {
      setPermissionCheckHandler: ReturnType<typeof vi.fn>
      setPermissionRequestHandler: ReturnType<typeof vi.fn>
    }
    electronSession.setPermissionCheckHandler = vi.fn()
    electronSession.setPermissionRequestHandler = vi.fn()
    const webContents = new EventEmitter() as EventEmitter & {
      session: typeof electronSession
      setWindowOpenHandler: ReturnType<typeof vi.fn>
    }
    webContents.session = electronSession
    webContents.setWindowOpenHandler = vi.fn()
    const window = { webContents } as unknown as BrowserWindow
    const cleanup = hardenDesktopWindow(window, "http://127.0.0.1:43210")

    const permissionCheckHandler = electronSession.setPermissionCheckHandler.mock.calls[0][0]
    expect(permissionCheckHandler()).toBe(false)
    const permissionHandler = electronSession.setPermissionRequestHandler.mock.calls[0][0]
    const permissionCallback = vi.fn()
    permissionHandler({}, "camera", permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)

    const downloadEvent = { preventDefault: vi.fn() }
    electronSession.emit("will-download", downloadEvent)
    expect(downloadEvent.preventDefault).toHaveBeenCalled()

    const sameOriginEvent = { preventDefault: vi.fn() }
    webContents.emit("will-navigate", sameOriginEvent, "http://127.0.0.1:43210/workspace/a")
    expect(sameOriginEvent.preventDefault).not.toHaveBeenCalled()
    const externalEvent = { preventDefault: vi.fn() }
    webContents.emit("will-navigate", externalEvent, "https://example.com")
    expect(externalEvent.preventDefault).toHaveBeenCalled()
    const externalRedirectEvent = { preventDefault: vi.fn() }
    webContents.emit("will-redirect", externalRedirectEvent, "https://example.com")
    expect(externalRedirectEvent.preventDefault).toHaveBeenCalled()
    expect(webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: "deny" })

    cleanup()
    expect(electronSession.setPermissionCheckHandler).toHaveBeenLastCalledWith(null)
    expect(electronSession.setPermissionRequestHandler).toHaveBeenLastCalledWith(null)
    expect(electronSession.listenerCount("will-download")).toBe(0)
    expect(webContents.listenerCount("will-navigate")).toBe(0)
    expect(webContents.listenerCount("will-redirect")).toBe(0)
  })
})
