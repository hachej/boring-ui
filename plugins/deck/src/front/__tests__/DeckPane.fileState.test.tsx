import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@hachej/boring-workspace", async () => {
  const actual = await vi.importActual<typeof import("@hachej/boring-workspace")>("@hachej/boring-workspace")
  return {
    ...actual,
    MarkdownEditor: ({ content, onChange }: { content: string; onChange?: (next: string) => void }) => (
      <textarea
        data-testid="deck-markdown-editor"
        value={content}
        onChange={(event) => onChange?.(event.target.value)}
      />
    ),
  }
})

import { WorkspaceFilesProvider } from "@hachej/boring-workspace"
import { DeckPane } from "../DeckPane"

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <WorkspaceFilesProvider
      apiBaseUrl="/api"
      authHeaders={{ "x-boring-workspace-id": "workspace-1" }}
    >
      {children}
    </WorkspaceFilesProvider>
  )
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

describe("DeckPane file-state integration", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("surfaces missing-file errors through canonical storage loading", async () => {
    const onError = vi.fn()
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: "not_found" } }, { status: 404, statusText: "Not Found" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<DeckPane params={{ path: "deck/missing.md" }} onError={onError} />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByTestId("deck-error-state")).toHaveTextContent("HTTP 404"))

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "storage",
        path: "deck/missing.md",
      }),
    )
  })

  it("autosaves edits through the public workspace file-state seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/files?") && init?.method !== "POST") {
        return jsonResponse({ content: "# Intro\n\nHello", mtimeMs: 1 })
      }
      if (url.endsWith("/api/v1/files") && init?.method === "POST") {
        return jsonResponse({ ok: true, mtimeMs: 2 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<DeckPane params={{ path: "deck/intro.md" }} />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByTestId("deck-mode-edit")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("deck-mode-edit"))
    fireEvent.change(screen.getByTestId("deck-markdown-editor"), {
      target: { value: "# Intro\n\nUpdated" },
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/api/v1/files",
        expect.objectContaining({ method: "POST" }),
      ),
    )

    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    expect(postCall?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          path: "deck/intro.md",
          content: "# Intro\n\nUpdated",
          expectedMtimeMs: 1,
        }),
      }),
    )
  })

  it("surfaces conflicts and reloads the latest server version", async () => {
    const onError = vi.fn()
    let getCount = 0
    let postCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/files?") && init?.method !== "POST") {
        getCount += 1
        if (getCount >= 2) {
          return jsonResponse({ content: "# Intro\n\nServer latest", mtimeMs: 2 })
        }
        return jsonResponse({ content: "# Intro\n\nHello", mtimeMs: 1 })
      }
      if (url.endsWith("/api/v1/files") && init?.method === "POST") {
        postCount += 1
        return jsonResponse(
          { error: { code: "conflict", currentMtimeMs: 2, expectedMtimeMs: 1 } },
          { status: 409, statusText: "Conflict" },
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<DeckPane params={{ path: "deck/conflict.md" }} onError={onError} />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByTestId("deck-mode-edit")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("deck-mode-edit"))
    fireEvent.change(screen.getByTestId("deck-markdown-editor"), {
      target: { value: "# Intro\n\nChanged" },
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })

    await waitFor(() => expect(screen.getByTestId("deck-conflict-notice")).toBeInTheDocument())
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ type: "conflict", path: "deck/conflict.md" }),
    )

    fireEvent.click(screen.getByTestId("deck-reload"))

    await waitFor(() => expect(screen.queryByTestId("deck-conflict-notice")).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByTestId("deck-markdown-editor")).toHaveValue("# Intro\n\nServer latest"),
    )
    expect(getCount).toBeGreaterThanOrEqual(2)
    expect(postCount).toBe(1)
  })

  it("keeps the local draft and conflict banner when reload does not refetch fresh server data", async () => {
    const onError = vi.fn()
    let getCount = 0
    let postCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/files?") && init?.method !== "POST") {
        getCount += 1
        if (getCount >= 2) {
          return jsonResponse({ error: { code: "unavailable" } }, { status: 503, statusText: "Unavailable" })
        }
        return jsonResponse({ content: "# Intro\n\nHello", mtimeMs: 1 })
      }
      if (url.endsWith("/api/v1/files") && init?.method === "POST") {
        postCount += 1
        if (postCount === 1) {
          return jsonResponse(
            { error: { code: "conflict", currentMtimeMs: 2, expectedMtimeMs: 1 } },
            { status: 409, statusText: "Conflict" },
          )
        }
        return jsonResponse({ ok: true, mtimeMs: 3 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<DeckPane params={{ path: "deck/conflict.md" }} onError={onError} />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByTestId("deck-mode-edit")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("deck-mode-edit"))
    fireEvent.change(screen.getByTestId("deck-markdown-editor"), {
      target: { value: "# Intro\n\nChanged" },
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })

    await waitFor(() => expect(screen.getByTestId("deck-conflict-notice")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("deck-reload"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.getByTestId("deck-conflict-notice")).toBeInTheDocument()
    expect(screen.getByTestId("deck-markdown-editor")).toHaveValue("# Intro\n\nChanged")

    fireEvent.click(screen.getByTestId("deck-save"))

    await waitFor(() => expect(postCount).toBe(2))
    await waitFor(() => expect(screen.queryByTestId("deck-conflict-notice")).not.toBeInTheDocument())
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ type: "conflict", path: "deck/conflict.md" }),
    )
  })

  it("surfaces conflicts and lets the user overwrite", async () => {
    const onError = vi.fn()
    let postCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/files?") && init?.method !== "POST") {
        return jsonResponse({ content: "# Intro\n\nHello", mtimeMs: 1 })
      }
      if (url.endsWith("/api/v1/files") && init?.method === "POST") {
        postCount += 1
        if (postCount === 1) {
          return jsonResponse(
            { error: { code: "conflict", currentMtimeMs: 2, expectedMtimeMs: 1 } },
            { status: 409, statusText: "Conflict" },
          )
        }
        return jsonResponse({ ok: true, mtimeMs: 3 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<DeckPane params={{ path: "deck/conflict.md" }} onError={onError} />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByTestId("deck-mode-edit")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("deck-mode-edit"))
    fireEvent.change(screen.getByTestId("deck-markdown-editor"), {
      target: { value: "# Intro\n\nChanged" },
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })

    await waitFor(() => expect(screen.getByTestId("deck-conflict-notice")).toBeInTheDocument())
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ type: "conflict", path: "deck/conflict.md" }),
    )

    fireEvent.click(screen.getByTestId("deck-overwrite"))

    await waitFor(() => expect(screen.queryByTestId("deck-conflict-notice")).not.toBeInTheDocument())

    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    expect(postCalls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          path: "deck/conflict.md",
          content: "# Intro\n\nChanged",
        }),
      }),
    )
  })

  it("navigates between slides in file-backed read and present modes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/files?") && init?.method !== "POST") {
        return jsonResponse({ content: "# Intro\n\nHello\n---\n## Second\n\nNext slide", mtimeMs: 1 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<DeckPane params={{ path: "deck/slides.md" }} />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText("Hello")).toBeInTheDocument())
    expect(screen.getByText("Slide 1 of 2")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("deck-next"))

    await waitFor(() => expect(screen.getByText("Next slide")).toBeInTheDocument())
    expect(screen.getByText("Slide 2 of 2")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("deck-toggle-present"))
    expect(screen.getByTestId("deck-shell-present")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("deck-prev"))

    await waitFor(() => expect(screen.getByText("Hello")).toBeInTheDocument())
    expect(screen.getByText("Slide 1 of 2")).toBeInTheDocument()
  })

  it("opens a direct deck path without touching tree/list endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) {
        return jsonResponse({ entries: [] }, { status: 500, statusText: "Tree failed" })
      }
      if (url.includes("/api/v1/files?") && init?.method !== "POST") {
        return jsonResponse({ content: "# Intro\n\nDirect open", mtimeMs: 1 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<DeckPane params={{ path: "deck/direct-open.md" }} />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText("Direct open")).toBeInTheDocument())

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/tree"))).toBe(false)
  })
})
