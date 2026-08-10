import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { captureFrontPlugin } from "../../../../shared/plugins/frontFactory"
import { URL_PANE_PANEL_ID } from "../../../../shared/urlPane"
import urlPaneFront, { UrlPane, urlPanePlugin } from "../index"

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
  it("embeds an allowed origin in a sandboxed iframe that cannot reach the workspace origin", () => {
    const { container } = render(
      <UrlPane url="http://127.0.0.1:5210/workspace/factory" policyOverride={{ origins: ["http://127.0.0.1:*"] }} />,
    )
    const iframe = container.querySelector("iframe")
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:5210/workspace/factory")
    const sandbox = iframe?.getAttribute("sandbox") ?? ""
    expect(sandbox).toContain("allow-scripts")
    expect(sandbox).not.toContain("allow-same-origin")
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer")
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
