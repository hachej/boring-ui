import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { WorkspaceProvider } from "../front/provider"
import { useRegistry, useCommandRegistry, useCatalogRegistry } from "../front/registry"
import { useCatalogs } from "../front/plugin/useCatalogs"
import { definePlugin } from "../shared/plugins/frontFactory"
const DummyPanel = () => null

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
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

let originalStorage: Storage
beforeEach(() => {
  originalStorage = globalThis.localStorage
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
      get length() { return storage.size },
      key: vi.fn((index: number) => [...storage.keys()][index] ?? null),
    } as unknown as Storage,
    writable: true,
    configurable: true,
  })
})
afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalStorage,
    writable: true,
    configurable: true,
  })
  vi.unstubAllGlobals()
})

describe("WorkspaceProvider — plugin integration", () => {
  it("bootstrap runs once on mount and registers user plugin contributions", () => {
    const testPlugin = definePlugin({
      id: "test-plugin",
      label: "Test",
      panels: [{ id: "test-panel", label: "Test", component: DummyPanel, source: "app" }],
      commands: [{ id: "test-cmd", title: "Test Command", run: vi.fn() }],
    })

    function Inspector() {
      const reg = useRegistry()
      const cmds = useCommandRegistry()
      return (
        <div>
          <span data-testid="has-panel">{String(reg.has("test-panel"))}</span>
          <span data-testid="has-cmd">{String(!!cmds.getCommand("test-cmd"))}</span>
        </div>
      )
    }

    render(
      <WorkspaceProvider plugins={[testPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("has-panel").textContent).toBe("true")
    expect(screen.getByTestId("has-cmd").textContent).toBe("true")
  })

  it("package/app-provided commands appear in CommandPalette and execute", async () => {
    const user = userEvent.setup()
    const run = vi.fn()

    render(
      <WorkspaceProvider
        commands={[
          {
            id: "user:settings",
            title: "Account settings",
            keywords: ["profile"],
            pluginId: "core",
            run,
          },
        ]}
        persistenceEnabled={false}
      >
        <div />
      </WorkspaceProvider>,
    )

    fireKeydown("k", { metaKey: true })
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
    await user.type(screen.getByRole("combobox"), ">profile")

    await waitFor(() => {
      expect(screen.getByText("Account settings")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Account settings"))
    expect(run).toHaveBeenCalledOnce()
  })

  it("plugin-provided commands appear in CommandPalette and execute", async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const plugin = definePlugin({
      id: "plugin-commands",
      label: "Plugin Commands",
      commands: [
        {
          id: "plugin.open-dashboard",
          title: "Open Plugin Dashboard",
          keywords: ["plugin-dashboard"],
          shortcut: "⌘D",
          run,
        },
      ],
    })

    render(
      <WorkspaceProvider plugins={[plugin]} persistenceEnabled={false}>
        <div />
      </WorkspaceProvider>,
    )

    fireKeydown("k", { metaKey: true })
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
    await user.type(screen.getByRole("combobox"), ">plugin-dashboard")

    await waitFor(() => {
      expect(screen.getByText("Open Plugin Dashboard")).toBeInTheDocument()
    })
    expect(screen.getByText("⌘D")).toBeInTheDocument()

    await user.click(screen.getByText("Open Plugin Dashboard"))
    expect(run).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("defaults include filesystemPlugin (files, editors, and file fallback panels)", () => {
    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    expect(ids).toContain("files")
    expect(ids).toContain("empty-file-panel")
    expect(ids).toContain("code-editor")
    expect(ids).toContain("markdown-editor")
  })

  it("excludeDefaults: ['filesystem'] removes all filesystem contributions", () => {
    function Inspector() {
      const reg = useRegistry()
      const catalogs = useCatalogRegistry()
      return (
        <div>
          <span data-testid="panel-ids">{reg.list().map((p) => p.id).join(",")}</span>
          <span data-testid="catalog-count">{catalogs.list().length}</span>
        </div>
      )
    }

    render(
      <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const panelIds = screen.getByTestId("panel-ids").textContent!.split(",")
    expect(panelIds).not.toContain("files")
    expect(panelIds).not.toContain("empty-file-panel")
    expect(panelIds).not.toContain("code-editor")
    expect(panelIds).not.toContain("markdown-editor")
    // core panels remain
    expect(panelIds).toContain("chat")
    expect(panelIds).toContain("session-list")
    expect(panelIds).toContain("workbench-left")
    expect(panelIds).toContain("artifact-surface")
    expect(screen.getByTestId("catalog-count").textContent).toBe("0")
  })

  it("existing children still work (capabilities, theme, etc.)", () => {
    function Inspector() {
      const reg = useRegistry()
      return <div data-testid="count">{reg.list().length}</div>
    }

    render(
      <WorkspaceProvider
        capabilities={{ "agent.chat": true }}
        defaultTheme="dark"
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(Number(screen.getByTestId("count").textContent)).toBeGreaterThanOrEqual(3)
  })

  it("user plugin alongside defaults does not conflict", () => {
    const customPlugin = definePlugin({
      id: "analytics",
      panels: [{ id: "analytics-dashboard", label: "Analytics", component: DummyPanel, source: "app" }],
    })

    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider plugins={[customPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    expect(ids).toContain("files")
    expect(ids).toContain("analytics-dashboard")
  })
})

describe("WorkspaceProvider — core panel registration (j9p7.25)", () => {
  it("registers the 4 core panels when default plugins are excluded", () => {
    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    expect(ids).toContain("chat")
    expect(ids).toContain("session-list")
    expect(ids).toContain("workbench-left")
    expect(ids).toContain("artifact-surface")
    expect(ids).not.toContain("empty-file-panel")
  })

  it("core panels have source 'builtin'", () => {
    function Inspector() {
      const reg = useRegistry()
      const coreIds = ["chat", "session-list", "workbench-left", "artifact-surface"]
      const sources = coreIds.map((id) => reg.get(id)?.source).join(",")
      return <div data-testid="sources">{sources}</div>
    }

    render(
      <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("sources").textContent).toBe(
      "builtin,builtin,builtin,builtin",
    )
  })

  it("core panels register BEFORE plugin panels (ordering)", () => {
    const testPlugin = definePlugin({
      id: "custom",
      panels: [{ id: "custom-panel", label: "Custom", component: DummyPanel, source: "app" }],
    })

    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider plugins={[testPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    const chatIdx = ids.indexOf("chat")
    const customIdx = ids.indexOf("custom-panel")
    expect(chatIdx).toBeLessThan(customIdx)
  })

  it("core panels + filesystem defaults + user plugin all coexist", () => {
    const testPlugin = definePlugin({
      id: "test",
      panels: [{ id: "test-panel", label: "Test", component: DummyPanel, source: "app" }],
    })

    function Inspector() {
      const reg = useRegistry()
      return <div data-testid="count">{reg.list().length}</div>
    }

    render(
      <WorkspaceProvider plugins={[testPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    // 4 core + 8 filesystem panels/left-tab + inbox/detail + 1 test = 15
    expect(screen.getByTestId("count").textContent).toBe("15")
  })
})
