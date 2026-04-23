import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type React from "react"

const mockFileContent = vi.fn()
const mockFileWrite = vi.fn()
const mockUseEditorLifecycle = vi.fn()

vi.mock("../../data", () => ({
  useFileContent: (path: string) => mockFileContent(path),
  useFileWrite: () => ({ mutateAsync: mockFileWrite }),
  useDataClient: () => ({}),
  useApiBaseUrl: () => "/api",
}))

vi.mock("../../hooks", () => ({
  useEditorLifecycle: (...args: unknown[]) => mockUseEditorLifecycle(...args),
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

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: ({
    content,
    language,
    onChange,
  }: {
    content: string
    language: string
    onChange?: (v: string) => void
  }) => (
    <div data-testid="code-editor" data-language={language}>
      {content}
      <button type="button" onClick={() => onChange?.("changed")}>
        edit
      </button>
    </div>
  ),
}))

import { CodeEditorPane } from "../CodeEditorPane"

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockFileContent.mockReset()
  mockFileWrite.mockReset()
  mockUseEditorLifecycle.mockReset()
  mockUseEditorLifecycle.mockReturnValue({
    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    markDirty: vi.fn(),
    flushSave: vi.fn(),
    shouldSync: false,
    ackSync: vi.fn(),
  })
})

describe("CodeEditorPane", () => {
  it("shows loading state while file is loading", () => {
    mockFileContent.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
      dataUpdatedAt: 0,
    })

    render(<CodeEditorPane path="src/main.ts" />, { wrapper })
    expect(screen.getByText("Loading file...")).toBeInTheDocument()
  })

  it("renders editor with file content once loaded", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "const hello = 1" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    render(<CodeEditorPane path="src/main.ts" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument()
    })
    expect(screen.getByText("const hello = 1")).toBeInTheDocument()
  })

  it("shows error state on load failure", () => {
    mockFileContent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Not found"),
      dataUpdatedAt: 0,
    })

    render(<CodeEditorPane path="missing.ts" />, { wrapper })
    expect(screen.getByText(/Failed to load file/)).toBeInTheDocument()
    expect(screen.getByText(/Not found/)).toBeInTheDocument()
  })

  it("infers language from file extension", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "x = 1" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    render(<CodeEditorPane path="script.py" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toHaveAttribute(
        "data-language",
        "python",
      )
    })
  })

  it("shows dirty indicator in title when modified", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "clean" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })
    mockUseEditorLifecycle.mockReturnValue({
      isDirty: true,
      isSaving: false,
      lastSavedAt: null,
      markDirty: vi.fn(),
      flushSave: vi.fn(),
      shouldSync: false,
      ackSync: vi.fn(),
    })

    render(<CodeEditorPane path="src/app.ts" />, { wrapper })
    await waitFor(() => {
      const chrome = screen.getByTestId("panel-chrome")
      expect(chrome.getAttribute("data-title")).toContain("●")
    })
  })

  it("title shows filename without dirty marker when clean", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "clean" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    render(<CodeEditorPane path="src/utils.ts" />, { wrapper })
    await waitFor(() => {
      const chrome = screen.getByTestId("panel-chrome")
      expect(chrome.getAttribute("data-title")).toBe("utils.ts")
    })
  })

  it("calls markDirty on change", async () => {
    const markDirty = vi.fn()
    mockFileContent.mockReturnValue({
      data: { content: "original" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })
    mockUseEditorLifecycle.mockReturnValue({
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      markDirty,
      flushSave: vi.fn(),
      shouldSync: false,
      ackSync: vi.fn(),
    })

    render(<CodeEditorPane path="src/index.ts" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument()
    })

    screen.getByText("edit").click()
    expect(markDirty).toHaveBeenCalled()
  })

  it("syncs content when shouldSync becomes true", async () => {
    const ackSync = vi.fn()
    const newContent = "updated from server"
    mockFileContent.mockReturnValue({
      data: { content: newContent },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })
    mockUseEditorLifecycle.mockReturnValue({
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      markDirty: vi.fn(),
      flushSave: vi.fn(),
      shouldSync: true,
      ackSync,
    })

    render(<CodeEditorPane path="src/sync.ts" />, { wrapper })
    await waitFor(() => {
      expect(ackSync).toHaveBeenCalled()
    })
  })

  it("renders with PanelChrome showing filename", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "test" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    render(<CodeEditorPane path="deep/nested/file.json" />, { wrapper })
    await waitFor(() => {
      const chrome = screen.getByTestId("panel-chrome")
      expect(chrome.getAttribute("data-title")).toBe("file.json")
    })
  })

  it("resets content when path changes", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "file-a content" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    const { rerender } = render(<CodeEditorPane path="a.ts" />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText("file-a content")).toBeInTheDocument()
    })

    mockFileContent.mockReturnValue({
      data: { content: "file-b content" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CodeEditorPane path="b.py" />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("file-b content")).toBeInTheDocument()
      const chrome = screen.getByTestId("panel-chrome")
      expect(chrome.getAttribute("data-title")).toBe("b.py")
    })
  })
})
