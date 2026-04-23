import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import {
  WorkspaceProvider,
  useTheme,
  useWorkspaceBridge,
  useDataProvider,
} from "../WorkspaceProvider"
import { useRegistry, useCommandRegistry } from "../registry"
import { useThemePreference } from "../store/selectors"
import type { PanelConfig } from "../registry/types"
import type { ReactNode } from "react"

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
  requiresCapabilities: ["agent.chat"],
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

  it("provides useCommandRegistry", () => {
    function Inspector() {
      const cmds = useCommandRegistry()
      return <div data-testid="cmds">{String(cmds.getCommands().length)}</div>
    }

    render(
      <WorkspaceProvider persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("cmds").textContent).toBe("0")
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

  it("provides useDataProvider", () => {
    const { result } = renderHook(() => useDataProvider(), { wrapper })
    expect(result.current.apiBaseUrl).toBe("")
  })
})

describe("WorkspaceProvider — panel registration", () => {
  it("registers panels from props", () => {
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

    expect(screen.getByTestId("ids").textContent).toBe("test-panel,chat")
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

    expect(screen.getByTestId("count").textContent).toBe("1")
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

describe("WorkspaceProvider — bridge stub", () => {
  it("bridgeEndpoint provided sets connected=true", () => {
    const { result } = renderHook(() => useWorkspaceBridge(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkspaceProvider
          bridgeEndpoint="/api/v1/ui/commands/next"
          persistenceEnabled={false}
        >
          {children}
        </WorkspaceProvider>
      ),
    })

    expect(result.current.connected).toBe(true)
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

describe("WorkspaceProvider — data stub", () => {
  it("apiBaseUrl is passed through", () => {
    const { result } = renderHook(() => useDataProvider(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkspaceProvider apiBaseUrl="https://api.example.com" persistenceEnabled={false}>
          {children}
        </WorkspaceProvider>
      ),
    })

    expect(result.current.apiBaseUrl).toBe("https://api.example.com")
  })

  it("apiBaseUrl defaults to empty string", () => {
    const { result } = renderHook(() => useDataProvider(), { wrapper })
    expect(result.current.apiBaseUrl).toBe("")
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

  it("useDataProvider throws outside WorkspaceProvider", () => {
    expect(() => renderHook(() => useDataProvider())).toThrow(
      "useDataProvider must be used within a WorkspaceProvider",
    )
  })
})
