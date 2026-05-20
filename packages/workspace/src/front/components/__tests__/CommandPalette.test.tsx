import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommandPalette } from "../CommandPalette"
import { RegistryProvider } from "../../registry/RegistryProvider"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { CatalogRegistry } from "../../../shared/plugins/CatalogRegistry"
import { bootstrap } from "../../../shared/plugins/bootstrap"
import type { WorkspaceFrontPlugin } from "../../../shared/plugins/defineFrontPlugin"
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

function createTestCatalogPlugin(catalog: CatalogConfig): WorkspaceFrontPlugin {
  return {
    id: TEST_CATALOG_PLUGIN_ID,
    label: "Test Catalog Plugin",
    outputs: [{ type: "catalog", catalog }],
  }
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
      const newInput = screen.getByPlaceholderText(/Search catalogs/)
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

      expect(screen.getByRole("button", { name: "Catalogs" })).toHaveAttribute("aria-pressed", "true")
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
      expect(input.getAttribute("placeholder")).toMatch(/Search catalogs/)
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
