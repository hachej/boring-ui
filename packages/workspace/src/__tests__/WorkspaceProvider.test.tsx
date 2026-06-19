import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import { type ReactNode, useState } from "react"
import {
  WorkspaceProvider,
  formatWorkspaceDocumentTitle,
  useTheme,
  useWorkspaceBridge,
} from "../front/provider"
import { useApiBaseUrl, useDataClient, useWorkspaceRequestId } from "../plugins/filesystemPlugin/front/data"
import { useRegistry, useCommandRegistry, useCatalogRegistry } from "../front/registry"
import { useCatalogs } from "../front/plugin/useCatalogs"
import { useCommands } from "../front/plugin/useCommands"
import { useThemePreference } from "../front/store/selectors"
import type { PanelConfig } from "../front/registry/types"
import type { CatalogConfig } from "../shared/plugins/types"

function DummyPanel() {
  return <div>panel</div>
}

const testPanel: PanelConfig = {
  id: "test-panel",
  title: "Test Panel",
  component: DummyPanel,
  source: "app",
}

const chatPanel: PanelConfig = {
  id: "chat",
  title: "Chat",
  component: DummyPanel,
  source: "app",
  placement: "right",
  requiresCapabilities: ["agent.chat"],
}

function RegistryPanelHost({ panelId }: { panelId: string }) {
  const reg = useRegistry()
  const Panel = reg.getComponents()[panelId]

  if (!Panel) {
    return <div data-testid="panel-missing">missing</div>
  }

  return <Panel />
}

let originalStorage: Storage

beforeEach(() => {
  originalStorage = globalThis.localStorage
  const storage = new Map<string, string>()
  const mockStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key)
    }),
    clear: vi.fn(() => storage.clear()),
    get length() {
      return storage.size
    },
    key: vi.fn((index: number) => [...storage.keys()][index] ?? null),
  } as unknown as Storage
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
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

function wrapper({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider panels={[testPanel]} persistenceEnabled={false}>
      {children}
    </WorkspaceProvider>
  )
}

describe("WorkspaceProvider — context composition", () => {
  it("provides useRegistry with registered panels", () => {
    function Inspector() {
      const reg = useRegistry()
      return <div data-testid="has-panel">{String(reg.has("test-panel"))}</div>
    }

    render(
      <WorkspaceProvider panels={[testPanel]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("has-panel").textContent).toBe("true")
  })

  it("provides useCommandRegistry", async () => {
    function Inspector() {
      const cmds = useCommands()
      return <div data-testid="cmds">{String(cmds.length)}</div>
    }

    render(
      <WorkspaceProvider
        commands={[{ id: "test-command", title: "Test command", run: () => {} }]}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    await waitFor(() => {
      expect(Number(screen.getByTestId("cmds").textContent)).toBeGreaterThanOrEqual(1)
    })
  })

  it("provides useCatalogRegistry with default filesystem catalog", async () => {
    function Inspector() {
      const catalogs = useCatalogs()
      return <div data-testid="catalogs">{String(catalogs.length)}</div>
    }

    render(
      <WorkspaceProvider persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("catalogs").textContent).toBe("1")
    })
  })

  it("excludeDefaults removes filesystem catalog", () => {
    function Inspector() {
      const catalogs = useCatalogRegistry()
      return <div data-testid="catalogs">{String(catalogs.list().length)}</div>
    }

    render(
      <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("catalogs").textContent).toBe("0")
  })

  it("provides useTheme with correct initial value", () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe("light")
    expect(typeof result.current.setTheme).toBe("function")
  })

  it("provides useWorkspaceBridge", () => {
    const { result } = renderHook(() => useWorkspaceBridge(), { wrapper })
    expect(result.current.connected).toBe(false)
  })

  it("mounts the filesystem plugin DataProvider output by default", () => {
    const { result } = renderHook(() => useDataClient(), { wrapper })
    expect(result.current).toBeDefined()
  })

  it("exposes apiBaseUrl via useApiBaseUrl", () => {
    const { result } = renderHook(() => useApiBaseUrl(), { wrapper })
    expect(result.current).toBe("")
  })

  it("scopes filesystem requests from workspaceId by default", () => {
    const scopedWrapper = ({ children }: { children: ReactNode }) => (
      <WorkspaceProvider workspaceId="workspace-scope" persistenceEnabled={false}>
        {children}
      </WorkspaceProvider>
    )
    const { result } = renderHook(() => useWorkspaceRequestId(), { wrapper: scopedWrapper })
    expect(result.current).toBe("workspace-scope")
  })
})

describe("WorkspaceProvider — panel registration", () => {
  it("registers panels from props alongside core + defaults", () => {
    function Inspector() {
      const reg = useRegistry()
      const panels = reg.list()
      return <div data-testid="ids">{panels.map((p) => p.id).join(",")}</div>
    }

    render(
      <WorkspaceProvider
        panels={[testPanel, { ...chatPanel }]}
        capabilities={{ "agent.chat": true }}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    // 4 core panels (chat overwritten by prop's chat) + 8 filesystem outputs/panels + testPanel
    expect(ids).toContain("chat")
    expect(ids).toContain("session-list")
    expect(ids).toContain("workbench-left")
    expect(ids).toContain("artifact-surface")
    expect(ids).toContain("empty-file-panel")
    expect(ids).toContain("files")
    expect(ids).toContain("test-panel")
    expect(ids).toHaveLength(13)
  })

  it("excludeDefaults removes default plugin panels but not core panels", () => {
    function Inspector() {
      const reg = useRegistry()
      const panels = reg.list()
      return <div data-testid="ids">{panels.map((p) => p.id).join(",")}</div>
    }

    render(
      <WorkspaceProvider
        panels={[testPanel, { ...chatPanel }]}
        capabilities={{ "agent.chat": true }}
        excludeDefaults={["filesystem"]}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    // 4 core panels (chat overwritten by prop) + testPanel = 5
    expect(ids).toContain("chat")
    expect(ids).toContain("session-list")
    expect(ids).toContain("test-panel")
    expect(ids).not.toContain("files")
    expect(ids).not.toContain("empty-file-panel")
    expect(ids).not.toContain("code-editor")
    expect(ids).not.toContain("markdown-editor")
  })

  it("registers host catalogs from props alongside defaults", async () => {
    const reportsCatalog: CatalogConfig = {
      id: "reports",
      label: "Reports",
      adapter: {
        search: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
      },
      onSelect: vi.fn(),
    }

    function Inspector() {
      const catalogs = useCatalogs()
      return <div data-testid="catalog-ids">{catalogs.map((c) => c.id).join(",")}</div>
    }

    render(
      <WorkspaceProvider
        catalogs={[reportsCatalog]}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("catalog-ids").textContent!.split(",").sort()).toEqual(["files", "reports"])
    })
  })

  it("registers filesystem plugin file search as the default files catalog", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: ["/src/App.tsx"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useCatalogRegistry(), {
      wrapper: ({ children }) => (
        <WorkspaceProvider
          persistenceEnabled={false}
        >
          {children}
        </WorkspaceProvider>
      ),
    })

    await waitFor(() => {
      expect(result.current.get("files")?.label).toBe("Files")
    })

    const searchResult = await result.current.get("files")!.adapter.search({
      query: "app",
      filters: {},
      limit: 10,
      offset: 0,
    })

    expect(searchResult).toEqual({
      items: [{ id: "/src/App.tsx", title: "App.tsx", subtitle: "/src/" }],
      total: 1,
      hasMore: false,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/files/search?q=*%5BAa%5D%5BPp%5D%5BPp%5D*&limit=10",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("routes filesystem catalog selection through onOpenFile when supplied", async () => {
    const onOpenFile = vi.fn()
    const { result } = renderHook(() => useCatalogRegistry(), {
      wrapper: ({ children }) => (
        <WorkspaceProvider
          persistenceEnabled={false}
          onOpenFile={onOpenFile}
        >
          {children}
        </WorkspaceProvider>
      ),
    })

    await waitFor(() => {
      expect(result.current.get("files")?.label).toBe("Files")
    })

    act(() => {
      result.current.get("files")!.onSelect({ id: "/src/App.tsx", title: "App.tsx" })
    })

    expect(onOpenFile).toHaveBeenCalledWith("/src/App.tsx")
  })

  it("capabilities filter removes panels missing required capabilities", () => {
    function Inspector() {
      const reg = useRegistry()
      return <div data-testid="count">{reg.list().length}</div>
    }

    render(
      <WorkspaceProvider
        panels={[testPanel, chatPanel]}
        capabilities={{}}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    // 4 core + 8 filesystem + testPanel = 13 (prop's chat filtered by capabilities,
    // but core's chat has no requiresCapabilities so stays — prop's chat overwrites
    // core's, so chat is filtered). Result: 4-1 core + 8 filesystem + testPanel = 12
    expect(screen.getByTestId("count").textContent).toBe("12")
  })

  it("custom panel with same ID as another overrides it", () => {
    const overridePanel: PanelConfig = {
      id: "test-panel",
      title: "Override",
      component: DummyPanel,
      source: "app",
    }

    function Inspector() {
      const reg = useRegistry()
      const panel = reg.get("test-panel")
      return <div data-testid="title">{panel?.title}</div>
    }

    render(
      <WorkspaceProvider
        panels={[testPanel, overridePanel]}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("title").textContent).toBe("Override")
  })

  it("preserves placement metadata for app-registered panel", () => {
    function Inspector() {
      const reg = useRegistry()
      const panel = reg.get("chat")
      return <div data-testid="placement">{panel?.placement}</div>
    }

    render(
      <WorkspaceProvider
        panels={[chatPanel]}
        capabilities={{ "agent.chat": true }}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("placement").textContent).toBe("right")
  })

  it("lazy panel shows Suspense fallback before rendering", async () => {
    const lazyPanel: PanelConfig = {
      id: "agent-chat",
      title: "Agent Chat",
      source: "app",
      lazy: true,
      placement: "right",
      requiresCapabilities: ["agent.chat"],
      component: () =>
        Promise.resolve({
          default: () => <div data-testid="lazy-chat-panel">agent-chat</div>,
        }),
    }

    render(
      <WorkspaceProvider
        panels={[lazyPanel]}
        capabilities={{ "agent.chat": true }}
        persistenceEnabled={false}
      >
        <RegistryPanelHost panelId="agent-chat" />
      </WorkspaceProvider>,
    )

    expect(await screen.findByTestId("lazy-chat-panel")).toBeInTheDocument()
  })

  it("updating capabilities dynamically reveals gated panel", async () => {
    function Harness() {
      const [enabled, setEnabled] = useState(false)
      return (
        <WorkspaceProvider
          panels={[chatPanel]}
          capabilities={enabled ? { "agent.chat": true } : {}}
          persistenceEnabled={false}
        >
          <button onClick={() => setEnabled(true)} type="button">
            enable
          </button>
          <Inspector />
        </WorkspaceProvider>
      )
    }

    function Inspector() {
      const reg = useRegistry()
      const visible = reg.list().some((panel) => panel.id === "chat")
      return <div data-testid="has-chat">{String(visible)}</div>
    }

    render(<Harness />)
    expect(screen.getByTestId("has-chat").textContent).toBe("false")

    await act(async () => {
      screen.getByRole("button", { name: "enable" }).click()
    })

    expect(screen.getByTestId("has-chat").textContent).toBe("true")
  })

  it("undefined or null panels prop does not crash provider (core + defaults registered)", () => {
    function Inspector() {
      const reg = useRegistry()
      return <div data-testid="count">{reg.list().length}</div>
    }

    render(
      <WorkspaceProvider panels={undefined} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )
    // 4 core + 8 filesystem default outputs/panels = 12
    expect(screen.getByTestId("count").textContent).toBe("12")

    render(
      <WorkspaceProvider
        panels={null as unknown as PanelConfig[]}
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )
    expect(screen.getAllByTestId("count").at(-1)?.textContent).toBe("12")
  })
})

describe("WorkspaceProvider — document title", () => {
  it("formats the workspace label when present", () => {
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "PR Issue Manager", workspaceId: "workspace-1" })).toBe("PR Issue Manager · Boring UI")
  })

  it("falls back to workspaceId when label is missing", () => {
    expect(formatWorkspaceDocumentTitle({ workspaceId: "workspace-playground" })).toBe("workspace-playground · Boring UI")
  })

  it("keeps normal short ids that are not hostnames", () => {
    expect(formatWorkspaceDocumentTitle({ workspaceId: "abc" })).toBe("abc · Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "deadbeef" })).toBe("deadbeef · Boring UI")
  })

  it("uses the app title when provided", () => {
    expect(formatWorkspaceDocumentTitle({ appTitle: "Seneca AI", workspaceLabel: "Workspace A" })).toBe("Workspace A · Seneca AI")
  })

  it("falls back to the default title when no safe workspace metadata exists", () => {
    expect(formatWorkspaceDocumentTitle({})).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "   ", workspaceId: "" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "/home/ubuntu/projects/boring-ui-v2" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "127.0.0.1:5212" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "localhost:5212" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "workspace.example.com:5212" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "::1" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "C:/Users/demo/project" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceLabel: "HTTPS://workspace.example.com" })).toBe("Boring UI")
    expect(formatWorkspaceDocumentTitle({ workspaceId: "ac9ea9fc-0151-4e89-bd39-be38ac4d53cc" })).toBe("Boring UI")
  })

  it("updates document.title when workspace metadata changes", () => {
    const { rerender } = render(
      <WorkspaceProvider appTitle="Seneca AI" workspaceId="workspace-a" workspaceLabel="Workspace A" persistenceEnabled={false}>
        <div />
      </WorkspaceProvider>,
    )

    expect(document.title).toBe("Workspace A · Seneca AI")

    rerender(
      <WorkspaceProvider appTitle="Seneca AI" workspaceId="workspace-b" workspaceLabel="Workspace B" persistenceEnabled={false}>
        <div />
      </WorkspaceProvider>,
    )

    expect(document.title).toBe("Workspace B · Seneca AI")
  })

  it("falls back to workspaceId in document.title when label is missing", () => {
    render(
      <WorkspaceProvider workspaceId="workspace-scope" persistenceEnabled={false}>
        <div />
      </WorkspaceProvider>,
    )

    expect(document.title).toBe("workspace-scope · Boring UI")
  })

  it("falls back to workspaceId in document.title when workspaceLabel is unsafe", () => {
    render(
      <WorkspaceProvider workspaceId="workspace-scope" workspaceLabel="localhost:5212" persistenceEnabled={false}>
        <div />
      </WorkspaceProvider>,
    )

    expect(document.title).toBe("workspace-scope · Boring UI")
  })
})

describe("WorkspaceProvider — theme", () => {
  it("defaultTheme=dark sets initial theme to dark", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkspaceProvider defaultTheme="dark" persistenceEnabled={false}>
          {children}
        </WorkspaceProvider>
      ),
    })

    expect(result.current.theme).toBe("dark")
  })

  it("onThemeChange fires when theme changes", () => {
    const onChange = vi.fn()

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkspaceProvider onThemeChange={onChange} persistenceEnabled={false}>
          {children}
        </WorkspaceProvider>
      ),
    })

    act(() => result.current.setTheme("dark"))
    expect(onChange).toHaveBeenCalledWith("dark")
  })

  it("setTheme updates reactive theme value", () => {
    const { result } = renderHook(() => useTheme(), { wrapper })

    act(() => result.current.setTheme("dark"))
    expect(result.current.theme).toBe("dark")

    act(() => result.current.setTheme("light"))
    expect(result.current.theme).toBe("light")
  })
})

describe("WorkspaceProvider — persistence", () => {
  it("workspaceId scopes persistence key", () => {
    render(
      <WorkspaceProvider workspaceId="my-project">
        <div />
      </WorkspaceProvider>,
    )

    const calls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls
    const keys = calls.map((c: unknown[]) => c[0] as string)
    expect(keys.some((k: string) => k === "boring-ui-v2:layout:my-project")).toBe(true)
  })

  it("storageKey overrides workspaceId", () => {
    render(
      <WorkspaceProvider workspaceId="ignored" storageKey="custom-key">
        <div />
      </WorkspaceProvider>,
    )

    const calls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls
    const keys = calls.map((c: unknown[]) => c[0] as string)
    expect(keys.some((k: string) => k === "custom-key")).toBe(true)
    expect(keys.some((k: string) => k.includes("ignored"))).toBe(false)
  })

  it("persistenceEnabled=false prevents localStorage reads/writes", () => {
    render(
      <WorkspaceProvider persistenceEnabled={false}>
        <div />
      </WorkspaceProvider>,
    )

    expect(localStorage.getItem).not.toHaveBeenCalledWith("boring-ui-v2:layout")
    expect(localStorage.setItem).not.toHaveBeenCalledWith(
      "boring-ui-v2:layout",
      expect.any(String),
    )
  })
})

describe("WorkspaceProvider — bridge", () => {
  it("bridgeEndpoint provided starts disconnected until server responds", () => {
    const { result } = renderHook(() => useWorkspaceBridge(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkspaceProvider
          bridgeEndpoint="http://localhost:3000"
          persistenceEnabled={false}
        >
          {children}
        </WorkspaceProvider>
      ),
    })

    expect(result.current.connected).toBe(false)
  })

  it("bridgeEndpoint=null sets connected=false", () => {
    const { result } = renderHook(() => useWorkspaceBridge(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkspaceProvider bridgeEndpoint={null} persistenceEnabled={false}>
          {children}
        </WorkspaceProvider>
      ),
    })

    expect(result.current.connected).toBe(false)
  })

  it("no bridgeEndpoint defaults to connected=false", () => {
    const { result } = renderHook(() => useWorkspaceBridge(), { wrapper })
    expect(result.current.connected).toBe(false)
  })
})

describe("WorkspaceProvider — data wiring", () => {
  it("apiBaseUrl is passed through to the filesystem plugin DataProvider output", () => {
    const { result } = renderHook(() => useApiBaseUrl(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkspaceProvider apiBaseUrl="https://api.example.com" persistenceEnabled={false}>
          {children}
        </WorkspaceProvider>
      ),
    })

    expect(result.current).toBe("https://api.example.com")
  })

  it("apiBaseUrl defaults to empty string", () => {
    const { result } = renderHook(() => useApiBaseUrl(), { wrapper })
    expect(result.current).toBe("")
  })

  it("does not mount filesystem data wiring when the filesystem default plugin is excluded", () => {
    expect(() =>
      renderHook(() => useDataClient(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
            {children}
          </WorkspaceProvider>
        ),
      }),
    ).toThrow("useDataClient must be used within a DataProvider")
  })
})

describe("WorkspaceProvider — hooks outside provider", () => {
  it("useTheme throws outside WorkspaceProvider", () => {
    expect(() => renderHook(() => useTheme())).toThrow(
      "useTheme must be used within a WorkspaceProvider",
    )
  })

  it("useWorkspaceBridge throws outside WorkspaceProvider", () => {
    expect(() => renderHook(() => useWorkspaceBridge())).toThrow(
      "useWorkspaceBridge must be used within a WorkspaceProvider",
    )
  })

  it("useDataClient throws outside WorkspaceProvider (no DataProvider)", () => {
    expect(() => renderHook(() => useDataClient())).toThrow(
      "useDataClient must be used within a DataProvider",
    )
  })
})
