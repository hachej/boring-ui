// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}))

import { AppSessionRow } from "../AppLeftPaneSessionRow"

function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText("Chat actions for Native chat"), { button: 0, ctrlKey: false })
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
  it("keeps session mutations in one actions menu", () => {
    const onDelete = vi.fn()
    row({ onDelete, onRename: vi.fn() })
    // Split moved to a direct hover action; the menu must not repeat it.
    expect(screen.getByRole("button", { name: /in a split pane$/ })).toBeInTheDocument()
    openMenu()
    expect(screen.queryByText("Open in new chat pane")).not.toBeInTheDocument()
    expect(screen.getByText("Pin chat")).toBeInTheDocument()
    expect(screen.getByText("Copy session ID")).toBeInTheDocument()
    expect(screen.getByText("Rename")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Delete"))
    expect(onDelete).toHaveBeenCalledWith("native-1")
  })

  it("leaves every row shortcut sized by the one rule that also reserves its slot", () => {
    // The strip reserves one slot per action, and the slot width switches on
    // `pointer: coarse`. Sizing the buttons with a Tailwind `size-11 sm:size-6`
    // pair switched them on viewport WIDTH instead, so the two conditions
    // agreed only at 1440-fine and 390-coarse: a 500px-wide desktop window got
    // 44px buttons in 28px slots (spilling over the chat title), and a coarse
    // 834px tablet got a 24px trigger in a 44px slot (20px of dead strip that
    // fell through to the row button). Every shortcut now carries
    // `.app-left-session-secondary-action` and NO size utility, so globals.css
    // is the single place either number can change.
    row({ onOpenDetached: vi.fn(), onDelete: vi.fn() })
    const shortcuts = [
      screen.getByRole("button", { name: /in a split pane$/ }),
      screen.getByRole("button", { name: /as a quick chat$/ }),
      screen.getByLabelText("Chat actions for Native chat"),
    ]
    for (const shortcut of shortcuts) {
      expect(shortcut.className).toContain("app-left-session-secondary-action")
      expect(shortcut.className).not.toMatch(/(^|\s)(sm:)?size-\d/)
    }
  })

  it("copies the session id through the legacy fallback on an HTTP dev origin", async () => {
    const secureContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext")
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand")
    let copiedText = ""
    const setData = vi.fn()
    const execCommand = vi.fn(() => {
      copiedText = [...document.querySelectorAll("textarea")]
        .map((textarea) => textarea.value)
        .find((value) => value === "native-1") ?? ""
      const copyEvent = new Event("copy", { cancelable: true })
      Object.defineProperty(copyEvent, "clipboardData", { value: { setData } })
      document.dispatchEvent(copyEvent)
      return true
    })
    Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false })
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand })
    try {
      row()
      openMenu()
      fireEvent.click(screen.getByText("Copy session ID"))
      await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"))
      expect(copiedText).toBe("native-1")
      expect(setData).toHaveBeenCalledWith("text/plain", "native-1")
    } finally {
      if (secureContextDescriptor) Object.defineProperty(globalThis, "isSecureContext", secureContextDescriptor)
      else Reflect.deleteProperty(globalThis, "isSecureContext")
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor)
      else Reflect.deleteProperty(navigator, "clipboard")
      if (execCommandDescriptor) Object.defineProperty(document, "execCommand", execCommandDescriptor)
      else Reflect.deleteProperty(document, "execCommand")
    }
  })

  it("restores trigger focus when a pointer-opened menu closes with Escape", async () => {
    row()
    const trigger = screen.getByLabelText("Chat actions for Native chat")
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("offers Copy ID for a durable unsplittable row without native metadata", () => {
    row({
      session: { id: "preview-1", title: "Project preview" },
      canSplit: false,
    })
    fireEvent.pointerDown(screen.getByLabelText("Chat actions for Project preview"), { button: 0, ctrlKey: false })
    expect(screen.getByText("Copy session ID")).toBeInTheDocument()
  })

  it("disables drag, cursor, and pin affordances when session controls are unavailable", () => {
    row({ onSwitch: undefined, onOpenAsPane: undefined, onTogglePinned: undefined })
    const sessionRow = screen.getByText("Native chat").closest('[data-boring-workspace-part="app-session-row"]')

    expect(sessionRow).toHaveAttribute("draggable", "false")
    expect(sessionRow).not.toHaveClass("cursor-pointer")
    expect(screen.queryByLabelText("Pin Native chat")).not.toBeInTheDocument()
  })

  it("hides the action menu for an ephemeral row with no available mutations", () => {
    row({
      session: { id: "local-1", title: "Local draft", ephemeral: true },
      canSplit: false,
      canPin: false,
      onTogglePinned: undefined,
    })
    expect(screen.queryByLabelText("Chat actions for Local draft")).not.toBeInTheDocument()
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
