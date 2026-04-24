import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommandPalette } from "../CommandPalette"
import { RegistryProvider } from "../../registry/RegistryProvider"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../registry/CommandRegistry"

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

const RECENT_KEY = "boring-ui-v2:command-palette:recent"

function createWrapper(commandRegistry?: CommandRegistry) {
  const pr = new PanelRegistry()
  const cr = commandRegistry ?? new CommandRegistry()
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <RegistryProvider panelRegistry={pr} commandRegistry={cr}>
        {children}
      </RegistryProvider>
    )
  }
}

function fireKeydown(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  document.dispatchEvent(event)
}

function fireKeydownFrom(element: HTMLElement, key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  element.dispatchEvent(event)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CommandPalette", () => {
  describe("open/close", () => {
    it("opens on Cmd+P", async () => {
      render(<CommandPalette />, { wrapper: createWrapper() })
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
    })

    it("opens on Cmd+K", async () => {
      render(<CommandPalette />, { wrapper: createWrapper() })
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      fireKeydown("k", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
    })

    it("closes on Escape", async () => {
      const user = userEvent.setup()
      render(<CommandPalette />, { wrapper: createWrapper() })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await user.keyboard("{Escape}")
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
    })

    it("resets query when reopened", async () => {
      const user = userEvent.setup()
      render(<CommandPalette />, { wrapper: createWrapper() })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, "hello")
      await user.keyboard("{Escape}")
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const newInput = screen.getByPlaceholderText(/Search files/)
      expect(newInput).toHaveValue("")
    })

    it("restores focus to the previously focused element when closed", async () => {
      const user = userEvent.setup()
      render(
        <>
          <button type="button">Before Palette</button>
          <CommandPalette />
        </>,
        { wrapper: createWrapper() },
      )
      const prior = screen.getByRole("button", { name: "Before Palette" })
      prior.focus()
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await user.keyboard("{Escape}")
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
      expect(prior).toHaveFocus()
    })

    it("can open while an editable input is focused", async () => {
      render(
        <>
          <input aria-label="scratch" />
          <CommandPalette />
        </>,
        { wrapper: createWrapper() },
      )
      const input = screen.getByRole("textbox", { name: "scratch" })
      input.focus()
      fireKeydownFrom(input, "k", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
    })
  })

  describe("file quick-open", () => {
    it("shows file results from fileSearchFn", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockReturnValue(["/src/App.tsx", "/src/index.ts"])
      render(<CommandPalette fileSearchFn={searchFn} />, {
        wrapper: createWrapper(),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, "app")
      await waitFor(() => {
        expect(searchFn).toHaveBeenCalledWith("app")
      })
      expect(screen.getByText("/src/App.tsx")).toBeInTheDocument()
      expect(screen.getByText("/src/index.ts")).toBeInTheDocument()
    })

    it("calls onOpenFile when file is selected", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockReturnValue(["/src/App.tsx"])
      const onOpenFile = vi.fn()
      render(
        <CommandPalette fileSearchFn={searchFn} onOpenFile={onOpenFile} />,
        { wrapper: createWrapper() },
      )
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, "app")
      await waitFor(() => {
        expect(screen.getByText("/src/App.tsx")).toBeInTheDocument()
      })
      await user.click(screen.getByText("/src/App.tsx"))
      expect(onOpenFile).toHaveBeenCalledWith("/src/App.tsx")
    })

    it("shows empty state when no files match", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockReturnValue([])
      render(<CommandPalette fileSearchFn={searchFn} />, {
        wrapper: createWrapper(),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, "nonexistent")
      await waitFor(() => {
        expect(screen.getByText("No files found")).toBeInTheDocument()
      })
    })

    it("closes palette after file selection", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockReturnValue(["/src/App.tsx"])
      render(<CommandPalette fileSearchFn={searchFn} onOpenFile={vi.fn()} />, {
        wrapper: createWrapper(),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, "app")
      await waitFor(() => {
        expect(screen.getByText("/src/App.tsx")).toBeInTheDocument()
      })
      await user.click(screen.getByText("/src/App.tsx"))
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
    })
  })

  describe("command mode", () => {
    it("switches to command mode with > prefix", async () => {
      const user = userEvent.setup()
      const cr = new CommandRegistry()
      cr.registerCommand({
        id: "test.cmd",
        title: "Test Command",
        run: vi.fn(),
      })
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, ">")
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/Type a command/),
        ).toBeInTheDocument()
      })
      expect(screen.getByText("Test Command")).toBeInTheDocument()
    })

    it("filters commands by query", async () => {
      const user = userEvent.setup()
      const cr = new CommandRegistry()
      cr.registerCommand({
        id: "sidebar",
        title: "Toggle Sidebar",
        run: vi.fn(),
      })
      cr.registerCommand({
        id: "theme",
        title: "Toggle Theme",
        run: vi.fn(),
      })
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, ">sidebar")
      await waitFor(() => {
        expect(screen.getByText("Toggle Sidebar")).toBeInTheDocument()
      })
      expect(screen.queryByText("Toggle Theme")).not.toBeInTheDocument()
    })

    it("executes command on select", async () => {
      const user = userEvent.setup()
      const run = vi.fn()
      const cr = new CommandRegistry()
      cr.registerCommand({ id: "test", title: "Run Test", run })
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, ">")
      await waitFor(() => {
        expect(screen.getByText("Run Test")).toBeInTheDocument()
      })
      await user.click(screen.getByText("Run Test"))
      expect(run).toHaveBeenCalledOnce()
    })

    it("shows shortcut hint next to command", async () => {
      const user = userEvent.setup()
      const cr = new CommandRegistry()
      cr.registerCommand({
        id: "sidebar",
        title: "Toggle Sidebar",
        shortcut: "⌘B",
        run: vi.fn(),
      })
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, ">")
      await waitFor(() => {
        expect(screen.getByText("⌘B")).toBeInTheDocument()
      })
    })

    it("shows empty state for no matching commands", async () => {
      const user = userEvent.setup()
      const cr = new CommandRegistry()
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, ">nonexistent")
      await waitFor(() => {
        expect(screen.getByText("No matching commands")).toBeInTheDocument()
      })
    })

    it("respects when() predicate on commands", async () => {
      const user = userEvent.setup()
      const cr = new CommandRegistry()
      cr.registerCommand({
        id: "visible",
        title: "Visible Command",
        run: vi.fn(),
        when: () => true,
      })
      cr.registerCommand({
        id: "hidden",
        title: "Hidden Command",
        run: vi.fn(),
        when: () => false,
      })
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, ">")
      await waitFor(() => {
        expect(screen.getByText("Visible Command")).toBeInTheDocument()
      })
      expect(screen.queryByText("Hidden Command")).not.toBeInTheDocument()
    })
  })

  describe("recent items", () => {
    it("saves selected files to recent list", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockReturnValue(["/src/App.tsx"])
      const onOpenFile = vi.fn()
      render(
        <CommandPalette fileSearchFn={searchFn} onOpenFile={onOpenFile} />,
        { wrapper: createWrapper() },
      )
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const input = screen.getByPlaceholderText(/Search files/)
      await user.type(input, "app")
      await waitFor(() => {
        expect(screen.getByText("/src/App.tsx")).toBeInTheDocument()
      })
      await user.click(screen.getByText("/src/App.tsx"))
      const recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
      expect(recent).toContain("/src/App.tsx")
    })

    it("shows recent files when no query", async () => {
      localStorage.setItem(RECENT_KEY, JSON.stringify(["/src/recent.ts"]))
      render(<CommandPalette />, { wrapper: createWrapper() })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(screen.getByText("/src/recent.ts")).toBeInTheDocument()
      })
    })
  })
})
