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
    row({ onDelete, onRename: vi.fn() })
    expect(screen.getByLabelText("Pin Native chat")).toBeInTheDocument()
    expect(screen.getByLabelText("Open Native chat in new chat pane")).toBeInTheDocument()
    openMenu()
    expect(screen.getByText("Copy session ID")).toBeInTheDocument()
    expect(screen.getByText("Rename")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Delete"))
    expect(onDelete).toHaveBeenCalledWith("native-1")
  })

  it("offers Copy ID for a durable unsplittable row without native metadata", () => {
    row({
      session: { id: "preview-1", title: "Project preview" },
      canSplit: false,
    })
    fireEvent.pointerDown(screen.getByLabelText("More options for Project preview"), { button: 0, ctrlKey: false })
    expect(screen.getByText("Copy session ID")).toBeInTheDocument()
  })

  it("hides the action menu for an ephemeral row with no available mutations", () => {
    row({
      session: { id: "local-1", title: "Local draft", ephemeral: true },
      canSplit: false,
    })
    expect(screen.queryByLabelText("More options for Local draft")).not.toBeInTheDocument()
  })

  it("gates rename until the native transcript has an assistant reply", () => {
    row({ session: { id: "native-1", title: "Native chat", nativeSessionId: "native-1", hasAssistantReply: false } })
    openMenu()
    expect(screen.queryByText("Rename")).not.toBeInTheDocument()
  })

  it("does not offer rename without a supplied mutation", () => {
    row({ onRename: undefined })
    openMenu()
    expect(screen.queryByText("Rename")).not.toBeInTheDocument()
  })
})
