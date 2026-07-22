import { afterEach, describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SessionList, type SessionItem } from "../SessionList"

const sessions: SessionItem[] = [
  { id: "s1", title: "First session", updatedAt: "2026-04-01" },
  { id: "s2", title: "Second session", updatedAt: "2026-04-02" },
  { id: "s3", title: "Third session", updatedAt: "2026-04-03" },
]

describe("SessionList", () => {
  const originalExecCommand = document.execCommand
  const originalIsSecureContext = window.isSecureContext

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    document.execCommand = originalExecCommand
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: originalIsSecureContext })
  })

  it("renders list of sessions with titles", () => {
    render(<SessionList sessions={sessions} />)
    expect(screen.getByText("First session")).toBeInTheDocument()
    expect(screen.getByText("Second session")).toBeInTheDocument()
    expect(screen.getByText("Third session")).toBeInTheDocument()
  })

  it("shows active session indicator", () => {
    render(<SessionList sessions={sessions} activeId="s2" />)
    const activeItem = screen.getByText("Second session").closest("[role=listitem]")
    expect(activeItem).toHaveAttribute("aria-current", "true")
    expect(activeItem?.querySelector("[aria-label=Active]")).toBeInTheDocument()
  })

  it("clicking session calls onSwitch", () => {
    const onSwitch = vi.fn()
    render(<SessionList sessions={sessions} onSwitch={onSwitch} />)
    fireEvent.click(screen.getByText("Second session"))
    expect(onSwitch).toHaveBeenCalledWith("s2")
  })

  it("copy session id falls back to legacy copy without switching sessions", async () => {
    const onSwitch = vi.fn()
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand
    render(<SessionList sessions={sessions} activeId="s1" onSwitch={onSwitch} />)

    fireEvent.click(screen.getByLabelText("Copy Pi session id for First session"))

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith("copy")
    })
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("keeps the legacy fallback when secure webviews do not expose Clipboard API", async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true })
    document.execCommand = execCommand
    render(<SessionList sessions={sessions} activeId="s1" />)

    fireEvent.click(screen.getByLabelText("Copy Pi session id for First session"))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"))
  })

  it("create button calls onCreate", () => {
    const onCreate = vi.fn()
    render(<SessionList sessions={sessions} onCreate={onCreate} />)
    fireEvent.click(screen.getByLabelText("New session"))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it("does not render create button when onCreate is omitted", () => {
    render(<SessionList sessions={sessions} />)
    expect(screen.queryByLabelText("New session")).not.toBeInTheDocument()
  })

  it("delete button calls onDelete", () => {
    const onDelete = vi.fn()
    render(<SessionList sessions={sessions} activeId="s1" onDelete={onDelete} />)
    const deleteBtn = screen.getByLabelText("Delete First session")
    fireEvent.click(deleteBtn)
    expect(onDelete).toHaveBeenCalledWith("s1")
  })

  it("delete click does not trigger onSwitch", () => {
    const onSwitch = vi.fn()
    const onDelete = vi.fn()
    render(
      <SessionList
        sessions={sessions}
        activeId="s1"
        onSwitch={onSwitch}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByLabelText("Delete First session"))
    expect(onDelete).toHaveBeenCalledWith("s1")
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("delete keyboard activation does not trigger onSwitch", async () => {
    const user = userEvent.setup()
    const onSwitch = vi.fn()
    const onDelete = vi.fn()
    render(
      <SessionList
        sessions={sessions}
        activeId="s1"
        onSwitch={onSwitch}
        onDelete={onDelete}
      />,
    )
    const deleteButton = screen.getByLabelText("Delete First session")
    deleteButton.focus()
    await user.keyboard("{Enter}")
    expect(onDelete).toHaveBeenCalledWith("s1")
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("shows empty state when no sessions", () => {
    render(<SessionList sessions={[]} />)
    expect(screen.getByText("No sessions")).toBeInTheDocument()
  })

  it("renders with navigation role and accessible label", () => {
    render(<SessionList sessions={sessions} />)
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument()
  })

  it("accepts className prop", () => {
    const { container } = render(<SessionList sessions={sessions} className="custom-sessions" />)
    expect(container.querySelector(".custom-sessions")).toBeInTheDocument()
  })

  it("keyboard Enter activates session switch", () => {
    const onSwitch = vi.fn()
    render(<SessionList sessions={sessions} onSwitch={onSwitch} />)
    const item = screen.getByText("First session").closest("[role=listitem]")!
    fireEvent.keyDown(item, { key: "Enter" })
    expect(onSwitch).toHaveBeenCalledWith("s1")
  })

  it("uses active session as the keyboard tab stop", () => {
    render(<SessionList sessions={sessions} activeId="s2" />)
    const first = screen.getByText("First session").closest("[role=listitem]")!
    const second = screen.getByText("Second session").closest("[role=listitem]")!
    expect(first).toHaveAttribute("tabindex", "-1")
    expect(second).toHaveAttribute("tabindex", "0")
  })

  it("supports arrow key navigation between sessions", () => {
    render(<SessionList sessions={sessions} />)
    const first = screen.getByText("First session").closest("[role=listitem]") as HTMLElement
    const second = screen.getByText("Second session").closest("[role=listitem]") as HTMLElement
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowDown" })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second, { key: "ArrowUp" })
    expect(first).toHaveFocus()
  })

  it("supports Home and End key focus movement", () => {
    render(<SessionList sessions={sessions} />)
    const first = screen.getByText("First session").closest("[role=listitem]") as HTMLElement
    const second = screen.getByText("Second session").closest("[role=listitem]") as HTMLElement
    const third = screen.getByText("Third session").closest("[role=listitem]") as HTMLElement
    second.focus()
    fireEvent.keyDown(second, { key: "End" })
    expect(third).toHaveFocus()
    fireEvent.keyDown(third, { key: "Home" })
    expect(first).toHaveFocus()
  })

  it("only exposes delete action in tab order for the focused session", () => {
    render(<SessionList sessions={sessions} activeId="s1" onDelete={vi.fn()} />)
    const firstDelete = screen.getByLabelText("Delete First session")
    const secondDelete = screen.getByLabelText("Delete Second session")
    expect(firstDelete).toHaveAttribute("tabindex", "0")
    expect(secondDelete).toHaveAttribute("tabindex", "-1")
  })
})
