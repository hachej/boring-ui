import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type React from "react"

const mockFileContent = vi.fn()
const mockFileWrite = vi.fn()
const mockUseEditorLifecycle = vi.fn()

vi.mock("../../data", () => ({
  useFileContent: (path: string, options?: unknown) => mockFileContent(path, options),
  useFileWrite: () => ({ mutateAsync: mockFileWrite }),
  useDataClient: () => ({}),
  useApiBaseUrl: () => "/api",
}))

vi.mock("../../../../../front/hooks", () => ({
  useEditorLifecycle: (...args: unknown[]) => mockUseEditorLifecycle(...args),
}))

vi.mock("../CodeEditor", () => ({
  CodeEditor: ({
    content,
    language,
    onChange,
    readOnly,
  }: {
    content: string
    language: string
    onChange?: (v: string) => void
    readOnly?: boolean
  }) => (
    <div data-testid="code-editor" data-language={language} data-readonly={readOnly ? "true" : "false"}>
      {content}
      <button type="button" onClick={() => onChange?.("changed")}>
        edit
      </button>
    </div>
  ),
}))

import { FetchError } from "../../data/fetchClient"
import { CodeEditorPane } from "../CodeEditorPane"
import { createMockPaneProps } from "../../../../../front/testing/createMockPaneProps"

const paneProps = (path: string) => createMockPaneProps({ path })

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
    markClean: vi.fn(),
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
    render(<CodeEditorPane {...paneProps("src/main.ts")} />, { wrapper })
    expect(screen.getByText("Loading file...")).toBeInTheDocument()
  })

  it("renders editor with file content once loaded", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "const hello = 1" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })
    render(<CodeEditorPane {...paneProps("src/main.ts")} />, { wrapper })
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
    render(<CodeEditorPane {...paneProps("missing.ts")} />, { wrapper })
    expect(screen.getByText(/Failed to load file/)).toBeInTheDocument()
    expect(screen.getByText(/Not found/)).toBeInTheDocument()
  })

  it("passes filesystem to loading hook and sanitizes denied company errors", () => {
    mockFileContent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new FetchError(404, "FORBIDDEN_FINANCE_SECRET_123 /secret/finance.md"),
      dataUpdatedAt: 0,
    })
    const props = createMockPaneProps({ params: { path: "/company/hr/policy.md", filesystem: "company_context" } })

    render(<CodeEditorPane {...props} />, { wrapper })

    expect(mockFileContent).toHaveBeenCalledWith("/company/hr/policy.md", expect.objectContaining({ filesystem: "company_context" }))
    expect(screen.getByText("not found or denied")).toBeInTheDocument()
    expect(screen.queryByText(/FORBIDDEN_FINANCE_SECRET_123/)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret\/finance/)).not.toBeInTheDocument()
  })

  it("opens company files in readonly mode without dirtying or writing", async () => {
    const markDirty = vi.fn()
    const setTitle = vi.fn()
    mockFileContent.mockReturnValue({
      data: { content: "secret policy", mtimeMs: 123, access: "readonly" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })
    mockUseEditorLifecycle.mockReturnValue({
      isDirty: true,
      isSaving: false,
      lastSavedAt: null,
      markDirty,
      markClean: vi.fn(),
      flushSave: vi.fn(),
      shouldSync: false,
      ackSync: vi.fn(),
      externalChangeWhileDirty: false,
      ackExternalChange: vi.fn(),
      notifySaved: vi.fn(),
    })
    const props = createMockPaneProps({
      params: { path: "/company/hr/policy.ts", filesystem: "company_context", access: "readwrite" },
      apiOverrides: { setTitle },
    })

    render(<CodeEditorPane {...props} />, { wrapper })

    await waitFor(() => expect(screen.getByTestId("code-editor")).toHaveAttribute("data-readonly", "true"))
    expect(screen.getByText("Readonly")).toBeInTheDocument()
    expect(setTitle).toHaveBeenCalledWith("policy.ts (readonly)")
    expect(mockUseEditorLifecycle.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ adapter: null }))

    screen.getByText("edit").click()
    expect(markDirty).not.toHaveBeenCalled()
    expect(mockFileWrite).not.toHaveBeenCalled()
  })

  it("infers language from file extension", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "x = 1" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })
    render(<CodeEditorPane {...paneProps("script.py")} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toHaveAttribute(
        "data-language",
        "python",
      )
    })
  })

  it("shows dirty indicator in dockview tab title when modified", async () => {
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
      markClean: vi.fn(),
      flushSave: vi.fn(),
      shouldSync: false,
      ackSync: vi.fn(),
    })

    const setTitle = vi.fn()
    const props = createMockPaneProps({
      params: { path: "src/app.ts" },
      apiOverrides: { setTitle },
    })
    render(<CodeEditorPane {...props} />, { wrapper })
    await waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith("app.ts ●")
    })
  })

  it("sets dockview tab title to filename when clean", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "clean" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    const setTitle = vi.fn()
    const props = createMockPaneProps({
      params: { path: "src/utils.ts" },
      apiOverrides: { setTitle },
    })
    render(<CodeEditorPane {...props} />, { wrapper })
    await waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith("utils.ts")
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
      markClean: vi.fn(),
      flushSave: vi.fn(),
      shouldSync: false,
      ackSync: vi.fn(),
    })
    render(<CodeEditorPane {...paneProps("src/index.ts")} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument()
    })
    screen.getByText("edit").click()
    expect(markDirty).toHaveBeenCalled()
  })

  it("syncs content when shouldSync becomes true", async () => {
    const ackSync = vi.fn()
    mockFileContent.mockReturnValue({
      data: { content: "updated from server" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })
    mockUseEditorLifecycle.mockReturnValue({
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      markDirty: vi.fn(),
      markClean: vi.fn(),
      flushSave: vi.fn(),
      shouldSync: true,
      ackSync,
    })
    render(<CodeEditorPane {...paneProps("src/sync.ts")} />, { wrapper })
    await waitFor(() => {
      expect(ackSync).toHaveBeenCalled()
    })
  })

  it("uses just the basename for the dockview tab title (deep paths)", async () => {
    mockFileContent.mockReturnValue({
      data: { content: "test" },
      isLoading: false,
      error: undefined,
      dataUpdatedAt: Date.now(),
    })

    const setTitle = vi.fn()
    const props = createMockPaneProps({
      params: { path: "deep/nested/file.json" },
      apiOverrides: { setTitle },
    })
    render(<CodeEditorPane {...props} />, { wrapper })
    await waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith("file.json")
    })
  })

  it("renders 'No file selected' placeholder when params.path is missing", () => {
    // dockview can restore a panel from a serialized layout that lost
    // its params. The pane must not crash; it shows a placeholder.
    mockFileContent.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
      dataUpdatedAt: 0,
    })
    const props = createMockPaneProps<{ path?: string }>({ params: {} })
    render(<CodeEditorPane {...props} />, { wrapper })
    expect(screen.getByText(/no file selected/i)).toBeInTheDocument()
  })
})
