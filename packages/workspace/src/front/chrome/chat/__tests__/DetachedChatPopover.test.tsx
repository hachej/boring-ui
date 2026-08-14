import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("../ChatPanelHost", () => ({
  ChatPanelHost: () => <div>Transcript</div>,
}))

import { DetachedChatPopover } from "../DetachedChatPopover"

const baseProps = {
  sessionId: "session-a",
  title: "Planning",
  chatParams: {} as never,
  initialPosition: { left: 24, top: 72 },
  onClose: () => {},
  onDock: () => {},
}

describe("DetachedChatPopover", () => {
  it("leads the subtitle with the owning Agent", () => {
    render(<DetachedChatPopover {...baseProps} agentLabel="Coder" />)
    expect(screen.getByText("Coder · Detached chat · dock to reply")).toBeInTheDocument()
  })

  it("keeps the Agent when the detached chat can compose", () => {
    render(<DetachedChatPopover {...baseProps} agentLabel="Coder" composingEnabled />)
    expect(screen.getByText("Coder · Detached chat")).toBeInTheDocument()
  })

  it("falls back to the plain state subtitle without an Agent (single-Agent workspace)", () => {
    render(<DetachedChatPopover {...baseProps} />)
    expect(screen.getByText("Detached chat · dock to reply")).toBeInTheDocument()
  })
})
