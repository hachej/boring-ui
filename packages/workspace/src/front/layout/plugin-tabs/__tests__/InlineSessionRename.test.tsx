import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { clearToasts, getActiveToasts } from "../../../toast"
import { InlineSessionRename, useInlineSessionRename } from "../InlineSessionRename"

function RenameHarness({ onRename }: { onRename: (id: string, title: string) => void | Promise<unknown> }) {
  const rename = useInlineSessionRename({
    sessionId: "session-1",
    title: "Original",
    available: true,
    onRename,
  })
  return rename.field
    ? <InlineSessionRename field={rename.field} onCancel={rename.cancel} />
    : <button type="button" onClick={rename.begin}>Rename</button>
}

describe("InlineSessionRename", () => {
  afterEach(() => clearToasts())

  it("trims and saves a changed title on Enter", async () => {
    const onRename = vi.fn(async () => undefined)
    render(<RenameHarness onRename={onRename} />)

    fireEvent.click(screen.getByRole("button", { name: "Rename" }))
    const input = screen.getByRole("textbox", { name: "Rename session" })
    fireEvent.change(input, { target: { value: "  Better title  " } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("session-1", "Better title"))
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy())
  })

  it("keeps the editor open and explains an empty title", async () => {
    render(<RenameHarness onRename={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "Rename" }))
    const input = screen.getByRole("textbox", { name: "Rename session" })
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(await screen.findByRole("alert")).toHaveTextContent("Session title is required")
    expect(screen.getByRole("textbox", { name: "Rename session" })).toBeTruthy()
  })

  it("keeps the editor open and surfaces a structured rename failure", async () => {
    const onRename = vi.fn(async () => {
      throw Object.assign(new Error("This chat belongs to a previous runtime configuration and can no longer be changed."), {
        code: "AGENT_SESSION_RUNTIME_SCOPE_MISMATCH",
      })
    })
    render(<RenameHarness onRename={onRename} />)

    fireEvent.click(screen.getByRole("button", { name: "Rename" }))
    const input = screen.getByRole("textbox", { name: "Rename session" })
    fireEvent.change(input, { target: { value: "Changed title" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(await screen.findByRole("alert")).toHaveTextContent("previous runtime configuration")
    await waitFor(() => expect(getActiveToasts()).toEqual([
      expect.objectContaining({
        title: "Could not rename chat",
        description: expect.stringMatching(/previous runtime configuration.*AGENT_SESSION_RUNTIME_SCOPE_MISMATCH/i),
      }),
    ]))
    expect(screen.getByRole("textbox", { name: "Rename session" })).toBeInTheDocument()
  })
})
