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

const mockOnChange = vi.fn()
vi.mock("../MarkdownEditor", () => ({
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
vi.mock("../../../../front/hooks", () => ({
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
import { createMockPaneProps } from "../../../../front/testing/createMockPaneProps"

const paneProps = (path: string) => createMockPaneProps({ path })

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
    render(<MarkdownEditorPane {...paneProps("test.md")} />, { wrapper })
    expect(screen.getByText("Loading file...")).toBeInTheDocument()
  })

  it("renders MarkdownEditor with content when data arrives", async () => {
    render(<MarkdownEditorPane {...paneProps("test.md")} />, { wrapper })
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
    render(<MarkdownEditorPane {...paneProps("missing.md")} />, { wrapper })
    expect(screen.getByText(/Failed to load file/)).toBeInTheDocument()
  })

  it("sets dockview tab title to filename for nested paths", async () => {
    const setTitle = vi.fn()
    const props = createMockPaneProps({
      params: { path: "docs/README.md" },
      apiOverrides: { setTitle },
    })
    render(<MarkdownEditorPane {...props} />, { wrapper })
    await waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith("README.md")
    })
  })

  it("shows dirty indicator in dockview tab title when modified", async () => {
    mockIsDirty = true
    const setTitle = vi.fn()
    const props = createMockPaneProps({
      params: { path: "test.md" },
      apiOverrides: { setTitle },
    })
    render(<MarkdownEditorPane {...props} />, { wrapper })
    await waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith("test.md ●")
    })
  })

  it("sets dockview tab title to filename when clean", async () => {
    mockIsDirty = false
    const setTitle = vi.fn()
    const props = createMockPaneProps({
      params: { path: "test.md" },
      apiOverrides: { setTitle },
    })
    render(<MarkdownEditorPane {...props} />, { wrapper })
    await waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith("test.md")
    })
  })

  it("calls markDirty on change", async () => {
    render(<MarkdownEditorPane {...paneProps("test.md")} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toBeInTheDocument()
    })
    mockOnChange("changed content")
    expect(mockMarkDirty).toHaveBeenCalled()
  })

  it("uses just the basename for deeply nested paths", async () => {
    const setTitle = vi.fn()
    const props = createMockPaneProps({
      params: { path: "docs/api/guide.md" },
      apiOverrides: { setTitle },
    })
    render(<MarkdownEditorPane {...props} />, { wrapper })
    await waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith("guide.md")
    })
  })

  it("renders 'No file selected' placeholder when params.path is missing", () => {
    mockFileContent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
      dataUpdatedAt: 0,
    })
    const props = createMockPaneProps<{ path?: string }>({ params: {} })
    render(<MarkdownEditorPane {...props} />, { wrapper })
    expect(screen.getByText(/no file selected/i)).toBeInTheDocument()
  })
})
