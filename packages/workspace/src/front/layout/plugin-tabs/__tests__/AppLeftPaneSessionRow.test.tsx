import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Toaster, clearToasts } from "../../../toast"
import { AppSessionRow } from "../AppLeftPaneSessionRow"

const originalExecCommand = document.execCommand
const originalIsSecureContext = window.isSecureContext

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value })
}

function renderRow(
  overrides: Partial<Parameters<typeof AppSessionRow>[0]> = {},
  { withToaster = false }: { withToaster?: boolean } = {},
) {
  const onSwitch = vi.fn()
  const onOpenAsPane = vi.fn()
  const onRename = vi.fn()
  render(
    <>
      <AppSessionRow
        session={{ id: "native", nativeSessionId: "native", hasAssistantReply: true, title: "Native chat" }}
        state="normal"
        pinned={false}
        onSwitch={onSwitch}
        onOpenAsPane={onOpenAsPane}
        onTogglePinned={vi.fn()}
        onRename={onRename}
        {...overrides}
      />
      {withToaster ? <Toaster /> : null}
    </>,
  )
  return { onSwitch, onOpenAsPane, onRename }
}

function openMenu(title = "Native chat") {
  fireEvent.pointerDown(screen.getByLabelText(`More options for ${title}`), { button: 0, ctrlKey: false })
}

describe("AppSessionRow", () => {
  afterEach(() => {
    clearToasts()
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: originalIsSecureContext })
    document.execCommand = originalExecCommand
  })

  it("offers copy for durable sessions and rename only for committed native Pi sessions", () => {
    render(
      <>
        <AppSessionRow session={{ id: "pending", nativeSessionId: "pending", hasAssistantReply: false, title: "Pending" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
        <AppSessionRow session={{ id: "legacy", hasAssistantReply: true, title: "Legacy" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
        <AppSessionRow session={{ id: "native", nativeSessionId: "native", hasAssistantReply: true, title: "Native" }} state="normal" pinned={false} onSwitch={vi.fn()} onOpenAsPane={vi.fn()} onTogglePinned={vi.fn()} onRename={vi.fn()} />
      </>,
    )

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
  })

  it("copies the exact ID with the secure Clipboard API and reports a success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setSecureContext(true)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    renderRow({}, { withToaster: true })

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("native"))
    expect(await screen.findByRole("status")).toHaveTextContent("Session ID copied")
    expect(screen.getByRole("status")).toHaveTextContent("native")
  })

  it("uses legacy copy only for an insecure Clipboard API failure", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"))
    const execCommand = vi.fn().mockReturnValue(true)
    setSecureContext(false)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    document.execCommand = execCommand
    renderRow({}, { withToaster: true })

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"))
    expect(writeText).toHaveBeenCalledWith("native")
    expect(screen.getByRole("status")).toHaveTextContent("Session ID copied")
  })

  it("reports the HTTPS clipboard-access toast when secure copying is denied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"))
    const execCommand = vi.fn().mockReturnValue(true)
    setSecureContext(true)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    document.execCommand = execCommand
    renderRow({}, { withToaster: true })

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))

    expect(await screen.findByRole("status")).toHaveTextContent("Could not copy session ID")
    expect(screen.getByRole("status")).toHaveTextContent("Use HTTPS and allow clipboard access.")
    expect(execCommand).not.toHaveBeenCalled()
  })

  it("restores keyboard copy focus but does not force pointer dismissal focus", async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    setSecureContext(false)
    document.execCommand = execCommand
    renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")

    trigger.focus()
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy session ID" }))
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"))
    expect(trigger).toHaveFocus()

    openMenu()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(trigger).not.toHaveFocus()
  })

  it("moves keyboard Rename focus into the inline input and saves on outside blur", async () => {
    const { onRename, onSwitch, onOpenAsPane } = renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")
    trigger.focus()
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), { key: "Enter" })

    const input = await screen.findByLabelText("Rename Native chat")
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: "Renamed on blur" } })
    fireEvent.blur(input)

    expect(onRename).toHaveBeenCalledWith("native", "Renamed on blur")
    expect(onSwitch).not.toHaveBeenCalled()
    expect(onOpenAsPane).not.toHaveBeenCalled()
  })

  it("keeps rename errors visible to sighted users and cancels with Escape", async () => {
    const rejectedRename = vi.fn().mockRejectedValue(new Error("Title is unavailable"))
    const { onSwitch } = renderRow({ onRename: rejectedRename })

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
    const input = await screen.findByLabelText("Rename Native chat")
    fireEvent.change(input, { target: { value: "Taken" } })
    fireEvent.keyDown(input, { key: "Enter" })

    const error = await screen.findByRole("alert")
    expect(error).toHaveTextContent("Title is unavailable")
    expect(error).toBeVisible()
    expect(input).toHaveAttribute("aria-describedby", error.id)
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByLabelText("Rename Native chat")).not.toBeInTheDocument()
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("deletes from the menu without activating the row", () => {
    const onDelete = vi.fn()
    const { onSwitch } = renderRow({ onDelete })

    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))

    expect(onDelete).toHaveBeenCalledWith("native")
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("suppresses a trigger-originated drag and clears it after an outside release", () => {
    renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")
    const row = trigger.closest('[data-boring-workspace-part="app-session-row"]')!
    const dataTransfer = { effectAllowed: "", setData: vi.fn() }

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(false)
    expect(dataTransfer.setData).not.toHaveBeenCalled()

    fireEvent.pointerUp(document, { button: 0 })
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(true)
    expect(dataTransfer.setData).toHaveBeenNthCalledWith(1, "application/x-boring-chat-session", "native")
    expect(dataTransfer.setData).toHaveBeenNthCalledWith(2, "text/plain", "Native chat")
  })

  it("suppresses an ancestor drag when the trigger closes an open menu", () => {
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

  it("suppresses mouse-triggered ancestor drags while allowing ordinary row drags", () => {
    renderRow()
    const trigger = screen.getByLabelText("More options for Native chat")
    const row = trigger.closest('[data-boring-workspace-part="app-session-row"]')!
    const dataTransfer = { effectAllowed: "", setData: vi.fn() }

    fireEvent.mouseDown(trigger, { button: 0 })
    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(false)
    fireEvent.mouseUp(document, { button: 0 })
    expect(fireEvent.dragStart(row, { dataTransfer })).toBe(true)
    expect(dataTransfer.effectAllowed).toBe("copyMove")
  })
})
