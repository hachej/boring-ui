import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkspaceBootGate } from "../WorkspaceBootGate"

const SESSION_PRELOAD_PATHS = ["/api/v1/tree?path=.", "/api/v1/agent/sessions"]

describe("WorkspaceBootGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preloads workspace endpoints before rendering children", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status: 204 }))
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
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/sessions"))).toBe(false)
  })

  it("skips agent runtime warmup when provisioning is disabled", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <WorkspaceBootGate workspaceId="w1" provisionWorkspace={false}>
        <div>Workspace ready</div>
      </WorkspaceBootGate>,
    )

    await waitFor(() => {
      expect(screen.getByText("Workspace ready")).toBeInTheDocument()
    })

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/sessions"))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/ready-status"))).toBe(false)
  })

  it("keeps refetching retryable preparing paths after ready status completes", async () => {
    let sessionCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/v1/agent/sessions")) {
        sessionCalls += 1
        if (sessionCalls <= 2) {
          return new Response(JSON.stringify({ error: { code: "AGENT_RUNTIME_NOT_READY", retryable: true } }), { status: 503 })
        }
      }
      if (url.includes("/api/v1/ready-status")) {
        return new Response('data: {"state":"ready"}\n\n', { status: 200 })
      }
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <WorkspaceBootGate workspaceId="w1" preloadPaths={SESSION_PRELOAD_PATHS}>
        <div>Workspace ready</div>
      </WorkspaceBootGate>,
    )

    await waitFor(() => {
      expect(screen.getByText("Workspace ready")).toBeInTheDocument()
    }, { timeout: 2_500 })

    expect(sessionCalls).toBe(3)
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
