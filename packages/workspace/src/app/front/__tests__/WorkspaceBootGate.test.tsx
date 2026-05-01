import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkspaceBootGate } from "../WorkspaceBootGate"

describe("WorkspaceBootGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preloads workspace endpoints before rendering children", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <WorkspaceBootGate workspaceId="w1" apiBaseUrl="/base">
        <div>Workspace ready</div>
      </WorkspaceBootGate>,
    )

    expect(screen.getByText("Opening workspace")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText("Workspace ready")).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/base/api/v1/tree?path=.",
      expect.objectContaining({
        headers: { "x-boring-workspace-id": "w1" },
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/base/api/v1/agent/sessions",
      expect.objectContaining({
        headers: { "x-boring-workspace-id": "w1" },
      }),
    )
  })

  it("renders an error fallback when preload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("offline", { status: 503 })),
    )

    render(
      <WorkspaceBootGate
        workspaceId="w1"
        errorFallback={(message) => <div>Failed: {message}</div>}
      >
        <div>Workspace ready</div>
      </WorkspaceBootGate>,
    )

    await waitFor(() => {
      expect(screen.getByText("Failed: offline")).toBeInTheDocument()
    })
  })
})
