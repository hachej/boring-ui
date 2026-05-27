import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type React from "react"
import { Toaster, clearToasts } from "../../../../../front/toast"

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

vi.mock("../../../../../front/dock", () => ({
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

vi.mock("../FileTree", () => {
  type Node = { name: string; path: string; kind: string; isDraft?: boolean; children?: Node[] }
  type EditingArg = { path: string; isDraft: boolean; initialValue?: string } | null
  type PendingArg = ReadonlySet<string> | undefined

  function renderNode(
    f: Node,
    editing: EditingArg | undefined,
    pending: PendingArg,
    onSelect: ((p: string) => void) | undefined,
    onContextMenu: ((e: React.MouseEvent, n: Node) => void) | undefined,
    onSubmitEdit: ((p: string, v: string) => void) | undefined,
    onCancelEdit: (() => void) | undefined,
  ): React.ReactNode {
    const isEditingHere = editing?.path === f.path
    const isPending = !!pending?.has(f.path)
    return (
      <div key={f.path}>
        <div
          data-path={f.path}
          data-kind={f.kind}
          data-draft={f.isDraft ? "1" : undefined}
          data-pending={isPending ? "1" : undefined}
          onClick={() => !isEditingHere && onSelect?.(f.path)}
          onContextMenu={(e) => {
            e.preventDefault()
            onContextMenu?.(e, f)
          }}
        >
          {isEditingHere ? (
            <input
              data-testid="file-tree-edit-input"
              defaultValue={editing?.initialValue ?? f.name}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSubmitEdit?.(f.path, (e.target as HTMLInputElement).value)
                } else if (e.key === "Escape") {
                  onCancelEdit?.()
                }
              }}
            />
          ) : (
            f.name || "(unnamed)"
          )}
          {isPending && <span data-testid="file-tree-pending-spinner" />}
        </div>
        {f.children?.map((c) =>
          renderNode(c, editing, pending, onSelect, onContextMenu, onSubmitEdit, onCancelEdit),
        )}
      </div>
    )
  }

  return {
    FileTree: ({
      files,
      searchQuery,
      editing,
      pendingPaths,
      selectedPath,
      revealPath,
      onSelect,
      onContextMenu,
      onSubmitEdit,
      onCancelEdit,
      onDragDrop,
    }: {
      files: Node[]
      searchQuery?: string
      editing?: EditingArg
      pendingPaths?: PendingArg
      selectedPath?: string | null
      revealPath?: string | null
      onSelect?: (p: string) => void
      onContextMenu?: (e: React.MouseEvent, n: Node) => void
      onSubmitEdit?: (p: string, v: string) => void
      onCancelEdit?: () => void
      onDragDrop?: (src: string, dst: string) => void
    }) => (
      <div
        data-testid="file-tree"
        data-search={searchQuery ?? ""}
        data-pending-count={pendingPaths?.size ?? 0}
        data-selected={selectedPath ?? ""}
        data-reveal={revealPath ?? ""}
      >
        {files.map((f) =>
          renderNode(
            f,
            editing,
            pendingPaths,
            onSelect,
            onContextMenu,
            onSubmitEdit,
            onCancelEdit,
          ),
        )}
        <button
          type="button"
          data-testid="trigger-drag"
          onClick={() => onDragDrop?.("a.ts", "src")}
        >
          drag
        </button>
      </div>
    ),
  }
})

import { FileTreePane } from "../FileTreeView"

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

  it("hides .boring-agent from the default tree view", async () => {
    mockFileList.mockReturnValue({
      data: [
        ...sampleFiles,
        { name: ".boring-agent", kind: "dir" as const, path: ".boring-agent" },
      ],
      isLoading: false,
      error: undefined,
    })

    render(<FileTreePane />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toBeInTheDocument()
    })

    expect(screen.queryByText(".boring-agent")).not.toBeInTheDocument()
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

  it("debounces search query to server search", async () => {
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toBeInTheDocument()
    })

    const input = screen.getByLabelText("Search files")
    fireEvent.change(input, { target: { value: "test" } })

    await waitFor(
      () => {
        expect(mockFileSearch).toHaveBeenCalledWith("*[Tt][Ee][Ss][Tt]*", 50)
      },
      { timeout: 1000 },
    )
    expect(screen.getByTestId("file-tree").getAttribute("data-search")).toBe("")
  })

  it("uses server search so nested files are included even when folders are collapsed", async () => {
    mockFileSearch.mockImplementation((query: string) => ({
      data: query ? ["src/components/Button.tsx"] : undefined,
    }))

    render(<FileTreePane />, { wrapper })

    const input = screen.getByLabelText("Search files")
    fireEvent.change(input, { target: { value: "button" } })

    await waitFor(
      () => {
        expect(mockFileSearch).toHaveBeenCalledWith("*[Bb][Uu][Tt][Tt][Oo][Nn]*", 50)
      },
      { timeout: 1000 },
    )
    expect(screen.getByText("Button.tsx")).toBeInTheDocument()
    expect(screen.getByText("Button.tsx")).toHaveAttribute("data-path", "src/components/Button.tsx")
    expect(screen.getByTestId("file-tree").getAttribute("data-search")).toBe("")
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
        expect(mockFileSearch).toHaveBeenCalledWith("*[Tt][Ee][Ss][Tt]*", 50)
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

  it("reveals active file-backed tabs in the tree", async () => {
    mockGetTree.mockResolvedValue([])
    let activeFileHandler: ((path: string | null) => void) | null = null
    const bridge = {
      getActiveFile: () => null,
      openFile: vi.fn().mockResolvedValue({ seq: 1, status: "ok" }),
      select: vi.fn((_selector, handler) => {
        activeFileHandler = handler
        return vi.fn()
      }),
    }

    render(<FileTreePane bridge={bridge as any} />, { wrapper })
    await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())
    await waitFor(() => expect(bridge.select).toHaveBeenCalled())

    act(() => activeFileHandler?.("src/nested/deep.ts"))

    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toHaveAttribute("data-selected", "src/nested/deep.ts")
      expect(screen.getByTestId("file-tree")).toHaveAttribute("data-reveal", "src/nested/deep.ts")
    })
    expect(mockGetTree).toHaveBeenCalledWith("src")
    expect(mockGetTree).toHaveBeenCalledWith("src/nested")
  })

  it("tree expand bridge events reveal folders without opening an editor", async () => {
    let expandHandler: ((payload: { path: string }) => void) | null = null
    const bridge = {
      getActiveFile: () => null,
      openFile: vi.fn().mockResolvedValue({ seq: 1, status: "ok" }),
      subscribe: vi.fn((event, handler) => {
        if (event === "tree:expand") expandHandler = handler
        return vi.fn()
      }),
    }

    render(<FileTreePane bridge={bridge as any} />, { wrapper })
    await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())
    await waitFor(() => expect(bridge.subscribe).toHaveBeenCalled())

    act(() => expandHandler?.({ path: "/src//" }))

    await waitFor(() => {
      expect(screen.getByTestId("file-tree")).toHaveAttribute("data-selected", "src")
      expect(screen.getByTestId("file-tree")).toHaveAttribute("data-reveal", "src")
    })
    expect(bridge.openFile).not.toHaveBeenCalled()
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

  it("delete confirm supports folders", async () => {
    mockDeleteFile.mockResolvedValue(undefined)
    render(<FileTreePane />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText("src"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    await waitFor(() => {
      expect(screen.getByText("Delete src?")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => {
      expect(mockDeleteFile).toHaveBeenCalledWith({ path: "src" })
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

  describe("Inline edit", () => {
    it("Rename opens an inline input prefilled with the current name", async () => {
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))

      await waitFor(() => {
        expect(screen.getByTestId("file-tree-edit-input")).toBeInTheDocument()
      })
      const input = screen.getByTestId("file-tree-edit-input") as HTMLInputElement
      expect(input.value).toBe("index.ts")
      // context menu closed once edit started
      expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument()
    })

    it("Rename submit calls moveFile with the new path and clears the input", async () => {
      mockMoveFile.mockResolvedValue(undefined)
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "renamed.ts" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() =>
        expect(mockMoveFile).toHaveBeenCalledWith({
          from: "index.ts",
          to: "renamed.ts",
        }),
      )
      await waitFor(() =>
        expect(
          screen.queryByTestId("file-tree-edit-input"),
        ).not.toBeInTheDocument(),
      )
    })

    it("Rename Esc cancels without calling moveFile", async () => {
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.keyDown(input, { key: "Escape" })

      await waitFor(() =>
        expect(
          screen.queryByTestId("file-tree-edit-input"),
        ).not.toBeInTheDocument(),
      )
      expect(mockMoveFile).not.toHaveBeenCalled()
    })

    it("New file inserts a draft row with an inline input at the right depth", async () => {
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )

      // Right-click in empty space -> background menu -> New file
      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      const draftRow = input.closest("[data-path]") as HTMLElement
      expect(draftRow.getAttribute("data-draft")).toBe("1")
      expect(draftRow.getAttribute("data-kind")).toBe("file")
    })

    it("New file submit keeps an optimistic pending row while create is in flight", async () => {
      let resolveCreate!: () => void
      mockFileWrite.mockReturnValue(new Promise<void>((resolve) => {
        resolveCreate = resolve
      }))
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())

      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "notes.md" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() => expect(screen.queryByTestId("file-tree-edit-input")).not.toBeInTheDocument())
      const pendingRow = screen.getByText("notes.md").closest("[data-path]") as HTMLElement
      expect(pendingRow).toHaveAttribute("data-path", "notes.md")
      expect(pendingRow).toHaveAttribute("data-kind", "file")
      expect(pendingRow).toHaveAttribute("data-pending", "1")

      await act(async () => resolveCreate())
    })

    it("New file submit calls writeFile with empty content at the chosen path", async () => {
      mockFileWrite.mockResolvedValue(undefined)
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())

      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "notes.md" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() =>
        expect(mockFileWrite).toHaveBeenCalledWith({
          path: "notes.md",
          content: "",
        }),
      )
    })

    it("New file submit emits filesystem created on the bus with cause:'user'", async () => {
      const { events } = await import("../../../../../front/events")
      const { filesystemEvents } = await import("../../../shared/events")
      events._reset()
      mockFileWrite.mockResolvedValue(undefined)
      const onCreated = vi.fn()
      events.on(filesystemEvents.created, onCreated)

      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())

      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "notes.md" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() =>
        expect(onCreated).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "notes.md",
            kind: "file",
            cause: "user",
          }),
        ),
      )
    })

    it("New folder submit calls createDir at the chosen path", async () => {
      mockCreateDir.mockResolvedValue(undefined)
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())

      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New folder" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "scripts" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() =>
        expect(mockCreateDir).toHaveBeenCalledWith({ path: "scripts" }),
      )
    })

    it("New file Esc cancels without calling writeFile and removes the draft row", async () => {
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())

      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.keyDown(input, { key: "Escape" })

      await waitFor(() =>
        expect(
          screen.queryByTestId("file-tree-edit-input"),
        ).not.toBeInTheDocument(),
      )
      expect(mockFileWrite).not.toHaveBeenCalled()
    })

    it("New file submit with empty input cancels (no API call)", async () => {
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())

      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "  " } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() =>
        expect(
          screen.queryByTestId("file-tree-edit-input"),
        ).not.toBeInTheDocument(),
      )
      expect(mockFileWrite).not.toHaveBeenCalled()
    })

    it("New file inside a folder routes to that folder's path", async () => {
      mockFileWrite.mockResolvedValue(undefined)
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument())

      // Right-click on the "src" directory entry — handler treats kind=dir as parent
      fireEvent.contextMenu(screen.getByText("src"))
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "child.ts" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() =>
        expect(mockFileWrite).toHaveBeenCalledWith({
          path: "src/child.ts",
          content: "",
        }),
      )
    })

    it("keeps a newly-created file visible inside an initially collapsed folder", async () => {
      mockFileWrite.mockResolvedValue(undefined)
      mockGetTree.mockResolvedValue([
        { name: "child.ts", kind: "file" as const, path: "src/child.ts" },
      ])
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument())

      fireEvent.contextMenu(screen.getByText("src"))
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "child.ts" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() => expect(mockGetTree).toHaveBeenCalledWith("src"))
      await waitFor(() => expect(screen.getByText("child.ts")).toBeInTheDocument())
    })

    it("keeps a newly-created file visible when folder refresh is stale", async () => {
      mockFileWrite.mockResolvedValue(undefined)
      mockGetTree.mockResolvedValue([])
      render(<FileTreePane />, { wrapper })
      await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument())

      fireEvent.contextMenu(screen.getByText("src"))
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))

      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "stale-child.ts" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() => expect(mockGetTree).toHaveBeenCalledWith("src"))
      await waitFor(() =>
        expect(screen.getByText("stale-child.ts")).toBeInTheDocument(),
      )
    })
  })

  describe("Copy path", () => {
    it("uses navigator.clipboard.writeText when available", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      })

      render(<FileTreePane />, { wrapper })
      await waitFor(() => {
        expect(screen.getByText("index.ts")).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

      await waitFor(() => expect(writeText).toHaveBeenCalledWith("index.ts"))
    })

    it("shows a success toast after copying", async () => {
      clearToasts()
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      })
      render(
        <>
          <FileTreePane />
          <Toaster />
        </>,
        { wrapper },
      )
      await waitFor(() => {
        expect(screen.getByText("index.ts")).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

      await waitFor(() => {
        expect(screen.getByText("Path copied")).toBeInTheDocument()
      })
      expect(screen.getByTestId("toast").getAttribute("data-variant")).toBe(
        "success",
      )
    })

    it("falls back to execCommand when navigator.clipboard is unavailable (insecure context)", async () => {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: undefined,
        configurable: true,
      })
      const execSpy = vi.fn().mockReturnValue(true)
      ;(document as { execCommand?: typeof document.execCommand }).execCommand = execSpy

      render(<FileTreePane />, { wrapper })
      await waitFor(() => {
        expect(screen.getByText("index.ts")).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

      await waitFor(() => expect(execSpy).toHaveBeenCalledWith("copy"))
      // legacy path uses a hidden textarea — make sure it gets cleaned up
      expect(document.body.querySelectorAll("textarea")).toHaveLength(0)
    })

    it("falls back to execCommand when navigator.clipboard.writeText rejects", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("not focused"))
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      })
      const execSpy = vi.fn().mockReturnValue(true)
      ;(document as { execCommand?: typeof document.execCommand }).execCommand = execSpy

      render(<FileTreePane />, { wrapper })
      await waitFor(() => {
        expect(screen.getByText("index.ts")).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

      await waitFor(() => expect(writeText).toHaveBeenCalled())
      await waitFor(() => expect(execSpy).toHaveBeenCalledWith("copy"))
    })

    it("surfaces an error toast when both clipboard paths fail", async () => {
      clearToasts()
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: undefined,
        configurable: true,
      })
      ;(document as { execCommand?: typeof document.execCommand }).execCommand = vi
        .fn()
        .mockReturnValue(false)

      render(
        <>
          <FileTreePane />
          <Toaster />
        </>,
        { wrapper },
      )
      await waitFor(() => {
        expect(screen.getByText("index.ts")).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

      await waitFor(() => {
        expect(screen.getByText("Action failed")).toBeInTheDocument()
      })
      expect(screen.getByTestId("toast").getAttribute("data-variant")).toBe(
        "error",
      )
    })
  })

  describe("Toast notifications for file actions", () => {
    beforeEach(() => clearToasts())

    function renderWithToaster() {
      return render(
        <>
          <FileTreePane />
          <Toaster />
        </>,
        { wrapper },
      )
    }

    it("Move (drag-drop) success shows a Moved toast", async () => {
      mockMoveFile.mockResolvedValue(undefined)
      renderWithToaster()
      await waitFor(() =>
        expect(screen.getByTestId("trigger-drag")).toBeInTheDocument(),
      )
      fireEvent.click(screen.getByTestId("trigger-drag"))
      await waitFor(() =>
        expect(screen.getByText("Moved")).toBeInTheDocument(),
      )
      expect(screen.getByText("a.ts → src/a.ts")).toBeInTheDocument()
      expect(screen.getByTestId("toast").getAttribute("data-variant")).toBe(
        "success",
      )
    })

    it("Move (drag-drop) failure shows a Move failed toast", async () => {
      mockMoveFile.mockRejectedValue(new Error("permission denied"))
      renderWithToaster()
      await waitFor(() =>
        expect(screen.getByTestId("trigger-drag")).toBeInTheDocument(),
      )
      fireEvent.click(screen.getByTestId("trigger-drag"))
      await waitFor(() =>
        expect(screen.getByText("Move failed")).toBeInTheDocument(),
      )
      expect(screen.getByText("permission denied")).toBeInTheDocument()
      expect(screen.getByTestId("toast").getAttribute("data-variant")).toBe(
        "error",
      )
    })

    it("Delete success shows a Deleted toast", async () => {
      mockDeleteFile.mockResolvedValue(undefined)
      renderWithToaster()
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )
      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
      await waitFor(() => expect(screen.getByText("Delete index.ts?")).toBeInTheDocument())
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))
      await waitFor(() =>
        expect(screen.getByText("Deleted")).toBeInTheDocument(),
      )
      expect(screen.getByTestId("toast").getAttribute("data-variant")).toBe(
        "success",
      )
    })

    it("Delete failure shows a Delete failed toast", async () => {
      mockDeleteFile.mockRejectedValue(new Error("file in use"))
      renderWithToaster()
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )
      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
      await waitFor(() => expect(screen.getByText("Delete index.ts?")).toBeInTheDocument())
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))
      await waitFor(() =>
        expect(screen.getByText("Delete failed")).toBeInTheDocument(),
      )
      expect(screen.getByText("file in use")).toBeInTheDocument()
      expect(screen.getByTestId("toast").getAttribute("data-variant")).toBe(
        "error",
      )
    })

    it("Rename success shows a Renamed toast", async () => {
      mockMoveFile.mockResolvedValue(undefined)
      renderWithToaster()
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )
      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "renamed.ts" } })
      fireEvent.keyDown(input, { key: "Enter" })
      await waitFor(() =>
        expect(screen.getByText("Renamed")).toBeInTheDocument(),
      )
    })

    it("New file success shows a File created toast", async () => {
      mockFileWrite.mockResolvedValue(undefined)
      renderWithToaster()
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())
      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" }))
      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "notes.md" } })
      fireEvent.keyDown(input, { key: "Enter" })
      await waitFor(() =>
        expect(screen.getByText("File created")).toBeInTheDocument(),
      )
    })

    it("New folder success shows a Folder created toast", async () => {
      mockCreateDir.mockResolvedValue(undefined)
      renderWithToaster()
      await waitFor(() => expect(screen.getByTestId("file-tree")).toBeInTheDocument())
      const container = screen.getByTestId("file-tree").parentElement!
      fireEvent.contextMenu(container)
      fireEvent.click(screen.getByRole("menuitem", { name: "New folder" }))
      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "scripts" } })
      fireEvent.keyDown(input, { key: "Enter" })
      await waitFor(() =>
        expect(screen.getByText("Folder created")).toBeInTheDocument(),
      )
    })
  })

  describe("Pending state during mutations", () => {
    it("marks the source row pending while a move is in flight, clears it after", async () => {
      let resolveMove: () => void = () => {}
      mockMoveFile.mockImplementation(
        () => new Promise<void>((res) => { resolveMove = res }),
      )
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByTestId("trigger-drag")).toBeInTheDocument(),
      )

      // Kick off the drag — pendingPaths Set should now contain "a.ts".
      fireEvent.click(screen.getByTestId("trigger-drag"))
      await waitFor(() => {
        expect(
          screen.getByTestId("file-tree").getAttribute("data-pending-count"),
        ).toBe("1")
      })

      // Resolve the mutation; the pending row clears.
      resolveMove()
      await waitFor(() =>
        expect(
          screen.getByTestId("file-tree").getAttribute("data-pending-count"),
        ).toBe("0"),
      )
    })

    it("clears pending state even if the move fails (no stuck spinner)", async () => {
      let rejectMove: (err: Error) => void = () => {}
      mockMoveFile.mockImplementation(
        () => new Promise<void>((_, rej) => { rejectMove = rej }),
      )
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByTestId("trigger-drag")).toBeInTheDocument(),
      )

      fireEvent.click(screen.getByTestId("trigger-drag"))
      await waitFor(() =>
        expect(
          screen.getByTestId("file-tree").getAttribute("data-pending-count"),
        ).toBe("1"),
      )

      rejectMove(new Error("nope"))
      await waitFor(() =>
        expect(
          screen.getByTestId("file-tree").getAttribute("data-pending-count"),
        ).toBe("0"),
      )
    })
  })

  describe("Targeted directory refresh on mutations", () => {
    it("after a move, refreshes only the affected parent dir (target=src)", async () => {
      mockMoveFile.mockResolvedValue(undefined)
      mockGetTree.mockResolvedValue([])
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByTestId("trigger-drag")).toBeInTheDocument(),
      )

      // Drag is a.ts -> src/a.ts. parentDir(a.ts)=. (root, filtered),
      // parentDir(src/a.ts)=src. Verify getTree is called with "src" exactly.
      fireEvent.click(screen.getByTestId("trigger-drag"))
      await waitFor(() => expect(mockMoveFile).toHaveBeenCalled())

      await waitFor(() => expect(mockGetTree).toHaveBeenCalledWith("src"))
      expect(mockGetTree).toHaveBeenCalledTimes(1)
    })

    it("after a rename at the root, does NOT call getTree (parent is root)", async () => {
      mockMoveFile.mockResolvedValue(undefined)
      mockGetTree.mockResolvedValue([])
      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByText("index.ts")).toBeInTheDocument(),
      )

      fireEvent.contextMenu(screen.getByText("index.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
      const input = await screen.findByTestId("file-tree-edit-input")
      fireEvent.change(input, { target: { value: "renamed.ts" } })
      fireEvent.keyDown(input, { key: "Enter" })

      await waitFor(() => expect(mockMoveFile).toHaveBeenCalled())
      // Parent of "index.ts" is the rootDir — refreshDirs filters that out
      // (top-level changes are picked up by react-query in the mutation
      // hook). So getTree should not be called here.
      await new Promise((r) => setTimeout(r, 10))
      expect(mockGetTree).not.toHaveBeenCalled()
    })

    it("after a delete inside a subfolder, refreshes only that subfolder", async () => {
      mockDeleteFile.mockResolvedValue(undefined)
      mockGetTree.mockResolvedValue([])
      mockFileList.mockReturnValue({
        data: [
          { name: "src", kind: "dir" as const, path: "src" },
          { name: "deep.ts", kind: "file" as const, path: "src/deep.ts" },
        ],
        isLoading: false,
        error: undefined,
      })

      render(<FileTreePane />, { wrapper })
      await waitFor(() =>
        expect(screen.getByText("deep.ts")).toBeInTheDocument(),
      )

      fireEvent.contextMenu(screen.getByText("deep.ts"))
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
      await waitFor(() =>
        expect(screen.getByText("Delete deep.ts?")).toBeInTheDocument(),
      )
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))

      await waitFor(() => expect(mockDeleteFile).toHaveBeenCalled())
      await waitFor(() => expect(mockGetTree).toHaveBeenCalledWith("src"))
      expect(mockGetTree).toHaveBeenCalledTimes(1)
    })
  })
})
