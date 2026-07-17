import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppSessionRow } from "../AppLeftPaneSessionRow"

const originalExecCommand = document.execCommand

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

function openMenu(title = "Native chat") {
  fireEvent.pointerDown(screen.getByLabelText(`More options for ${title}`), { button: 0, ctrlKey: false })
}

describe("AppSessionRow", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    document.execCommand = originalExecCommand
  })

  it("includes Copy session ID for listed sessions and gates Rename to committed native Pi sessions", () => {
    render(
      <>
        <AppSessionRow session={{ id: "pending", nativeSessionId: "pending", hasAssistantReply: false, title: "Pending" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
        <AppSessionRow session={{ id: "legacy", hasAssistantReply: true, title: "Legacy" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
        <AppSessionRow session={{ id: "native", nativeSessionId: "native", hasAssistantReply: true, title: "Native" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
      </>,
    )

    const actions = screen.getByLabelText("More options for Pending").closest('[data-boring-workspace-part="app-session-actions"]')
    expect(actions).toHaveClass("group-hover:opacity-100", "group-focus-within:opacity-100")

    openMenu("Pending")
    expect(screen.getByRole("menuitem", { name: "Copy session ID" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    openMenu("Legacy")
    expect(screen.getByRole("menuitem", { name: "Copy session ID" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    openMenu("Native")
    expect(screen.getByRole("menuitem", { name: "Copy session ID" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument()
    expect(screen.getAllByRole("separator")).toHaveLength(1)
  })

  it("copies the exact session ID and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    renderRow()

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("native"))
    expect(await screen.findByRole("status")).toHaveTextContent("Session ID copied")
  })

  it("announces when copying the session ID fails", async () => {
    document.execCommand = vi.fn().mockReturnValue(false)
    renderRow()

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))

    expect(await screen.findByRole("status")).toHaveTextContent("Could not copy session ID")
  })

  it("restores focus to the ellipsis trigger after an async clipboard rejection falls back", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"))
    const execCommand = vi.fn(() => {
      expect(document.activeElement).toBeInstanceOf(HTMLTextAreaElement)
      return true
    })
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    document.execCommand = execCommand
    renderRow()

    const trigger = screen.getByLabelText("More options for Native chat")
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"))
    expect(trigger).toHaveFocus()
    expect(document.querySelector("textarea")).not.toBeInTheDocument()
  })

  it("restores focus to the ellipsis trigger when Clipboard API is unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand
    renderRow()

    const trigger = screen.getByLabelText("More options for Native chat")
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"))
    expect(trigger).toHaveFocus()
  })

  it("starts the existing inline rename from the menu without activating the row", () => {
    const rename = vi.fn(() => new Promise<never>(() => {}))
    const { onSwitch, onOpenAsPane } = renderRow({ onRename: rename })

    expect(screen.getByLabelText("Open Native chat in new chat pane")).toBeInTheDocument()
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
    expect(screen.queryByLabelText("Open Native chat in new chat pane")).not.toBeInTheDocument()
    const input = screen.getByLabelText("Rename Native chat")
    fireEvent.change(input, { target: { value: "Renamed" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.blur(input)

    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith("native", "Renamed")
    expect(onSwitch).not.toHaveBeenCalled()
    expect(onOpenAsPane).not.toHaveBeenCalled()
  })

  it("commits a valid title on outside blur", () => {
    const { onRename } = renderRow()

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
    const input = screen.getByLabelText("Rename Native chat")
    fireEvent.change(input, { target: { value: "Renamed on blur" } })
    fireEvent.blur(input)

    expect(onRename).toHaveBeenCalledWith("native", "Renamed on blur")
  })

  it("cancels rename on Escape without saving or activating the row", () => {
    const { onRename, onSwitch } = renderRow()

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
    const input = screen.getByLabelText("Rename Native chat")
    fireEvent.change(input, { target: { value: "Discarded" } })
    fireEvent.keyDown(input, { key: "Escape" })

    expect(screen.getByLabelText("More options for Native chat")).toBeInTheDocument()
    expect(onRename).not.toHaveBeenCalled()
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("opens and selects Rename from the keyboard, moving focus into the inline edit", () => {
    renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")
    trigger.focus()

    fireEvent.keyDown(trigger, { key: "Enter" })
    const rename = screen.getByRole("menuitem", { name: "Rename" })
    fireEvent.keyDown(rename, { key: "Enter" })

    expect(screen.getByLabelText("Rename Native chat")).toHaveFocus()
  })

  it("deletes from the menu with destructive styling without activating the row", () => {
    const onDelete = vi.fn()
    const { onSwitch } = renderRow({ onDelete })

    openMenu()
    const deleteItem = screen.getByRole("menuitem", { name: "Delete" })
    expect(deleteItem).toHaveAttribute("data-variant", "destructive")
    fireEvent.click(deleteItem)

    expect(onDelete).toHaveBeenCalledWith("native")
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("suppresses the ancestor row's native drag after pointer interaction with the more menu trigger", () => {
    const { onSwitch } = renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")
    const row = trigger.closest('[data-boring-workspace-part="app-session-row"]')!
    const dataTransfer = { effectAllowed: "", setData: vi.fn() }

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(row).toHaveAttribute("draggable", "false")
    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(false)

    expect(dataTransfer.setData).not.toHaveBeenCalled()
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("suppresses an ancestor row drag after mouse interaction with the more menu trigger", () => {
    renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")
    const row = trigger.closest('[data-boring-workspace-part="app-session-row"]')!
    const dataTransfer = { effectAllowed: "", setData: vi.fn() }

    fireEvent.mouseDown(trigger, { button: 0 })
    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(false)
    expect(dataTransfer.setData).not.toHaveBeenCalled()
  })

  it("suppresses an ancestor row drag when the trigger closes an open menu", () => {
    renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")
    const row = trigger.closest('[data-boring-workspace-part="app-session-row"]')!
    const dataTransfer = { effectAllowed: "", setData: vi.fn() }

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.pointerUp(trigger)
    expect(screen.getByRole("menu")).toBeInTheDocument()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(false)
    expect(dataTransfer.setData).not.toHaveBeenCalled()
  })

  it("still puts a drag payload on the row when the menu is closed", () => {
    renderRow()
    const row = screen.getByLabelText("More options for Native chat").closest('[data-boring-workspace-part="app-session-row"]')!
    const dataTransfer = { effectAllowed: "", setData: vi.fn() }

    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(true)
    expect(dataTransfer.setData).toHaveBeenNthCalledWith(1, "application/x-boring-chat-session", "native")
    expect(dataTransfer.setData).toHaveBeenNthCalledWith(2, "text/plain", "Native chat")
    expect(dataTransfer.effectAllowed).toBe("copyMove")
  })
})
