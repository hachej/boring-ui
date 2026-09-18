import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { AppRunnerPane, type AppRunnerPaneParams } from "../AppRunnerPane"

const DEBUG_VISIBLE_STORAGE_KEY = "boring:app-runner:debug-visible"
const SIGNED_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJ3cyI6IndzLTEifQ.deadbeefsignaturevalue"
const SIGNED_APP_URL = `http://8-ws--1-5-myapp.apps.localhost:9878/t/${SIGNED_TOKEN}/`

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function paneProps(params: AppRunnerPaneParams): PaneProps<AppRunnerPaneParams> {
  return { params, api: {} as PaneProps["api"], containerApi: {} as PaneProps["containerApi"] }
}

function stubHubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith("/apps")) {
      return jsonResponse({
        workspaceId: "ws-1",
        apps: [{
          appName: "myapp",
          workspaceId: "ws-1",
          kind: "app",
          version: 2,
          sha: "abcdef123456",
          url: "x",
          updatedAt: "now",
          appId: "ws-1--myapp",
          appUrl: SIGNED_APP_URL,
          toolProvenance: [{ kind: "app", address: "myapp", version: 2, sha: "abcdef123456789012" }],
          toolManifest: { tools: [{ name: "count_entries", route: "/count" }, { name: "pin_entry", route: "/pin" }] },
        }],
      })
    }
    if (url.endsWith("/versions")) {
      return jsonResponse({ versions: [{ version: 2, kind: "app", sha: "abcdef123456", created_at: "now", current: true, previewUrl: "/p/2/" }], appId: "ws-1--myapp", appUrl: "/open/" })
    }
    if (url.endsWith("/logs")) {
      return jsonResponse({ lines: ["server started", "GET / 200"], errors: [{ created_at: "2026-09-17T10:00:00Z", path: "/api/save", message: "TypeError: boom" }] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
}

describe("AppRunnerPane debug toggle", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("defaults to the app-only view: iframe visible, no debug chrome", async () => {
    stubHubFetch()

    render(<AppRunnerPane {...paneProps({ appName: "myapp" })} />)

    expect(await screen.findByTitle("myapp preview")).toHaveAttribute("sandbox", "allow-scripts allow-forms")
    expect(screen.getByTitle("myapp preview").getAttribute("sandbox")).not.toContain("allow-same-origin")
    expect(screen.queryByTestId("app-runner-metadata")).not.toBeInTheDocument()
    expect(screen.queryByTestId("app-runner-logs")).not.toBeInTheDocument()
    expect(screen.queryByText("Rollback")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show app debug details" })).toBeInTheDocument()
    // The app selector remains reachable in the default view (it is navigation).
    expect(screen.getByRole("combobox", { name: "Select app" })).toBeInTheDocument()
  })

  it("reveals kind, sha, provenance, logs, tools, and version controls when the debug toggle is on, without hiding the app", async () => {
    stubHubFetch()

    render(<AppRunnerPane {...paneProps({ appName: "myapp" })} />)
    await screen.findByTitle("myapp preview")

    fireEvent.click(screen.getByRole("button", { name: "Show app debug details" }))

    expect(await screen.findByText(/\/api\/save · TypeError: boom/)).toBeInTheDocument()
    expect(screen.getByText("GET / 200")).toBeInTheDocument()
    expect(screen.getByTestId("app-runner-logs")).toBeInTheDocument()
    expect(screen.getByTestId("app-runner-metadata")).toHaveTextContent("Kind: app")
    expect(screen.getByTestId("app-runner-metadata")).toHaveTextContent("SHA: abcdef123456")
    expect(screen.getByTestId("app-runner-metadata")).toHaveTextContent("count_entries, pin_entry")
    expect(screen.getByLabelText("Mounted tool provenance")).toHaveTextContent("app myapp · v2 · abcdef123456")
    expect(screen.getByRole("button", { name: "Rollback" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Activate version" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Select version" })).toBeInTheDocument()
    // The app stays mounted while debug is open.
    expect(screen.getByTitle("myapp preview")).toBeInTheDocument()
  })

  it("persists the toggle per browser in localStorage and honors it on remount, defaulting off", async () => {
    stubHubFetch()

    const { unmount } = render(<AppRunnerPane {...paneProps({ appName: "myapp" })} />)
    await screen.findByTitle("myapp preview")
    expect(localStorage.getItem(DEBUG_VISIBLE_STORAGE_KEY)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Show app debug details" }))
    expect(localStorage.getItem(DEBUG_VISIBLE_STORAGE_KEY)).toBe("1")
    unmount()

    render(<AppRunnerPane {...paneProps({ appName: "myapp" })} />)
    await screen.findByTitle("myapp preview")
    expect(screen.getByTestId("app-runner-metadata")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Hide app debug details" }))
    expect(localStorage.getItem(DEBUG_VISIBLE_STORAGE_KEY)).toBeNull()
  })

  it("masks the signed token in the debug URL text while the iframe src still carries it", async () => {
    stubHubFetch()

    render(<AppRunnerPane {...paneProps({ appName: "myapp" })} />)
    await screen.findByTitle("myapp preview")

    fireEvent.click(screen.getByRole("button", { name: "Show app debug details" }))
    await screen.findByTestId("app-runner-metadata")

    // The debug panel's own text never contains the raw token: shoulder
    // surfing or a screenshot of this pane must not leak a usable credential.
    const metadata = screen.getByTestId("app-runner-metadata")
    expect(metadata.textContent).not.toContain(SIGNED_TOKEN)
    expect(screen.getByTestId("app-runner-masked-url").textContent).toMatch(/\/t\/•+\//)

    // The token still necessarily appears in the DOM via the iframe src —
    // the browser must send it to load the app. Masking the displayed text
    // does not and cannot hide that; see the comment above maskSignedAppUrl.
    expect(screen.getByTitle("myapp preview")).toHaveAttribute("src", SIGNED_APP_URL)
  })

  it("copies the real, credentialed URL (not the masked text) when the copy action is used", async () => {
    stubHubFetch()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    render(<AppRunnerPane {...paneProps({ appName: "myapp" })} />)
    await screen.findByTitle("myapp preview")
    fireEvent.click(screen.getByRole("button", { name: "Show app debug details" }))
    await screen.findByTestId("app-runner-metadata")

    fireEvent.click(screen.getByTestId("app-runner-copy-url"))

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(SIGNED_APP_URL))

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
  })
})
