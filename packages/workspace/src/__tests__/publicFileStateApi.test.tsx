import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  WorkspaceFilesProvider,
  useApiBaseUrl,
  useFilePane,
  useWorkspaceRequestId,
} from "@hachej/boring-workspace"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("public file-state API", () => {
  it("supports consumer imports through @hachej/boring-workspace", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: "# hello deck", mtimeMs: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspaceFilesProvider
        apiBaseUrl="/api"
        authHeaders={{ "x-boring-workspace-id": "workspace-1" }}
      >
        {children}
      </WorkspaceFilesProvider>
    )

    const { result } = renderHook(
      () => ({
        pane: useFilePane({ path: "deck/intro.md" }),
        apiBaseUrl: useApiBaseUrl(),
        workspaceRequestId: useWorkspaceRequestId(),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.pane.content).toBe("# hello deck"))

    expect(result.current.apiBaseUrl).toBe("/api")
    expect(result.current.workspaceRequestId).toBe("workspace-1")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/api/v1/files?path=deck%2Fintro.md",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("fails loudly when useFilePane is mounted without WorkspaceFilesProvider", () => {
    expect(() => renderHook(() => useFilePane({ path: "deck/intro.md" }))).toThrow(
      "useDataClient must be used within a DataProvider",
    )
  })
})
