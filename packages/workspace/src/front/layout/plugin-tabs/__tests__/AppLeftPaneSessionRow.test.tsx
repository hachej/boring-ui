import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AppSessionRow } from "../AppLeftPaneSessionRow"

function renderRow(onRename = vi.fn()) {
  render(
    <>
      <AppSessionRow
        session={{ id: "s1", title: "Original" }}
        state="normal"
        pinned={false}
        onSwitch={vi.fn()}
        onOpenAsPane={vi.fn()}
        onTogglePinned={vi.fn()}
        onRename={onRename}
      />
      <button type="button">Outside</button>
    </>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Rename Original" }))
  return onRename
}

describe("AppSessionRow rename", () => {
  it("hides rename for browser-memory drafts", () => {
    render(
      <AppSessionRow
        session={{ id: "brdraft_abcdefghijklmnop", title: "New chat", browserDraft: { kind: "new-native", requestId: "brreq_abcdefghijklmnop" } }}
        state="normal"
        pinned={false}
        onSwitch={vi.fn()}
        onOpenAsPane={vi.fn()}
        onTogglePinned={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.queryByRole("button", { name: "Rename New chat" })).not.toBeInTheDocument()
  })

  it("hides rename when the server capability denies it", () => {
    render(
      <AppSessionRow
        session={{ id: "s1", title: "Original", canRename: false }}
        state="normal"
        pinned={false}
        onSwitch={vi.fn()}
        onOpenAsPane={vi.fn()}
        onTogglePinned={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.queryByRole("button", { name: "Rename Original" })).not.toBeInTheDocument()
  })

  it("commits a valid title when focus leaves the row", async () => {
    const onRename = renderRow()
    const input = screen.getByRole("textbox", { name: "Rename Original" })
    fireEvent.change(input, { target: { value: "Renamed" } })
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Outside" }) })

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("s1", "Renamed"))
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it("commits on an outside pointer interaction that does not move focus", async () => {
    const onRename = renderRow()
    const input = screen.getByRole("textbox", { name: "Rename Original" })
    fireEvent.change(input, { target: { value: "Pointer renamed" } })
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }))

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("s1", "Pointer renamed"))
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it("keeps the editor open and reports an error for an invalid blur", () => {
    const onRename = renderRow()
    const input = screen.getByRole("textbox", { name: "Rename Original" })
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Outside" }) })

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Session title is required")
    expect(screen.getByRole("textbox", { name: "Rename Original" })).toBeInTheDocument()
  })

  it("does not commit when focus moves to an in-row action, and Escape cancels", () => {
    const onRename = renderRow()
    const input = screen.getByRole("textbox", { name: "Rename Original" })
    fireEvent.change(input, { target: { value: "Renamed" } })
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Pin Original" }) })
    expect(onRename).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: "Escape" })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByRole("textbox", { name: "Rename Original" })).not.toBeInTheDocument()
  })
})
