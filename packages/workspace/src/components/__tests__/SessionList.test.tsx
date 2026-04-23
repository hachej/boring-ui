import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SessionList, type SessionItem } from "../SessionList"

const sessions: SessionItem[] = [
  { id: "s1", title: "First session", updatedAt: "2026-04-01" },
  { id: "s2", title: "Second session", updatedAt: "2026-04-02" },
  { id: "s3", title: "Third session", updatedAt: "2026-04-03" },
]

describe("SessionList", () => {
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
})
