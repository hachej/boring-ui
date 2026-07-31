import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { captureFrontPlugin } from "../../../../shared/plugins/frontFactory"
import type { PluginProviderProps } from "../../../../shared/plugins/types"
import { filesystemPlugin } from "../index"
import { useFileTreeRoots } from "../file-tree/FileTreeRootsProvider"

const capabilities = { read: true, list: true, search: true, write: false, delete: false, move: false, mkdir: false }

function Probe() {
  const roots = useFileTreeRoots() ?? []
  return <div data-testid="roots">{roots.map((root) => root.filesystem).join(",")}</div>
}

function providerProps(overrides: Partial<PluginProviderProps>): PluginProviderProps {
  return { apiBaseUrl: "", children: <Probe />, ...overrides }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("filesystem data provider auth snapshots", () => {
  it("snapshots in-place header mutations with the auth scope request key", async () => {
    let resolveSecond!: (response: Response) => void
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ filesystems: [
        { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: { ...capabilities, write: true, delete: true, move: true, mkdir: true } },
        { filesystem: "private_docs", label: "Private", rootDir: "/", access: "readonly", capabilities },
      ] }), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSecond = resolve }))
    vi.stubGlobal("fetch", fetchMock)
    const captured = captureFrontPlugin(filesystemPlugin)
    const Provider = captured.registrations.providers.find((provider) => provider.id === "filesystem-data")!.component
    const headers = { Authorization: "Bearer one" }
    const { rerender } = render(<Provider {...providerProps({ authHeaders: headers, authScopeKey: "user-one" })} />)
    await waitFor(() => expect(screen.getByTestId("roots")).toHaveTextContent("private_docs"))

    headers.Authorization = "Bearer two"
    rerender(<Provider {...providerProps({ authHeaders: headers, authScopeKey: "user-two" })} />)
    expect(screen.getByTestId("roots")).toHaveTextContent("user")
    expect(screen.getByTestId("roots")).not.toHaveTextContent("private_docs")
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({ Authorization: "Bearer one" })
    expect(fetchMock.mock.calls[1]![1]?.headers).toEqual({ Authorization: "Bearer two" })

    await act(async () => resolveSecond(new Response(JSON.stringify({ filesystems: [
      { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: { ...capabilities, write: true, delete: true, move: true, mkdir: true } },
    ] }), { status: 200 })))
  })
})
