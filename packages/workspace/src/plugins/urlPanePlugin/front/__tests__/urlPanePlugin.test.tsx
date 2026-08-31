import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { captureFrontPlugin } from "../../../../shared/plugins/frontFactory"
import { URL_PANE_PANEL_ID } from "../../../../shared/urlPane"
import urlPaneFront, { UrlPane, urlPanePlugin } from "../index"
import { urlPaneSandbox } from "../UrlPane"
import { WorkspacePluginClientProvider } from "../../../../front/plugin/useWorkspacePluginClient"

describe("urlPanePlugin", () => {
  const registrations = captureFrontPlugin(urlPanePlugin).registrations

  it("is the default export and registers exactly the live-demo panel", () => {
    expect(urlPaneFront).toBe(urlPanePlugin)
    expect(urlPanePlugin.pluginId).toBe("url-pane")
    expect(registrations.panels.map((panel) => panel.id)).toEqual([URL_PANE_PANEL_ID])
    expect(registrations.panels[0]).toEqual(
      expect.objectContaining({ placement: "center", source: "builtin", supportsFullPage: true }),
    )
  })
})

describe("UrlPane", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("embeds an allowed origin in a sandboxed iframe that cannot reach the workspace origin", () => {
    const { container } = render(
      <UrlPane url="http://127.0.0.1:5210/workspace/factory" policyOverride={{ origins: ["http://127.0.0.1:*"] }} />,
    )
    const iframe = container.querySelector("iframe")
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:5210/workspace/factory")
    const sandbox = iframe?.getAttribute("sandbox") ?? ""
    expect(sandbox).toContain("allow-scripts")
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer")
  })

  it("resolves a hosted runtime port before embedding it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: "https://sandbox-preview.test/demo?bl_preview_token=short-lived",
    }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const { container } = render(
      <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId="workspace-a">
        <UrlPane runtimePreview={{ port: 8_000, path: "/demo" }} />
      </WorkspacePluginClientProvider>,
    )
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull())
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://sandbox-preview.test/demo?bl_preview_token=short-lived",
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ui/runtime-web-view/preview"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    )
  })

  it("sanitizes projection failures instead of rendering server details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider-secret-host failed", { status: 502 })))
    const { container } = render(
      <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId="workspace-a">
        <UrlPane runtimePreview={{ port: 8_000 }} />
      </WorkspacePluginClientProvider>,
    )
    await screen.findByText("URL pane unavailable")
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("Could not create the runtime preview.")).toBeInTheDocument()
    expect(screen.queryByText(/provider-secret-host/)).toBeNull()
  })

  it("renders a blocked state naming the allowlist instead of an iframe", () => {
    const { container } = render(
      <UrlPane url="https://example.com/" policyOverride={{ origins: ["http://127.0.0.1:*"] }} />,
    )
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("URL blocked")).toBeInTheDocument()
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:\*/)).toBeInTheDocument()
  })

  it("fails closed when there is no workspace client to read the policy from", () => {
    const { container } = render(<UrlPane url="http://127.0.0.1:5210/" />)
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("URL pane unavailable")).toBeInTheDocument()
  })
})

describe("urlPaneSandbox", () => {
  it("grants allow-same-origin to a cross-origin demo so its module scripts are not CORS-blocked", () => {
    // Without it the frame runs on an opaque origin and a plain dev server's
    // module scripts fail to load — observed against a real hub.
    expect(urlPaneSandbox("http://127.0.0.1:5210", "http://127.0.0.1:5311")).toContain("allow-same-origin")
    expect(urlPaneSandbox("http://localhost:4000", null)).toContain("allow-same-origin")
  })

  it("withholds allow-same-origin when the target is the workspace's own origin (sandbox escape)", () => {
    expect(urlPaneSandbox("http://127.0.0.1:5311", "http://127.0.0.1:5311")).not.toContain("allow-same-origin")
    expect(urlPaneSandbox("http://127.0.0.1:5311", "http://127.0.0.1:5311")).toContain("allow-scripts")
    expect(urlPaneSandbox("HTTP://127.0.0.1:5311", "http://127.0.0.1:5311")).not.toContain("allow-same-origin")
  })
})
