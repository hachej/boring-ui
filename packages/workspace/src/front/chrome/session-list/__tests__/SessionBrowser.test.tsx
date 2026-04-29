import { describe, it, expect, vi } from "vitest"
import { render, fireEvent, screen } from "@testing-library/react"
import { SessionBrowser } from "../SessionBrowser"
import type { SessionItem } from "../../../components/SessionList"

const now = Date.now()
const sample: SessionItem[] = [
  { id: "s1", title: "First session", updatedAt: now - 60_000 },
  { id: "s2", title: "Second session", updatedAt: now - 60 * 60_000 },
  { id: "s3", title: "Third session", updatedAt: now - 26 * 60 * 60_000 },
]

describe("SessionBrowser", () => {
  it("renders all sessions grouped by recency", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" />)
    expect(screen.getByText(/First session/)).toBeInTheDocument()
    expect(screen.getByText(/Second session/)).toBeInTheDocument()
    expect(screen.getByText(/Third session/)).toBeInTheDocument()
  })

  it("calls onSwitch with the row's id when a non-active row is clicked", () => {
    const onSwitch = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onSwitch={onSwitch} />)
    fireEvent.click(screen.getByText(/Second session/))
    expect(onSwitch).toHaveBeenCalledWith("s2")
  })

  it("calls onSwitch even when the same row is clicked again", () => {
    const onSwitch = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onSwitch={onSwitch} />)
    fireEvent.click(screen.getByText(/First session/))
    expect(onSwitch).toHaveBeenCalledWith("s1")
  })

  it("highlights the active row with the active class set", () => {
    const { container } = render(<SessionBrowser sessions={sample} activeId="s2" />)
    const items = container.querySelectorAll("li")
    const second = Array.from(items).find((li) => li.textContent?.includes("Second session"))
    expect(second).toBeTruthy()
    // active rows get bg-foreground/[0.06]; check via class substring
    expect(second?.className).toMatch(/bg-foreground\/\[0\.06\]/)
  })

  it("does not require onSwitch — clicking is a no-op when omitted", () => {
    expect(() => {
      render(<SessionBrowser sessions={sample} activeId="s1" />)
      fireEvent.click(screen.getByText(/Second session/))
    }).not.toThrow()
  })

  it("calls onCreate when the new-session button is clicked", () => {
    const onCreate = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onCreate={onCreate} />)
    fireEvent.click(screen.getByLabelText("New session"))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it("calls onDelete with the row id and does NOT also fire onSwitch", () => {
    const onSwitch = vi.fn()
    const onDelete = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onSwitch={onSwitch} onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText(/Delete Second session/))
    expect(onDelete).toHaveBeenCalledWith("s2")
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("renders empty state when no sessions are supplied", () => {
    render(<SessionBrowser sessions={[]} />)
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument()
  })
})
