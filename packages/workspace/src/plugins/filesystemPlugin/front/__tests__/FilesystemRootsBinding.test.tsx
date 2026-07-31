import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DataProvider } from "../data/DataProvider"
import { FilesystemRootsBinding } from "../FilesystemRootsBinding"
import { useFileTreeRoots } from "../file-tree/FileTreeRootsProvider"

const mutable = { read: true, list: true, search: true, write: true, delete: true, move: true, mkdir: true }
const readonly = { read: true, list: true, search: true, write: false, delete: false, move: false, mkdir: false }

function Probe() {
  const roots = useFileTreeRoots() ?? []
  return <div data-testid="roots">{roots.map((root) => `${root.filesystem}:${root.capabilities?.write}`).join(",")}</div>
}

function Harness({ client, requestKey = "one" }: { client: any; requestKey?: string }) {
  return (
    <DataProvider apiBaseUrl="" client={client}>
      <FilesystemRootsBinding requestKey={requestKey}><Probe /></FilesystemRootsBinding>
    </DataProvider>
  )
}

afterEach(() => vi.restoreAllMocks())

describe("FilesystemRootsBinding", () => {
  it("shows only Workspace while loading and maps a successful generic catalog", async () => {
    let resolve!: (value: any[]) => void
    const client = { getFilesystems: vi.fn(() => new Promise<any[]>((done) => { resolve = done })) }
    render(<Harness client={client} />)
    expect(screen.getByTestId("roots")).toHaveTextContent("user:true")

    await act(async () => resolve([
      { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: mutable },
      { filesystem: "project_alpha", label: "Project", rootDir: "/", access: "readonly", capabilities: readonly },
    ]))
    await waitFor(() => expect(screen.getByTestId("roots")).toHaveTextContent("user:true,project_alpha:false"))
  })

  it("changing only the explicit auth scope fails closed immediately and reloads", async () => {
    let resolveSecond!: (value: any[]) => void
    const client = { getFilesystems: vi.fn()
      .mockResolvedValueOnce([
        { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: mutable },
        { filesystem: "private_docs", label: "Private", rootDir: "/", access: "readonly", capabilities: readonly },
      ])
      .mockImplementationOnce(() => new Promise<any[]>((done) => { resolveSecond = done })) }
    const { rerender } = render(<Harness client={client} requestKey="cookie-user-one" />)
    await waitFor(() => expect(screen.getByTestId("roots")).toHaveTextContent("private_docs"))

    rerender(<Harness client={client} requestKey="cookie-user-two" />)
    expect(screen.getByTestId("roots")).toHaveTextContent("user:true")
    expect(screen.getByTestId("roots")).not.toHaveTextContent("private_docs")
    expect(client.getFilesystems).toHaveBeenCalledTimes(2)

    await act(async () => resolveSecond([
      { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: mutable },
    ]))
    expect(screen.getByTestId("roots")).toHaveTextContent("user:true")
  })

  it("fails closed and never renders stale roots after request identity changes", async () => {
    let reject!: (error: Error) => void
    const oldClient = { getFilesystems: vi.fn(async () => [
      { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: mutable },
      { filesystem: "private_docs", label: "Private", rootDir: "/", access: "readonly", capabilities: readonly },
    ]) }
    const newClient = { getFilesystems: vi.fn(() => new Promise<any[]>((_resolve, fail) => { reject = fail })) }
    const { rerender } = render(<Harness client={oldClient} requestKey="old" />)
    await waitFor(() => expect(screen.getByTestId("roots")).toHaveTextContent("private_docs"))

    rerender(<Harness client={newClient} requestKey="new" />)
    expect(screen.getByTestId("roots")).toHaveTextContent("user:true")
    expect(screen.getByTestId("roots")).not.toHaveTextContent("private_docs")
    await act(async () => reject(new Error("404")))
    expect(screen.getByTestId("roots")).toHaveTextContent("user:true")
  })

  it("fails closed and refetches on window focus", async () => {
    const client = { getFilesystems: vi.fn(async () => [
      { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite", capabilities: mutable },
      { filesystem: "private_docs", label: "Private", rootDir: "/", access: "readonly", capabilities: readonly },
    ]) }
    render(<Harness client={client} />)
    await waitFor(() => expect(screen.getByTestId("roots")).toHaveTextContent("private_docs"))

    act(() => window.dispatchEvent(new Event("focus")))
    expect(screen.getByTestId("roots")).toHaveTextContent("user:true")
    await waitFor(() => expect(client.getFilesystems).toHaveBeenCalledTimes(2))
  })
})
