import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const onReloadFromServer = vi.fn(async () => undefined)
const onOverwrite = vi.fn(async () => undefined)
const setContent = vi.fn()

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
    useFilePane: () => ({
      isLoading: false,
      error: null,
      content: "# Intro\n\nHello",
      isDirty: true,
      conflict: {
        name: "FileConflictError",
        message: "File modified on server: deck/intro.md",
      },
      onReloadFromServer,
      onOverwrite,
      setContent,
      save: vi.fn(async () => undefined),
      flushSave: vi.fn(async () => undefined),
      fileName: "intro.md",
      tabTitle: "intro.md ●",
    }),
  }
})

import { DeckPane } from "../DeckPane"

describe("DeckPane file-state wiring", () => {
  it("wires reload, overwrite, and dirty tab titles to the canonical file-state seam", async () => {
    const setTitle = vi.fn()

    render(<DeckPane params={{ path: "deck/intro.md" }} api={{ setTitle } as any} />)

    fireEvent.click(screen.getByTestId("deck-mode-edit"))
    fireEvent.click(screen.getByTestId("deck-reload"))
    fireEvent.click(screen.getByTestId("deck-overwrite"))

    expect(onReloadFromServer).toHaveBeenCalledTimes(1)
    expect(onOverwrite).toHaveBeenCalledTimes(1)
    expect(setTitle).toHaveBeenCalledWith("intro.md ●")
  })

  it("treats whitespace-only paths as no file selected", () => {
    render(<DeckPane params={{ path: "   " }} />)

    expect(screen.getByText("No deck file selected.")).toBeInTheDocument()
  })
})
