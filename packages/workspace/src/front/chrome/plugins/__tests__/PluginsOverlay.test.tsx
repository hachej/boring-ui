import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PluginsOverlay } from "../PluginsOverlay"

const mocks = vi.hoisted(() => {
  const getJson = vi.fn()
  return {
    getJson,
    client: { getJson },
  }
})

vi.mock("../../../plugin/useWorkspacePluginClient", () => ({
  useWorkspacePluginClient: () => mocks.client,
}))

describe("PluginsOverlay states", () => {
  beforeEach(() => {
    mocks.getJson.mockReset()
  })

  it("keeps loading, empty, and error states mutually exclusive", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined
    mocks.getJson.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectRequest = reject
    }))

    render(<PluginsOverlay onClose={vi.fn()} />)

    expect(screen.getByRole("status", { name: "Loading external plugins" })).toBeInTheDocument()
    expect(screen.queryByText("No external plugins loaded")).not.toBeInTheDocument()

    rejectRequest?.(new Error("Plugin service unavailable"))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Plugin service unavailable")
    expect(screen.queryByRole("status", { name: "Loading external plugins" })).not.toBeInTheDocument()
    expect(screen.queryByText("No external plugins loaded")).not.toBeInTheDocument()

    mocks.getJson.mockResolvedValueOnce([])
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(await screen.findByText("No external plugins loaded")).toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "Loading external plugins" })).not.toBeInTheDocument()
  })

  it("labels the surface and exposes full-size management actions", async () => {
    mocks.getJson.mockResolvedValue([])
    render(<PluginsOverlay onClose={vi.fn()} />)

    await screen.findByText("No external plugins loaded")

    expect(screen.getByRole("region", { name: "Plugins" })).toHaveAccessibleDescription(
      "External plugins loaded for this workspace",
    )
    expect(screen.getByRole("group", { name: "Plugins actions" })).toBeInTheDocument()
    // Touch sizing now lives on the shared management surface action group
    // (coarse-pointer rule in globals.css), not on each consumer's buttons.
    expect(screen.getByRole("group", { name: "Plugins actions" })).toHaveClass("management-overlay-actions")
    expect(screen.getByRole("button", { name: "Reload plugins" })).not.toHaveClass("min-h-11")
    expect(screen.getByRole("button", { name: "Close plugins" })).not.toHaveClass("min-h-11")
  })

  it("ignores a stale retry response that resolves after a reload", async () => {
    mocks.getJson.mockRejectedValueOnce(new Error("Plugin service unavailable"))
    let resolveHostReload: ((value: string) => void) | undefined
    render(
      <PluginsOverlay
        onClose={vi.fn()}
        onReloadExternalPlugins={() => new Promise<string>((resolve) => {
          resolveHostReload = resolve
        })}
      />,
    )

    await screen.findByRole("alert")

    // Reload starts its host POST; the overlay stays interactive while it runs.
    fireEvent.click(screen.getByRole("button", { name: "Reload plugins" }))
    await waitFor(() => expect(resolveHostReload).toBeDefined())

    // Retry fires a GET that will resolve late (and stale).
    let resolveStale: ((value: unknown) => void) | undefined
    mocks.getJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStale = resolve
    }))
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(resolveStale).toBeDefined())

    // The reload settles and its own GET commits the fresh plugin list.
    mocks.getJson.mockResolvedValueOnce([{ id: "fresh-plugin" }])
    resolveHostReload?.("External plugins reloaded.")
    expect((await screen.findAllByText("fresh-plugin")).length).toBeGreaterThan(0)

    // The stale retry now lands with an older, empty payload — it must not win.
    resolveStale?.([])
    await waitFor(() => expect(screen.getAllByText("fresh-plugin").length).toBeGreaterThan(0))
    expect(screen.queryByText("No external plugins loaded")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
