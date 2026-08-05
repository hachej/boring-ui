import { fireEvent, render, screen } from "@testing-library/react"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import { describe, expect, it } from "vitest"
import urlPanePlugin, { URL_PANE_PANEL_ID, UrlPane } from "../index"

function navigateTo(value: string) {
  const address = screen.getByRole("textbox", { name: "Address" })
  fireEvent.change(address, { target: { value } })
  fireEvent.submit(address.closest("form")!)
}

describe("urlPanePlugin", () => {
  it("registers one shared Dockview pane and its command", () => {
    const captured = captureFrontPlugin(urlPanePlugin)

    expect(captured.registrations.panels).toEqual([
      expect.objectContaining({
        id: URL_PANE_PANEL_ID,
        label: "URL Pane",
        placement: "shared-dockview",
        component: UrlPane,
      }),
    ])
    expect(captured.registrations.panelCommands).toEqual([
      expect.objectContaining({
        id: "url-pane.open",
        title: "Open URL Pane",
        panelId: URL_PANE_PANEL_ID,
      }),
    ])
  })

  it("navigates, refreshes, and reports iframe load errors", () => {
    render(<UrlPane />)

    navigateTo("example.com/docs")
    const frame = screen.getByTitle("URL viewer: https://example.com/docs")
    expect(frame).toHaveAttribute("src", "https://example.com/docs")

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(screen.getByTitle("URL viewer: https://example.com/docs")).not.toBe(frame)

    fireEvent.error(screen.getByTitle("URL viewer: https://example.com/docs"))
    expect(screen.getByRole("alert")).toHaveTextContent("security headers")
  })

  it("keeps the eight most recent distinct URLs and navigates from the list", () => {
    const { unmount } = render(<UrlPane />)

    for (let index = 1; index <= 9; index += 1) navigateTo(`example.com/${index}`)

    expect(JSON.parse(localStorage.getItem("boring-url-pane:recent-urls:v1") ?? "[]")).toEqual([
      "https://example.com/9",
      "https://example.com/8",
      "https://example.com/7",
      "https://example.com/6",
      "https://example.com/5",
      "https://example.com/4",
      "https://example.com/3",
      "https://example.com/2",
    ])

    unmount()
    render(<UrlPane />)
    fireEvent.change(screen.getByRole("combobox", { name: "Recent URLs" }), {
      target: { value: "https://example.com/4" },
    })
    expect(screen.getByTitle("URL viewer: https://example.com/4")).toBeInTheDocument()
  })

  it("rejects non-web protocols", () => {
    render(<UrlPane />)

    navigateTo("javascript:alert(1)")

    expect(screen.getByRole("alert")).toHaveTextContent("valid HTTP or HTTPS URL")
    expect(screen.queryByTitle(/URL viewer:/)).not.toBeInTheDocument()
  })
})
