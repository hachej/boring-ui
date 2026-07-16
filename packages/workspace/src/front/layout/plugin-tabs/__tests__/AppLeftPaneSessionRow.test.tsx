import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AppSessionRow } from "../AppLeftPaneSessionRow"

function renderRow(overrides: Partial<Parameters<typeof AppSessionRow>[0]> = {}) {
  const onSwitch = vi.fn()
  const onOpenAsPane = vi.fn()
  const onRename = vi.fn()
  render(
    <AppSessionRow
      session={{ id: "native", nativeSessionId: "native", hasAssistantReply: true, title: "Native chat" }}
      state="normal"
      pinned={false}
      onSwitch={onSwitch}
      onOpenAsPane={onOpenAsPane}
      onTogglePinned={vi.fn()}
      onRename={onRename}
      {...overrides}
    />,
  )
  return { onSwitch, onOpenAsPane, onRename }
}

describe("AppSessionRow", () => {
  it("only exposes rename for committed native Pi sessions", () => {
    const { rerender } = render(
      <>
        <AppSessionRow session={{ id: "pending", nativeSessionId: "pending", hasAssistantReply: false, title: "Pending" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
        <AppSessionRow session={{ id: "legacy", hasAssistantReply: true, title: "Legacy" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
        <AppSessionRow session={{ id: "mismatch", nativeSessionId: "other", hasAssistantReply: true, title: "Mismatch" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
      </>,
    )

    expect(screen.queryByLabelText("Rename Pending")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Rename Legacy")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Rename Mismatch")).not.toBeInTheDocument()

    rerender(
      <AppSessionRow session={{ id: "native", nativeSessionId: "native", hasAssistantReply: true, title: "Ready" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />,
    )
    const rename = screen.getByLabelText("Rename Ready")
    expect(rename).toBeInTheDocument()
    expect(rename.closest('[data-boring-workspace-part="app-session-actions"]')).toHaveClass(
      "max-w-0",
      "opacity-0",
      "group-hover:max-w-32",
      "group-hover:opacity-100",
    )
  })

  it("commits a valid title once on Enter without activating the row", () => {
    const rename = vi.fn(() => new Promise<never>(() => {}))
    const { onSwitch, onOpenAsPane } = renderRow({ onRename: rename })

    expect(screen.getByLabelText("Open Native chat in new chat pane")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Rename Native chat"))
    expect(screen.queryByLabelText("Open Native chat in new chat pane")).not.toBeInTheDocument()
    const input = screen.getByLabelText("Rename Native chat")
    fireEvent.change(input, { target: { value: "Renamed" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.blur(input)
    fireEvent.click(document.querySelector('[data-boring-workspace-part="app-session-row"]')!)

    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith("native", "Renamed")
    expect(onSwitch).not.toHaveBeenCalled()
    expect(onOpenAsPane).not.toHaveBeenCalled()
  })

  it("commits a valid title on outside blur", () => {
    const { onRename } = renderRow()

    fireEvent.click(screen.getByLabelText("Rename Native chat"))
    const input = screen.getByLabelText("Rename Native chat")
    fireEvent.change(input, { target: { value: "Renamed on blur" } })
    fireEvent.blur(input)

    expect(onRename).toHaveBeenCalledWith("native", "Renamed on blur")
  })

  it("cancels rename on Escape without saving or activating the row", () => {
    const { onRename, onSwitch } = renderRow()

    fireEvent.click(screen.getByLabelText("Rename Native chat"))
    const input = screen.getByLabelText("Rename Native chat")
    fireEvent.change(input, { target: { value: "Discarded" } })
    fireEvent.keyDown(input, { key: "Escape" })

    expect(screen.queryByLabelText("Rename Native chat")).toBeInTheDocument()
    expect(onRename).not.toHaveBeenCalled()
    expect(onSwitch).not.toHaveBeenCalled()
  })
})
