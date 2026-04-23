import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type React from "react"

const mockFileList = vi.fn()
const mockFileWrite = vi.fn()
const mockCreateDir = vi.fn()
const mockMoveFile = vi.fn()
const mockDeleteFile = vi.fn()
const mockFileSearch = vi.fn()

const mockGetTree = vi.fn()

vi.mock("../../data", () => ({
  useFileList: (dir: string) => mockFileList(dir),
  useFileWrite: () => ({ mutateAsync: mockFileWrite }),
  useCreateDir: () => ({ mutateAsync: mockCreateDir }),
  useMoveFile: () => ({ mutateAsync: mockMoveFile }),
  useDeleteFile: () => ({ mutateAsync: mockDeleteFile }),
  useFileSearch: (query: string, limit?: number) => mockFileSearch(query, limit),
  useDataClient: () => ({ getTree: mockGetTree }),
  useApiBaseUrl: () => "/api",
}))

vi.mock("../../dock", () => ({
  PanelChrome: ({
    title,
    children,
  }: {
    title: string
    children: React.ReactNode
  }) => (
    <div data-testid="panel-chrome" data-title={title}>
      {children}
    </div>
  ),
}))

vi.mock("../../components/FileTree", () => ({
  FileTree: ({
    files,
    searchQuery,
    onSelect,
    onContextMenu,
    onDragDrop,
  }: {
    files: Array<{ name: string; path: string; kind: string }>
    searchQuery?: string
    onSelect?: (path: string) => void
    onContextMenu?: (e: React.MouseEvent, node: { name: string; path: string; kind: string }) => void
    onDragDrop?: (src: string, dst: string) => void
  }) => (
    <div data-testid="file-tree" data-search={searchQuery ?? ""}>
      {files.map((f) => (
        <div
          key={f.path}
          data-path={f.path}
          onClick={() => onSelect?.(f.path)}
          onContextMenu={(e) => {
            e.preventDefault()
            onContextMenu?.(e, f)
          }}
        >
          {f.name}
        </div>
      ))}
      <button
        type="button"
        data-testid="trigger-drag"
        onClick={() => onDragDrop?.("a.ts", "src")}
      >
        drag
      </button>
    </div>
  ),
}))

import { FileTreePane } from "../FileTreePane"

const sampleFiles = [
  { name: "src", kind: "dir" as const, path: "src" },
  { name: "index.ts", kind: "file" as const, path: "index.ts" },
  { name: "README.md", kind: "file" as const, path: "README.md" },
]

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFileSearch.mockReturnValue({ data: undefined })
  mockFileList.mockReturnValue({
    data: sampleFiles,
    isLoading: false,
    error: undefined,
  })
})

describe("FileTreePane", () => {
  it("shows loading skeleton while file list is pending", () => {
    mockFileList.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
    })
    render(<FileTreePane />, { wrapper })
    expect(screen.getByTestId("tree-skeleton")).toBeInTheDocument()
  })

  it("renders FileTree when data arrives", async () => {
    render(<FileTreePane />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toBeInTheDocument()
    })
    expect(screen.getByText("index.ts")).toBeInTheDocument()
  })

  it("shows error state on load failure", () => {
    mockFileList.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    })
    render(<FileTreePane />, { wrapper })
    expect(screen.getByText(/Failed to load files/)).toBeInTheDocument()
  })

  it("renders search input at top of pane", () => {
    render(<FileTreePane />, { wrapper })
    expect(screen.getByLabelText("Search files")).toBeInTheDocument()
  })

  it("debounces search query to FileTree", async () => {
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toBeInTheDocument()
    })

    const input = screen.getByLabelText("Search files")
    fireEvent.change(input, { target: { value: "test" } })

    await waitFor(
      () => {
        const tree = screen.getByTestId("file-tree")
        expect(tree.getAttribute("data-search")).toBe("test")
      },
      { timeout: 1000 },
    )
  })

  it("clearing search restores full tree", async () => {
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toBeInTheDocument()
    })

    const input = screen.getByLabelText("Search files")
    fireEvent.change(input, { target: { value: "test" } })

    await waitFor(
      () => {
        expect(screen.getByTestId("file-tree").getAttribute("data-search")).toBe("test")
      },
      { timeout: 1000 },
    )

    fireEvent.change(input, { target: { value: "" } })

    await waitFor(
      () => {
        expect(screen.getByTestId("file-tree").getAttribute("data-search")).toBe("")
      },
      { timeout: 1000 },
    )
  })

  it("calls bridge.openFile on file select", async () => {
    const bridge = {
      openFile: vi.fn().mockResolvedValue({ seq: 1, status: "ok" }),
    }
    render(<FileTreePane bridge={bridge as any} />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("index.ts"))
    expect(bridge.openFile).toHaveBeenCalledWith("index.ts", { mode: "edit" })
  })

  it("right-click opens context menu with actions", async () => {
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText("index.ts"))

    expect(screen.getByRole("menuitem", { name: "New file" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeInTheDocument()
  })

  it("delete context action shows AlertDialog confirmation", async () => {
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText("index.ts"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))

    await waitFor(() => {
      expect(screen.getByText("Delete index.ts?")).toBeInTheDocument()
    })
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument()
  })

  it("delete cancel does not delete", async () => {
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText("index.ts"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))

    await waitFor(() => {
      expect(screen.getByText("Delete index.ts?")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Cancel"))
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it("delete confirm calls deleteFile", async () => {
    mockDeleteFile.mockResolvedValue(undefined)
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText("index.ts"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))

    await waitFor(() => {
      expect(screen.getByText("Delete index.ts?")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => {
      expect(mockDeleteFile).toHaveBeenCalledWith({ path: "index.ts" })
    })
  })

  it("drag-and-drop triggers moveFile", async () => {
    mockMoveFile.mockResolvedValue(undefined)
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByTestId("trigger-drag")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId("trigger-drag"))
    await waitFor(() => {
      expect(mockMoveFile).toHaveBeenCalledWith({
        from: "a.ts",
        to: "src/a.ts",
      })
    })
  })

  it("renders with PanelChrome titled Files", () => {
    render(<FileTreePane />, { wrapper })
    const chrome = screen.getByTestId("panel-chrome")
    expect(chrome.getAttribute("data-title")).toBe("Files")
  })

  it("background right-click shows only New file and New folder", async () => {
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toBeInTheDocument()
    })

    const container = screen.getByTestId("file-tree").parentElement!
    fireEvent.contextMenu(container)

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "New file" })).toBeInTheDocument()
    })
    expect(screen.getByRole("menuitem", { name: "New folder" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Copy path" })).not.toBeInTheDocument()
  })
})
