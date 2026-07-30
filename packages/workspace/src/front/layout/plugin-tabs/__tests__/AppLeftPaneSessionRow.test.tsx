// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}))

import { AppSessionRow } from "../AppLeftPaneSessionRow"

function row(overrides: Partial<Parameters<typeof AppSessionRow>[0]> = {}) {
  return render(
    <AppSessionRow
      session={{ id: "native-1", title: "Native chat" }}
      state="normal"
      pinned={false}
      onSwitch={vi.fn()}
      onOpenAsPane={vi.fn()}
      onTogglePinned={vi.fn()}
      {...overrides}
    />,
  )
}

describe("AppSessionRow actions", () => {
  it("keeps pane actions direct and routes durable rename/delete through the menu", () => {
    const onDelete = vi.fn()
    row({ onDelete, onRename: vi.fn() })

    expect(screen.getByLabelText("Pin Native chat")).toBeInTheDocument()
    const splitAction = screen.getByLabelText("Open Native chat in split")
    expect(splitAction).toHaveClass(
      "grid",
      "size-6",
      "shrink-0",
      "place-items-center",
      "rounded-md",
      "text-muted-foreground",
      "hover:bg-background",
      "hover:text-foreground",
    )
    expect(splitAction).not.toHaveClass("transition-colors")
    expect(splitAction.querySelector(".lucide-columns-2")).toHaveClass("h-3.5", "w-3.5")
    fireEvent.pointerDown(screen.getByLabelText("More options for Native chat"), { button: 0, ctrlKey: false })
    expect(screen.getByText("Copy session ID")).toBeInTheDocument()
    expect(screen.getByText("Rename")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Delete"))
    expect(onDelete).toHaveBeenCalledWith("native-1")
  })

  it("does not expose copy or rename for an ephemeral draft", () => {
    row({
      session: { id: "local-1", title: "Local draft", ephemeral: true },
      canSplit: false,
    })

    expect(screen.queryByLabelText("More options for Local draft")).not.toBeInTheDocument()
  })
})
