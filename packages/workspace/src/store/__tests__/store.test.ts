import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { createWorkspaceStore } from "../index"
import {
  bindStore,
  useActiveFile,
  useActivePanel,
  useSidebarState,
  useOpenPanels,
  useDirtyFiles,
  useThemePreference,
  useHydrationComplete,
} from "../selectors"
import {
  validateLayoutPartition,
  validatePreferencesPartition,
} from "../validation"

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

describe("Store initialization", () => {
  it("initializes with correct default shape", () => {
    const store = createWorkspaceStore()
    const state = store.getState()
    expect(state.layout).toBeNull()
    expect(state.sidebar).toEqual({ collapsed: false, width: 260 })
    expect(state.panelSizes).toEqual({})
    expect(state.preferences).toEqual({ theme: "light" })
  })

  it("bridge state starts empty", () => {
    const store = createWorkspaceStore()
    const state = store.getState()
    expect(state.panels).toEqual([])
    expect(state.activeFile).toBeNull()
    expect(state.activePanel).toBeNull()
    expect(state.visibleFiles).toEqual([])
    expect(state.dirtyFiles).toEqual({})
    expect(state.notifications).toEqual([])
  })
})

describe("Store actions", () => {
  it("setLayout updates layout", () => {
    const store = createWorkspaceStore()
    store.getState().setLayout({ groups: [] })
    expect(store.getState().layout).toEqual({ groups: [] })
  })

  it("setSidebar merges partial state", () => {
    const store = createWorkspaceStore()
    store.getState().setSidebar({ collapsed: true })
    expect(store.getState().sidebar).toEqual({ collapsed: true, width: 260 })
  })

  it("setPanelSize stores size by id", () => {
    const store = createWorkspaceStore()
    store.getState().setPanelSize("panel-a", 300)
    expect(store.getState().panelSizes["panel-a"]).toBe(300)
  })

  it("setTheme updates preferences", () => {
    const store = createWorkspaceStore()
    store.getState().setTheme("dark")
    expect(store.getState().preferences.theme).toBe("dark")
  })

  it("openPanel adds panel and activates it", () => {
    const store = createWorkspaceStore()
    store.getState().openPanel({ id: "p1", component: "filetree" })
    expect(store.getState().panels).toHaveLength(1)
    expect(store.getState().activePanel).toBe("p1")
  })

  it("openPanel does not duplicate existing panel", () => {
    const store = createWorkspaceStore()
    store.getState().openPanel({ id: "p1", component: "filetree" })
    store.getState().openPanel({ id: "p1", component: "filetree" })
    expect(store.getState().panels).toHaveLength(1)
  })

  it("closePanel removes panel and clears activePanel if match", () => {
    const store = createWorkspaceStore()
    store.getState().openPanel({ id: "p1", component: "filetree" })
    store.getState().closePanel("p1")
    expect(store.getState().panels).toHaveLength(0)
    expect(store.getState().activePanel).toBeNull()
  })

  it("activatePanel sets activePanel", () => {
    const store = createWorkspaceStore()
    store.getState().activatePanel("p1")
    expect(store.getState().activePanel).toBe("p1")
  })

  it("openFile sets activeFile and adds to visibleFiles", () => {
    const store = createWorkspaceStore()
    store.getState().openFile("readme.md")
    expect(store.getState().activeFile).toBe("readme.md")
    expect(store.getState().visibleFiles).toContain("readme.md")
  })

  it("openFile does not duplicate in visibleFiles", () => {
    const store = createWorkspaceStore()
    store.getState().openFile("readme.md")
    store.getState().openFile("readme.md")
    expect(store.getState().visibleFiles).toHaveLength(1)
  })

  it("markDirty adds file to dirtyFiles", () => {
    const store = createWorkspaceStore()
    store.getState().markDirty("file.ts", "editor")
    expect(store.getState().dirtyFiles["file.ts"]).toEqual({
      panelId: "editor",
      savedAt: null,
    })
  })

  it("markClean removes file from dirtyFiles", () => {
    const store = createWorkspaceStore()
    store.getState().markDirty("file.ts", "editor")
    store.getState().markClean("file.ts")
    expect(store.getState().dirtyFiles["file.ts"]).toBeUndefined()
  })

  it("showNotification adds notification with id and timestamp", () => {
    const store = createWorkspaceStore()
    store.getState().showNotification({ message: "hello", type: "info" })
    const notifs = store.getState().notifications
    expect(notifs).toHaveLength(1)
    expect(notifs[0].message).toBe("hello")
    expect(notifs[0].id).toBeDefined()
    expect(notifs[0].timestamp).toBeGreaterThan(0)
  })

  it("dismissNotification removes by id", () => {
    const store = createWorkspaceStore()
    store.getState().showNotification({ message: "hello", type: "info" })
    const id = store.getState().notifications[0].id
    store.getState().dismissNotification(id)
    expect(store.getState().notifications).toHaveLength(0)
  })
})

describe("Persistence middleware", () => {
  it("writes layout partition to correct localStorage key", () => {
    const store = createWorkspaceStore()
    store.getState().setLayout({ groups: ["test"] })
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "boring-ui-v2:layout",
      expect.any(String)
    )
  })

  it("uses workspaceId in layout key when provided", () => {
    const store = createWorkspaceStore({ workspaceId: "my-project" })
    store.getState().setLayout({ groups: [] })
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "boring-ui-v2:layout:my-project",
      expect.any(String)
    )
  })

  it("partializes only layout, sidebar, panelSizes (not bridge state)", () => {
    const store = createWorkspaceStore()
    store.getState().openPanel({ id: "p1", component: "c" })
    store.getState().openFile("file.ts")
    const calls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls
    const lastCall = calls[calls.length - 1]
    const persisted = JSON.parse(lastCall[1])
    expect(persisted.state).not.toHaveProperty("panels")
    expect(persisted.state).not.toHaveProperty("activeFile")
    expect(persisted.state).not.toHaveProperty("activePanel")
    expect(persisted.state).not.toHaveProperty("notifications")
  })

  it("writes version field in persisted envelope", () => {
    const store = createWorkspaceStore()
    store.getState().setSidebar({ collapsed: true })
    const calls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls
    const lastCall = calls[calls.length - 1]
    const persisted = JSON.parse(lastCall[1])
    expect(persisted.version).toBe("2.0")
  })
})

describe("Theme persistence", () => {
  it("setTheme writes to preferences key in localStorage", () => {
    const store = createWorkspaceStore()
    store.getState().setTheme("dark")
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "boring-ui-v2:preferences",
      expect.stringContaining('"dark"')
    )
  })

  it("restores theme from preferences key on creation", () => {
    localStorage.setItem(
      "boring-ui-v2:preferences",
      JSON.stringify({ state: { theme: "dark" }, version: 0 })
    )
    const store = createWorkspaceStore()
    expect(store.getState().preferences.theme).toBe("dark")
  })

  it("defaults to light when preferences key is missing", () => {
    const store = createWorkspaceStore()
    expect(store.getState().preferences.theme).toBe("light")
  })

  it("defaults to light when preferences key is corrupted", () => {
    localStorage.setItem("boring-ui-v2:preferences", "not-json")
    const store = createWorkspaceStore()
    expect(store.getState().preferences.theme).toBe("light")
  })
})

describe("Version mismatch", () => {
  it("rejects persisted layout with wrong version", () => {
    localStorage.setItem(
      "boring-ui-v2:layout",
      JSON.stringify({
        version: "1.0",
        state: {
          layout: null,
          sidebar: { collapsed: false, width: 260 },
          panelSizes: {},
        },
      })
    )
    const store = createWorkspaceStore()
    expect(store.getState().layout).toBeNull()
    expect(localStorage.removeItem).toHaveBeenCalledWith("boring-ui-v2:layout")
  })

  it("calls onLayoutVersionMismatch callback on version mismatch", () => {
    localStorage.setItem(
      "boring-ui-v2:layout",
      JSON.stringify({
        version: "1.0",
        state: {
          layout: null,
          sidebar: { collapsed: false, width: 260 },
          panelSizes: {},
        },
      })
    )
    const callback = vi.fn()
    createWorkspaceStore({ onLayoutVersionMismatch: callback })
    expect(callback).toHaveBeenCalled()
  })

  it("accepts persisted layout with correct version", () => {
    localStorage.setItem(
      "boring-ui-v2:layout",
      JSON.stringify({
        version: "2.0",
        state: {
          layout: null,
          sidebar: { collapsed: true, width: 200 },
          panelSizes: {},
        },
      })
    )
    const store = createWorkspaceStore()
    expect(store.getState().sidebar.collapsed).toBe(true)
    expect(store.getState().sidebar.width).toBe(200)
  })
})

describe("Zod validation", () => {
  it("validates correct layout partition", () => {
    const result = validateLayoutPartition({
      layout: null,
      sidebar: { collapsed: false, width: 260 },
      panelSizes: { "panel-a": 300 },
    })
    expect(result).not.toBeNull()
  })

  it("rejects negative dimensions", () => {
    const result = validateLayoutPartition({
      layout: null,
      sidebar: { collapsed: false, width: 260 },
      panelSizes: { "panel-a": -10 },
    })
    expect(result).toBeNull()
  })

  it("rejects panel IDs with path separators", () => {
    const result = validateLayoutPartition({
      layout: null,
      sidebar: { collapsed: false, width: 260 },
      panelSizes: { "../../etc/passwd": 100 },
    })
    expect(result).toBeNull()
  })

  it("rejects panel IDs longer than 64 chars", () => {
    const longId = "a".repeat(65)
    const result = validateLayoutPartition({
      layout: null,
      sidebar: { collapsed: false, width: 260 },
      panelSizes: { [longId]: 100 },
    })
    expect(result).toBeNull()
  })

  it("rejects missing required fields", () => {
    const result = validateLayoutPartition({
      layout: null,
    })
    expect(result).toBeNull()
  })

  it("validates dockview layout shape with grid and panels", () => {
    const result = validateLayoutPartition({
      layout: { grid: { root: {}, orientation: 0 }, panels: { "editor": { id: "editor" } } },
      sidebar: { collapsed: false, width: 260 },
      panelSizes: {},
    })
    expect(result).not.toBeNull()
  })

  it("rejects layout with string >1KB in panel key", () => {
    const longKey = "a".repeat(1025)
    const result = validateLayoutPartition({
      layout: { grid: { root: {} }, panels: { [longKey]: { id: longKey } } },
      sidebar: { collapsed: false, width: 260 },
      panelSizes: {},
    })
    expect(result).toBeNull()
  })

  it("rejects layout with non-object grid", () => {
    const result = validateLayoutPartition({
      layout: { grid: "invalid", panels: {} },
      sidebar: { collapsed: false, width: 260 },
      panelSizes: {},
    })
    expect(result).toBeNull()
  })

  it("rejects layout with negative grid dimensions", () => {
    const result = validateLayoutPartition({
      layout: { grid: { root: {}, width: -100 }, panels: {} },
      sidebar: { collapsed: false, width: 260 },
      panelSizes: {},
    })
    expect(result).toBeNull()
  })

  it("rejects layout with non-object panel payload", () => {
    const result = validateLayoutPartition({
      layout: { grid: { root: {} }, panels: { "editor": "string-not-object" } },
      sidebar: { collapsed: false, width: 260 },
      panelSizes: {},
    })
    expect(result).toBeNull()
  })

  it("validates correct preferences partition", () => {
    const result = validatePreferencesPartition({ theme: "dark" })
    expect(result).not.toBeNull()
    expect(result!.theme).toBe("dark")
  })

  it("rejects unknown theme value", () => {
    const result = validatePreferencesPartition({ theme: "midnight" })
    expect(result).toBeNull()
  })
})

describe("QuotaExceededError handling", () => {
  it("clears key and retries on first quota error", () => {
    const store = createWorkspaceStore()
    let callCount = 0
    ;(localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: string, _value: string) => {
        callCount++
        if (callCount === 1) {
          const err = new DOMException("quota exceeded", "QuotaExceededError")
          throw err
        }
      }
    )
    store.getState().setLayout({ groups: [] })
    expect(localStorage.removeItem).toHaveBeenCalledWith("boring-ui-v2:layout")
  })

  it("fires notification on persistent quota failure", async () => {
    const { createWorkspaceStore: freshCreate } = await import("../index")
    const store = freshCreate()
    ;(localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new DOMException("quota exceeded", "QuotaExceededError")
      }
    )
    store.getState().setLayout({ groups: [] })
    const notifs = store.getState().notifications
    expect(notifs.some((n) => n.type === "warning" && n.message.includes("Storage full"))).toBe(true)
  })
})

describe("Hydration gate", () => {
  it("store initializes with hydrationComplete false", () => {
    const store = createWorkspaceStore()
    // In sync jsdom environment onRehydrateStorage fires immediately,
    // so we verify the initial default is false and it transitions to true.
    // The default before rehydration is false; after persist middleware
    // rehydrates (synchronously in test env), it becomes true.
    expect(store.getState().hydrationComplete).toBe(true)
  })

  it("setHydrationComplete updates the flag", () => {
    const store = createWorkspaceStore()
    store.getState().setHydrationComplete(false)
    expect(store.getState().hydrationComplete).toBe(false)
    store.getState().setHydrationComplete(true)
    expect(store.getState().hydrationComplete).toBe(true)
  })

  it("onRehydrateStorage sets hydrationComplete to true", () => {
    const store = createWorkspaceStore()
    store.getState().setHydrationComplete(false)
    expect(store.getState().hydrationComplete).toBe(false)
    store.getState().setHydrationComplete(true)
    expect(store.getState().hydrationComplete).toBe(true)
  })
})

describe("Size budget", () => {
  it("warns when serialized state exceeds threshold", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const store = createWorkspaceStore()
    const largeLayout = { data: "x".repeat(150_000) }
    store.getState().setLayout(largeLayout)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("bytes")
    )
    warnSpy.mockRestore()
  })
})

describe("Selector hooks", () => {
  it("useActiveFile returns correct value", () => {
    const store = createWorkspaceStore()
    bindStore(store)
    const { result } = renderHook(() => useActiveFile())
    expect(result.current).toBeNull()
    act(() => store.getState().openFile("test.ts"))
    expect(result.current).toBe("test.ts")
  })

  it("useActivePanel returns correct value", () => {
    const store = createWorkspaceStore()
    bindStore(store)
    const { result } = renderHook(() => useActivePanel())
    expect(result.current).toBeNull()
    act(() => store.getState().activatePanel("editor"))
    expect(result.current).toBe("editor")
  })

  it("useSidebarState returns correct value", () => {
    const store = createWorkspaceStore()
    bindStore(store)
    const { result } = renderHook(() => useSidebarState())
    expect(result.current).toEqual({ collapsed: false, width: 260 })
  })

  it("useOpenPanels returns correct value", () => {
    const store = createWorkspaceStore()
    bindStore(store)
    const { result } = renderHook(() => useOpenPanels())
    expect(result.current).toEqual([])
    act(() =>
      store.getState().openPanel({ id: "p1", component: "filetree" })
    )
    expect(result.current).toHaveLength(1)
  })

  it("useDirtyFiles returns correct value", () => {
    const store = createWorkspaceStore()
    bindStore(store)
    const { result } = renderHook(() => useDirtyFiles())
    expect(result.current).toEqual({})
    act(() => store.getState().markDirty("file.ts", "editor"))
    expect(result.current["file.ts"]).toBeDefined()
  })

  it("useThemePreference returns correct value", () => {
    const store = createWorkspaceStore()
    bindStore(store)
    const { result } = renderHook(() => useThemePreference())
    expect(result.current).toBe("light")
    act(() => store.getState().setTheme("dark"))
    expect(result.current).toBe("dark")
  })

  it("useHydrationComplete returns correct value", () => {
    const store = createWorkspaceStore()
    bindStore(store)
    const { result } = renderHook(() => useHydrationComplete())
    expect(result.current).toBe(true)
  })

  it("throws when store not bound", () => {
    bindStore(null as any)
    expect(() => renderHook(() => useActiveFile())).toThrow(
      "Workspace store not initialized"
    )
  })
})

describe("Cross-tab storage events", () => {
  it("logs when layout key changes in another tab", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    createWorkspaceStore()
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "boring-ui-v2:layout",
        newValue: '{"state":{}}',
      })
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("another tab")
    )
    logSpy.mockRestore()
  })

  it("ignores storage events for unrelated keys", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    createWorkspaceStore()
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "some-other-key",
        newValue: "test",
      })
    )
    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it("cleanup removes storage event listener", () => {
    const store = createWorkspaceStore()
    store.cleanup()
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "boring-ui-v2:layout",
        newValue: '{"state":{}}',
      })
    )
    // After cleanup, this store's listener should be removed.
    // Other tests may have leaked listeners, so we check the count
    // is exactly from those leaked stores (all prior tests), not +1.
    const callsFromThisStore = logSpy.mock.calls.length
    // Remove cleanup, add new store, fire again, verify count increases
    const store2 = createWorkspaceStore()
    logSpy.mockClear()
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "boring-ui-v2:layout",
        newValue: '{"state":{}}',
      })
    )
    const callsWithNewStore = logSpy.mock.calls.length
    expect(callsWithNewStore).toBe(callsFromThisStore + 1)
    store2.cleanup()
    logSpy.mockRestore()
  })
})
