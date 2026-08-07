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
    expect(screen.getByRole("button", { name: "Reload plugins" })).toHaveClass("min-h-11", "min-w-11")
    expect(screen.getByRole("button", { name: "Close plugins" })).toHaveClass("min-h-11", "min-w-11")
  })
})
