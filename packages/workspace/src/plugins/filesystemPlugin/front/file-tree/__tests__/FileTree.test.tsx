import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FileTree, type FileTreeNode } from "../FileTree"

const sampleFiles: FileTreeNode[] = [
  {
    name: "src",
    kind: "dir",
    path: "src",
    children: [
      { name: "index.ts", kind: "file", path: "src/index.ts" },
      { name: "app.tsx", kind: "file", path: "src/app.tsx" },
      {
        name: "utils",
        kind: "dir",
        path: "src/utils",
        children: [
          { name: "helpers.ts", kind: "file", path: "src/utils/helpers.ts" },
        ],
      },
    ],
  },
  { name: "package.json", kind: "file", path: "package.json" },
  { name: "README.md", kind: "file", path: "README.md" },
]

describe("FileTree", () => {
  it("renders empty state when files=[]", () => {
    render(<FileTree files={[]} />)
    expect(screen.getByText("No files")).toBeInTheDocument()
  })

  it("renders flat file list", () => {
    const flatFiles: FileTreeNode[] = [
      { name: "a.ts", kind: "file", path: "a.ts" },
      { name: "b.json", kind: "file", path: "b.json" },
      { name: "c.md", kind: "file", path: "c.md" },
    ]
    render(<FileTree files={flatFiles} height={200} />)
    expect(screen.getByText("a.ts")).toBeInTheDocument()
    expect(screen.getByText("b.json")).toBeInTheDocument()
    expect(screen.getByText("c.md")).toBeInTheDocument()
  })

  it("renders nested directory structure", () => {
    render(<FileTree files={sampleFiles} height={300} />)
    expect(screen.getByText("src")).toBeInTheDocument()
    expect(screen.getByText("package.json")).toBeInTheDocument()
  })

  it("renders standalone without any provider", () => {
    const { container } = render(<FileTree files={sampleFiles} height={200} />)
    expect(container.firstChild).toBeTruthy()
  })

  it("accepts className prop", () => {
    const { container } = render(
      <FileTree files={sampleFiles} className="custom-tree" height={200} />,
    )
    expect(container.querySelector(".custom-tree")).toBeTruthy()
  })

  it("calls onSelect when file is activated", () => {
    const onSelect = vi.fn()
    render(<FileTree files={sampleFiles} onSelect={onSelect} height={200} />)
    const pkg = screen.getByText("package.json")
    fireEvent.click(pkg)
    expect(onSelect).toHaveBeenCalledWith("package.json")
  })

  it("calls onContextMenu with event and node on right-click", () => {
    const onContextMenu = vi.fn()
    render(
      <FileTree
        files={sampleFiles}
        onContextMenu={onContextMenu}
        height={200}
      />,
    )
    const pkg = screen.getByText("package.json")
    fireEvent.contextMenu(pkg)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
    const [, node] = onContextMenu.mock.calls[0]
    expect(node.path).toBe("package.json")
    expect(node.kind).toBe("file")
  })

  it("context menu does not trigger onSelect", () => {
    const onSelect = vi.fn()
    const onContextMenu = vi.fn()
    render(
      <FileTree
        files={sampleFiles}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        height={200}
      />,
    )
    const pkg = screen.getByText("package.json")
    fireEvent.contextMenu(pkg)
    expect(onContextMenu).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("toggles directory on click", () => {
    const onExpand = vi.fn()
    const onCollapse = vi.fn()
    render(
      <FileTree
        files={sampleFiles}
        onExpand={onExpand}
        onCollapse={onCollapse}
        height={300}
      />,
    )
    const srcDir = screen.getByText("src")
    // Click to expand
    fireEvent.click(srcDir)
    // Click again to collapse
    fireEvent.click(srcDir)
    // Both callbacks should have been called at least once between the two clicks
    expect(onExpand.mock.calls.length + onCollapse.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it("filters nodes by searchQuery", () => {
    render(
      <FileTree files={sampleFiles} searchQuery="package" height={300} />,
    )
    expect(screen.getByText("package.json")).toBeInTheDocument()
  })

  it("case-insensitive search", () => {
    render(
      <FileTree files={sampleFiles} searchQuery="PACKAGE" height={300} />,
    )
    expect(screen.getByText("package.json")).toBeInTheDocument()
  })

  it("renders 1000+ files without crashing", () => {
    const manyFiles: FileTreeNode[] = Array.from({ length: 1000 }, (_, i) => ({
      name: `file-${i}.ts`,
      kind: "file" as const,
      path: `file-${i}.ts`,
    }))
    const { container } = render(<FileTree files={manyFiles} height={300} />)
    expect(container.querySelector(".file-tree")).toBeTruthy()
  })

  it("renders with role=tree on root", () => {
    render(<FileTree files={sampleFiles} height={200} />)
    expect(screen.getByRole("tree")).toBeInTheDocument()
  })

  it("renders tree items with role=treeitem", () => {
    render(<FileTree files={sampleFiles} height={200} />)
    const items = screen.getAllByRole("treeitem")
    expect(items.length).toBeGreaterThan(0)
  })

  it("opens a collapsed parent folder when a draft row is inserted inside it", async () => {
    const files: FileTreeNode[] = [
      {
        name: "src",
        kind: "dir",
        path: "src",
        children: [
          {
            name: "",
            kind: "file",
            path: "__draft__:1",
            isDraft: true,
          },
        ],
      },
    ]

    render(
      <FileTree
        files={files}
        height={200}
        editing={{ path: "__draft__:1", isDraft: true }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId("file-tree-edit-input")).toBeInTheDocument()
    })
  })

  it("reveals a created child path by opening its collapsed parent folder", async () => {
    const files: FileTreeNode[] = [
      {
        name: "src",
        kind: "dir",
        path: "src",
        children: [
          {
            name: "child.ts",
            kind: "file",
            path: "src/child.ts",
          },
        ],
      },
    ]

    render(<FileTree files={files} height={200} revealPath="src/child.ts" />)

    await waitFor(() => {
      expect(screen.getByText("child.ts")).toBeInTheDocument()
    })
  })

  it("keeps a reveal request pending until the target node exists", async () => {
    const onRevealHandled = vi.fn()
    const { rerender } = render(
      <FileTree files={[]} height={200} revealPath="deck" onRevealHandled={onRevealHandled} />,
    )

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(onRevealHandled).not.toHaveBeenCalled()

    rerender(
      <FileTree
        files={[{ name: "deck", kind: "dir", path: "deck", children: [] }]}
        height={200}
        revealPath="deck"
        onRevealHandled={onRevealHandled}
      />,
    )

    await waitFor(() => expect(onRevealHandled).toHaveBeenCalledWith("deck"))
  })
})
