import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkspaceProvider } from "../../../../front/provider/WorkspaceProvider"
import { useFileTreeRoots } from "../file-tree/FileTreeRootsProvider"

const capabilities = { read: true, list: true, search: true, write: false, delete: false, move: false, mkdir: false }

function Probe() {
  const roots = useFileTreeRoots() ?? []
  return <div data-testid="roots">{roots.map((root) => root.filesystem).join(",")}</div>
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("filesystem data provider auth snapshots", () => {
  it("snapshots in-place header mutations with the auth scope request key", async () => {
    let resolveSecond!: (response: Response) => void
    let catalogCalls = 0
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (!String(input).endsWith("/api/v1/filesystems")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      }
      catalogCalls += 1
      if (catalogCalls === 1) {
        return new Response(JSON.stringify({ filesystems: [
          { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: { ...capabilities, write: true, delete: true, move: true, mkdir: true } },
          { filesystem: "private_docs", label: "Private", rootDir: "/", access: "readonly", capabilities },
        ] }), { status: 200 })
      }
      return new Promise<Response>((resolve) => { resolveSecond = resolve })
    })
    vi.stubGlobal("fetch", fetchMock)
    const headers = { Authorization: "Bearer one" }
    const renderWorkspace = (authScopeKey: string) => (
      <WorkspaceProvider authHeaders={headers} authScopeKey={authScopeKey} persistenceEnabled={false}>
        <Probe />
      </WorkspaceProvider>
    )
    const { rerender } = render(renderWorkspace("user-one"))
    await waitFor(() => expect(screen.getByTestId("roots")).toHaveTextContent("private_docs"))

    headers.Authorization = "Bearer two"
    rerender(renderWorkspace("user-two"))
    expect(screen.getByTestId("roots")).toHaveTextContent("user")
    expect(screen.getByTestId("roots")).not.toHaveTextContent("private_docs")
    await waitFor(() => expect(catalogCalls).toBe(2))
    const catalogRequests = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/v1/filesystems"))
    expect(catalogRequests[0]![1]?.headers).toEqual({ Authorization: "Bearer one" })
    expect(catalogRequests[1]![1]?.headers).toEqual({ Authorization: "Bearer two" })

    await act(async () => resolveSecond(new Response(JSON.stringify({ filesystems: [
      { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: { ...capabilities, write: true, delete: true, move: true, mkdir: true } },
    ] }), { status: 200 })))
  })
})
