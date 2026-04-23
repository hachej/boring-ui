import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type React from "react"

const mockFileContent = vi.fn()
const mockFileWrite = vi.fn()

vi.mock("../../data", () => ({
  useFileContent: (path: string) => mockFileContent(path),
  useFileWrite: () => ({ mutateAsync: mockFileWrite }),
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

const mockOnChange = vi.fn()
vi.mock("../../components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    content,
    onChange,
    readOnly,
    className,
  }: {
    content: string
    onChange?: (c: string) => void
    readOnly?: boolean
    className?: string
  }) => {
    if (onChange) mockOnChange.mockImplementation(onChange)
    return (
      <div
        data-testid="markdown-editor"
        data-content={content}
        data-readonly={readOnly ? "true" : "false"}
        className={className}
      >
        {content}
      </div>
    )
  },
}))

const mockMarkDirty = vi.fn()
const mockAckSync = vi.fn()
let mockIsDirty = false
let mockShouldSync = false
vi.mock("../../hooks", () => ({
  useEditorLifecycle: () => ({
    isDirty: mockIsDirty,
    isSaving: false,
    lastSavedAt: null,
    markDirty: mockMarkDirty,
    flushSave: vi.fn(),
    shouldSync: mockShouldSync,
    ackSync: mockAckSync,
  }),
}))

import { MarkdownEditorPane } from "../MarkdownEditorPane"

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsDirty = false
  mockShouldSync = false
  mockFileContent.mockReturnValue({
    data: { content: "# Hello\n\nWorld" },
    isLoading: false,
    error: undefined,
    dataUpdatedAt: 1000,
  })
})

describe("MarkdownEditorPane", () => {
  it("shows loading state while file is pending", () => {
    mockFileContent.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
      dataUpdatedAt: 0,
    })
    render(<MarkdownEditorPane path="test.md" />, { wrapper })
    expect(screen.getByText("Loading file...")).toBeInTheDocument()
  })

  it("renders MarkdownEditor with content when data arrives", async () => {
    render(<MarkdownEditorPane path="test.md" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toBeInTheDocument()
    })
    expect(screen.getByTestId("markdown-editor").getAttribute("data-content")).toBe(
      "# Hello\n\nWorld",
    )
  })

  it("shows error state on load failure", () => {
    mockFileContent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("File not found"),
      dataUpdatedAt: 0,
    })
    render(<MarkdownEditorPane path="missing.md" />, { wrapper })
    expect(screen.getByText(/Failed to load file/)).toBeInTheDocument()
  })

  it("shows filename in panel chrome title", async () => {
    render(<MarkdownEditorPane path="docs/README.md" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("panel-chrome")).toBeInTheDocument()
    })
    expect(screen.getByTestId("panel-chrome").getAttribute("data-title")).toBe(
      "README.md",
    )
  })

  it("shows dirty indicator in title when dirty", async () => {
    mockIsDirty = true
    render(<MarkdownEditorPane path="test.md" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("panel-chrome")).toBeInTheDocument()
    })
    expect(screen.getByTestId("panel-chrome").getAttribute("data-title")).toBe(
      "test.md ●",
    )
  })

  it("shows clean title when not dirty", async () => {
    mockIsDirty = false
    render(<MarkdownEditorPane path="test.md" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("panel-chrome")).toBeInTheDocument()
    })
    expect(screen.getByTestId("panel-chrome").getAttribute("data-title")).toBe(
      "test.md",
    )
  })

  it("calls markDirty on change", async () => {
    render(<MarkdownEditorPane path="test.md" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toBeInTheDocument()
    })
    mockOnChange("changed content")
    expect(mockMarkDirty).toHaveBeenCalled()
  })

  it("infers path correctly for nested files", async () => {
    render(<MarkdownEditorPane path="docs/api/guide.md" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("panel-chrome")).toBeInTheDocument()
    })
    expect(screen.getByTestId("panel-chrome").getAttribute("data-title")).toBe(
      "guide.md",
    )
  })
})
