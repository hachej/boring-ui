import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommandPalette } from "../CommandPalette"
import { RegistryProvider } from "../../registry/RegistryProvider"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { CatalogRegistry } from "../../../shared/plugins/CatalogRegistry"
import { bootstrap } from "../../../shared/plugins/bootstrap"
import { definePlugin } from "../../../shared/plugins/frontFactory"
import type { CatalogConfig } from "../../../shared/plugins/types"
import type { CatalogRow, CatalogSearchResult } from "../../../shared/plugins/types"
import type { RecentEntry } from "../recent/types"
import { STORAGE_KEY as RECENT_KEY } from "../recent/recentStore"

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function fileOptionName(path: string): RegExp {
  const lastSlash = path.lastIndexOf("/")
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : ""
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
  return new RegExp(`${escapeRegExp(name)}.*${escapeRegExp(dir)}`)
}

function getFileOption(path: string): HTMLElement {
  return screen.getByRole("option", { name: fileOptionName(path) })
}

function getPaletteInput(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement
}

async function typePaletteQuery(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
): Promise<HTMLInputElement> {
  const input = getPaletteInput()
  await user.clear(input)
  if (query) {
    await user.type(input, query)
  }
  return input
}

function createWrapper(commandRegistry?: CommandRegistry, catalogRegistry?: CatalogRegistry) {
  const pr = new PanelRegistry()
  const cr = commandRegistry ?? new CommandRegistry()
  const cat = catalogRegistry ?? new CatalogRegistry({ warnOnDuplicate: false })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <RegistryProvider panelRegistry={pr} commandRegistry={cr} catalogRegistry={cat}>
        {children}
      </RegistryProvider>
    )
  }
}

function rowFromPath(path: string): CatalogRow {
  const lastSlash = path.lastIndexOf("/")
  return {
    id: path,
    title: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
    subtitle: lastSlash >= 0 ? path.slice(0, lastSlash + 1) : undefined,
  }
}

function resultFor(paths: string[]): CatalogSearchResult {
  return {
    items: paths.map(rowFromPath),
    total: paths.length,
    hasMore: false,
  }
}

const TEST_CATALOG_ID = "test-files"
const TEST_CATALOG_PLUGIN_ID = "test-catalog-plugin"

function createTestCatalog(
  search: CatalogConfig["adapter"]["search"],
  onSelect = vi.fn(),
): CatalogConfig {
  return {
    id: TEST_CATALOG_ID,
    label: "Test Files",
    adapter: { search },
    onSelect,
  }
}

function createTestCatalogPlugin(catalog: CatalogConfig) {
  return definePlugin({
    id: TEST_CATALOG_PLUGIN_ID,
    label: "Test Catalog Plugin",
    catalogs: [catalog],
  })
}

function registryWithCatalogPlugin(catalog: CatalogConfig): CatalogRegistry {
  const registry = new CatalogRegistry({ warnOnDuplicate: false })
  bootstrap({
    chatPanel: {},
    plugins: [createTestCatalogPlugin(catalog)],
    registries: {
      panels: new PanelRegistry(),
      commands: new CommandRegistry(),
      catalogs: registry,
    },
  })
  return registry
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
  vi.unstubAllGlobals()
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
      const input = getPaletteInput()
      await user.type(input, "hello")
      await user.keyboard("{Escape}")
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      const newInput = screen.getByPlaceholderText(/Search sources/)
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

  describe("chat session search", () => {
    it("uses an injected session search adapter before rendering chat results", async () => {
      const user = userEvent.setup()
      const onSwitch = vi.fn()
      const onOpenAsTab = vi.fn()
      const search = vi.fn((sessions: readonly { id: string; title?: string | null }[], query: string) => (
        query === "bbp" ? sessions.filter((session) => session.id === "session-b") : [...sessions]
      ))

      render(
        <CommandPalette
          sessionSearch={{
            sessions: [
              { id: "session-a", title: "Alpha plan" },
              { id: "session-b", title: "Beta build polish" },
            ],
            activeId: "session-a",
            openIds: ["session-a"],
            search,
            onSwitch,
            onOpenAsTab,
          }}
        />,
        { wrapper: createWrapper() },
      )

      fireKeydown("k", { metaKey: true })
      await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
      await typePaletteQuery(user, "bbp")
      expect(search).toHaveBeenLastCalledWith(expect.any(Array), "bbp")
      expect(screen.getByRole("option", { name: /Beta build polish/ })).toBeInTheDocument()
      expect(screen.queryByRole("option", { name: /Alpha plan/ })).not.toBeInTheDocument()
    })

    it("shows session results and routes select/split actions", async () => {
      const user = userEvent.setup()
      const onSwitch = vi.fn()
      const onOpenAsTab = vi.fn()

      render(
        <CommandPalette
          sessionSearch={{
            sessions: [
              { id: "session-a", title: "Alpha plan" },
              { id: "session-b", title: "Beta build" },
            ],
            activeId: "session-a",
            openIds: ["session-a"],
            onSwitch,
            onOpenAsTab,
          }}
        />,
        { wrapper: createWrapper() },
      )

      fireKeydown("k", { metaKey: true })
      await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
      const chatsMode = screen.getByRole("button", { name: "Chats" })
      expect(chatsMode).toHaveAttribute("aria-pressed", "true")
      expect(chatsMode).toHaveClass("command-palette-mode-button")
      expect(screen.getByRole("button", { name: "Sources" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Commands" })).toBeInTheDocument()
      expect(document.querySelector(".command-palette-search-layout")).toBeInTheDocument()
      expect(screen.getByRole("option", { name: /Alpha plan/ })).toHaveClass(
        "command-palette-result-row",
        "data-[selected=true]:ring-0",
      )
      expect(screen.getByRole("button", { name: "Open Alpha plan in new chat pane" })).toHaveClass("command-palette-secondary-action")

      await typePaletteQuery(user, "beta")
      await user.click(screen.getByRole("option", { name: /Beta build/ }))
      expect(onSwitch).toHaveBeenCalledWith("session-b")
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

      fireKeydown("k", { metaKey: true })
      await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
      await typePaletteQuery(user, "alpha")
      await user.click(screen.getByRole("button", { name: "Open Alpha plan in new chat pane" }))
      expect(onOpenAsTab).toHaveBeenCalledWith("session-a")
    })
  })

  describe("catalog quick-open", () => {
    it("shows catalog results from registered catalogs", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockResolvedValue(resultFor(["/src/App.tsx", "/src/index.ts"]))
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(searchFn))
      render(<CommandPalette />, {
        wrapper: createWrapper(undefined, catalogRegistry),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, "app")
      await waitFor(() => {
        expect(searchFn).toHaveBeenCalledWith(expect.objectContaining({ query: "app" }))
      })
      await waitFor(() => {
        expect(getFileOption("/src/App.tsx")).toBeInTheDocument()
        expect(getFileOption("/src/index.ts")).toBeInTheDocument()
      })
    })

    it("calls catalog onSelect when row is selected", async () => {
      const user = userEvent.setup()
      const row = rowFromPath("/src/App.tsx")
      const searchFn = vi.fn().mockResolvedValue({ items: [row], total: 1, hasMore: false })
      const onSelect = vi.fn()
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(searchFn, onSelect))
      render(<CommandPalette />, {
        wrapper: createWrapper(undefined, catalogRegistry),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, "app")
      await waitFor(() => {
        expect(getFileOption("/src/App.tsx")).toBeInTheDocument()
      })
      await user.click(getFileOption("/src/App.tsx"))
      expect(onSelect).toHaveBeenCalledWith(row)
    })

    it("shows empty state when no catalog rows match", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockResolvedValue(resultFor([]))
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(searchFn))
      render(<CommandPalette />, {
        wrapper: createWrapper(undefined, catalogRegistry),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, "nonexistent")
      await waitFor(() => {
        expect(screen.getByText("No catalog results")).toBeInTheDocument()
      })
    })

    it("renders an inline catalog error when search throws", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn(() => {
        throw new Error("Catalog unavailable")
      })
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(searchFn))
      render(<CommandPalette />, {
        wrapper: createWrapper(undefined, catalogRegistry),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, "app")
      await waitFor(() => {
        expect(screen.getByText("Catalog unavailable")).toBeInTheDocument()
      })
    })

    it("closes palette after catalog row selection", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockResolvedValue(resultFor(["/src/App.tsx"]))
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(searchFn))
      render(<CommandPalette />, {
        wrapper: createWrapper(undefined, catalogRegistry),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, "app")
      await waitFor(() => {
        expect(getFileOption("/src/App.tsx")).toBeInTheDocument()
      })
      await user.click(getFileOption("/src/App.tsx"))
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
    })
  })

  describe("command mode", () => {
    it("switches between catalogs and commands with the mode buttons", async () => {
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

      expect(screen.getByRole("button", { name: "Sources" })).toHaveAttribute("aria-pressed", "true")
      await user.click(screen.getByRole("button", { name: "Commands" }))

      expect(screen.getByPlaceholderText(/Run a command/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Commands" })).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByText("Test Command")).toBeInTheDocument()
    })

    it("toggles catalogs and commands with Tab", async () => {
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

      const input = getPaletteInput()
      await user.keyboard("{Tab}")
      expect(screen.getByPlaceholderText(/Run a command/)).toBeInTheDocument()
      expect(screen.getByText("Test Command")).toBeInTheDocument()

      await user.keyboard("{Tab}")
      expect(input.getAttribute("placeholder")).toMatch(/Search sources/)
      expect(screen.queryByText("Test Command")).not.toBeInTheDocument()
    })

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
      await typePaletteQuery(user, ">")
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/Run a command/),
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
      await typePaletteQuery(user, ">sidebar")
      await waitFor(() => {
        expect(screen.getByText("Toggle Sidebar")).toBeInTheDocument()
      })
      expect(screen.queryByText("Toggle Theme")).not.toBeInTheDocument()
    })

    it("filters commands by keywords too", async () => {
      const user = userEvent.setup()
      const cr = new CommandRegistry()
      cr.registerCommand({
        id: "members",
        title: "Manage Members",
        keywords: ["team", "people", "roles"],
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
      await typePaletteQuery(user, ">team")
      await waitFor(() => {
        expect(screen.getByText("Manage Members")).toBeInTheDocument()
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
      await typePaletteQuery(user, ">")
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
      await typePaletteQuery(user, ">")
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
      await typePaletteQuery(user, ">nonexistent")
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
      await typePaletteQuery(user, ">")
      await waitFor(() => {
        expect(screen.getByText("Visible Command")).toBeInTheDocument()
      })
      expect(screen.queryByText("Hidden Command")).not.toBeInTheDocument()
    })

    it("updates while open when a command registers late", async () => {
      const user = userEvent.setup()
      const cr = new CommandRegistry()
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, ">")
      expect(screen.queryByText("Late Command")).not.toBeInTheDocument()

      act(() => {
        cr.registerCommand({ id: "late", title: "Late Command", run: vi.fn() })
      })

      await waitFor(() => {
        expect(screen.getByText("Late Command")).toBeInTheDocument()
      })
    })
  })

  describe("responsive layout", () => {
    async function openPalette() {
      render(<CommandPalette />, { wrapper: createWrapper() })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
    }

    function getSearchLayout(): HTMLElement {
      const layout = document.querySelector(".command-palette-search-layout")
      if (!(layout instanceof HTMLElement)) throw new Error("search layout not rendered")
      return layout
    }

    it("puts the input ahead of the mode switcher on compact viewports only", async () => {
      await openPalette()
      const layout = getSearchLayout()
      const wrapper = layout.querySelector("[data-slot=command-input-wrapper]")
      expect(wrapper).toBeInTheDocument()

      // jsdom has no layout engine, so the compact ordering is asserted through
      // the responsive utilities that produce it: the input claims the first
      // full-width row below `sm:` and returns to the inline row above it.
      expect(layout.className).toContain("[&>[data-slot=command-input-wrapper]]:order-first")
      expect(layout.className).toContain("[&>[data-slot=command-input-wrapper]]:basis-full")
      expect(layout.className).toContain("sm:[&>[data-slot=command-input-wrapper]]:order-none")
      expect(layout.className).toContain("sm:[&>[data-slot=command-input-wrapper]]:basis-auto")
      // The 15rem input floor is what forced the wrap; it must not apply compact.
      expect(layout.className).not.toContain(" [&>[data-slot=command-input-wrapper]]:min-w-[15rem]")
      expect(layout.className).toContain("sm:[&>[data-slot=command-input-wrapper]]:min-w-[15rem]")

      const modeGroup = screen.getByRole("group", { name: "Palette mode" })
      expect(modeGroup.className).toContain("basis-full")
      expect(modeGroup.className).toContain("sm:basis-auto")
    })

    it("keeps mode button accessible names when the labels are visually hidden", async () => {
      await openPalette()
      for (const name of ["Sources", "Commands"]) {
        const button = screen.getByRole("button", { name })
        const label = button.querySelector("span.sr-only")
        expect(label).not.toBeNull()
        expect(label).toHaveTextContent(name)
        // `sr-only`, not `hidden`: the name must survive the icon-only layout.
        expect(label?.className).toContain("sm:not-sr-only")
      }
    })

    it("caps the dialog height against the safe area and the software keyboard", async () => {
      await openPalette()
      const maxHeight = screen.getByRole("dialog").getAttribute("style") ?? ""
      expect(maxHeight).toContain("100dvh")
      expect(maxHeight).toContain("var(--keyboard-inset, 0px)")
      expect(maxHeight).toContain("var(--sa-top, env(safe-area-inset-top, 0px))")
    })

    it("keeps the palette input at 16px so iOS does not zoom on focus", async () => {
      await openPalette()
      expect(getPaletteInput().className).toContain("text-base")
    })
  })

  describe("recent items", () => {
    it("saves selected catalog rows as RecentEntry with type catalog", async () => {
      const user = userEvent.setup()
      const searchFn = vi.fn().mockResolvedValue(resultFor(["/src/App.tsx"]))
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(searchFn))
      render(<CommandPalette />, {
        wrapper: createWrapper(undefined, catalogRegistry),
      })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, "app")
      await waitFor(() => {
        expect(getFileOption("/src/App.tsx")).toBeInTheDocument()
      })
      await user.click(getFileOption("/src/App.tsx"))
      const recent: RecentEntry[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
      expect(recent[0]).toMatchObject({
        type: "catalog",
        catalogId: TEST_CATALOG_ID,
        rowId: "/src/App.tsx",
      })
      expect(recent[0].type === "catalog" && recent[0].rowSnapshot.title).toBe("App.tsx")
    })

    it("shows recent catalog entries when no query", async () => {
      const catalogEntry: RecentEntry = {
        type: "catalog",
        catalogId: TEST_CATALOG_ID,
        rowId: "/src/recent.ts",
        rowSnapshot: { id: "/src/recent.ts", title: "recent.ts", subtitle: "/src/" },
        selectedAt: Date.now(),
      }
      localStorage.setItem(RECENT_KEY, JSON.stringify([catalogEntry]))
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(vi.fn().mockResolvedValue(resultFor([]))))
      render(<CommandPalette />, { wrapper: createWrapper(undefined, catalogRegistry) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(screen.getByText("recent.ts")).toBeInTheDocument()
      })
    })

    it("saves selected commands as RecentEntry with type command", async () => {
      const user = userEvent.setup()
      const run = vi.fn()
      const cr = new CommandRegistry()
      cr.registerCommand({ id: "members", title: "Manage Members", run })
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await typePaletteQuery(user, ">")
      await waitFor(() => {
        expect(screen.getByText("Manage Members")).toBeInTheDocument()
      })
      await user.click(screen.getByText("Manage Members"))
      expect(run).toHaveBeenCalledOnce()
      const recent: RecentEntry[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
      expect(recent[0]).toMatchObject({
        type: "command",
        commandId: "members",
        titleSnapshot: "Manage Members",
      })
    })

    it("shows recent command entries with command chip", async () => {
      const cr = new CommandRegistry()
      cr.registerCommand({ id: "theme", title: "Toggle Theme", run: vi.fn() })
      const commandEntry: RecentEntry = {
        type: "command",
        commandId: "theme",
        titleSnapshot: "Toggle Theme",
        selectedAt: Date.now(),
      }
      localStorage.setItem(RECENT_KEY, JSON.stringify([commandEntry]))
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(screen.getByText("Toggle Theme")).toBeInTheDocument()
        expect(screen.getByText("command")).toBeInTheDocument()
      })
    })

    it("drops orphan entries whose source is no longer registered", async () => {
      const orphanCatalog: RecentEntry = {
        type: "catalog",
        catalogId: "uninstalled-plugin",
        rowId: "x",
        rowSnapshot: { id: "x", title: "orphan" },
        selectedAt: Date.now(),
      }
      const orphanCommand: RecentEntry = {
        type: "command",
        commandId: "unregistered-cmd",
        titleSnapshot: "Ghost Command",
        selectedAt: Date.now(),
      }
      localStorage.setItem(RECENT_KEY, JSON.stringify([orphanCatalog, orphanCommand]))
      render(<CommandPalette />, { wrapper: createWrapper() })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      expect(screen.queryByText("orphan")).not.toBeInTheDocument()
      expect(screen.queryByText("Ghost Command")).not.toBeInTheDocument()
    })

    it("clicking recent catalog entry calls catalog.onSelect", async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const row = rowFromPath("/src/App.tsx")
      const catalogEntry: RecentEntry = {
        type: "catalog",
        catalogId: TEST_CATALOG_ID,
        rowId: "/src/App.tsx",
        rowSnapshot: row,
        selectedAt: Date.now(),
      }
      localStorage.setItem(RECENT_KEY, JSON.stringify([catalogEntry]))
      const catalogRegistry = registryWithCatalogPlugin(createTestCatalog(vi.fn().mockResolvedValue(resultFor([])), onSelect))
      render(<CommandPalette />, { wrapper: createWrapper(undefined, catalogRegistry) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(screen.getByText("App.tsx")).toBeInTheDocument()
      })
      await user.click(screen.getByText("App.tsx"))
      expect(onSelect).toHaveBeenCalledWith(row)
    })

    it("clicking recent command entry calls command.run()", async () => {
      const user = userEvent.setup()
      const run = vi.fn()
      const cr = new CommandRegistry()
      cr.registerCommand({ id: "theme", title: "Toggle Theme", run })
      const commandEntry: RecentEntry = {
        type: "command",
        commandId: "theme",
        titleSnapshot: "Toggle Theme",
        selectedAt: Date.now(),
      }
      localStorage.setItem(RECENT_KEY, JSON.stringify([commandEntry]))
      render(<CommandPalette />, { wrapper: createWrapper(cr) })
      fireKeydown("p", { metaKey: true })
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(screen.getByText("Toggle Theme")).toBeInTheDocument()
      })
      await user.click(screen.getByText("Toggle Theme"))
      expect(run).toHaveBeenCalledOnce()
    })
  })
})
