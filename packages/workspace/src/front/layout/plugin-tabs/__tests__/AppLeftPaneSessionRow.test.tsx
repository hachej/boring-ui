// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}))

import { AppSessionRow } from "../AppLeftPaneSessionRow"

function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText("More options for Native chat"), { button: 0, ctrlKey: false })
}

function row(overrides: Partial<Parameters<typeof AppSessionRow>[0]> = {}) {
  return render(
    <AppSessionRow
      session={{ id: "native-1", title: "Native chat", nativeSessionId: "native-1", hasAssistantReply: true }}
      state="normal"
      pinned={false}
      onSwitch={vi.fn()}
      onOpenAsPane={vi.fn()}
      onTogglePinned={vi.fn()}
      {...overrides}
    />,
  )
}

describe("AppSessionRow native actions", () => {
  it("keeps pin/open direct and puts copy, rename, delete in the ellipsis menu", () => {
    const onDelete = vi.fn()
    row({ onDelete })
    expect(screen.getByLabelText("Pin Native chat")).toBeInTheDocument()
    expect(screen.getByLabelText("Open Native chat in new chat pane")).toBeInTheDocument()
    openMenu()
    expect(screen.getByText("Copy session ID")).toBeInTheDocument()
    expect(screen.getByText("Rename")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Delete"))
    expect(onDelete).toHaveBeenCalledWith("native-1")
  })

  it("gates rename until the native transcript has an assistant reply", () => {
    row({ session: { id: "native-1", title: "Native chat", nativeSessionId: "native-1", hasAssistantReply: false } })
    openMenu()
    expect(screen.queryByText("Rename")).not.toBeInTheDocument()
  })

  it("saves inline rename through the supplied mutation", () => {
    const onRename = vi.fn().mockResolvedValue(undefined)
    row({ onRename })
    openMenu()
    fireEvent.click(screen.getByText("Rename"))
    const input = screen.getByLabelText("Rename session")
    fireEvent.change(input, { target: { value: "Renamed" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onRename).toHaveBeenCalledWith("native-1", "Renamed")
  })
})
