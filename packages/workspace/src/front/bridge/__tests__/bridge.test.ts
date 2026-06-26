import { describe, it, expect, vi, beforeEach } from "vitest"
import { createBridge } from "../createBridge"
import type { WorkspaceStore } from "../../store/types"

function createMockStore() {
  const state: WorkspaceStore = {
    hydrationComplete: true,
    layout: null,
    sidebar: { collapsed: false, width: 250 },
    panelSizes: {},
    preferences: { theme: "light" },
    panels: [],
    activePanel: null,
    activeFile: null,
    visibleFiles: [],
    dirtyFiles: {},
    notifications: [],
    setHydrationComplete: vi.fn(),
    setLayout: vi.fn(),
    setSidebar: vi.fn(),
    setPanelSize: vi.fn(),
    setTheme: vi.fn(),
    openPanel: vi.fn((p) => { state.panels.push(p) }),
    closePanel: vi.fn((id) => { state.panels = state.panels.filter((p) => p.id !== id) }),
    activatePanel: vi.fn((id) => { state.activePanel = id }),
    updatePanelParams: vi.fn(),
    openFile: vi.fn((file) => { state.activeFile = file }),
    markDirty: vi.fn((f, pid) => { state.dirtyFiles[f] = { panelId: pid, savedAt: null } }),
    markClean: vi.fn((f) => { delete state.dirtyFiles[f] }),
    showNotification: vi.fn(),
    dismissNotification: vi.fn(),
    navigateToLine: vi.fn(),
    resetLayout: vi.fn(),
  }

  const subscribers = new Set<(s: WorkspaceStore, prev: WorkspaceStore) => void>()

  return {
    getState: () => state,
    subscribe: (fn: (s: WorkspaceStore, prev: WorkspaceStore) => void) => {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    setState: () => {},
    getInitialState: () => state,
    notify: () => {
      for (const fn of subscribers) fn(state, state)
    },
    state,
  }
}

describe("createBridge", () => {
  let store: ReturnType<typeof createMockStore>

  beforeEach(() => {
    store = createMockStore()
  })

  describe("read operations", () => {
    it("getOpenPanels returns panels from store", () => {
      const bridge = createBridge(store)
      expect(bridge.getOpenPanels()).toEqual([])
    })

    it("getActiveFile returns null initially", () => {
      const bridge = createBridge(store)
      expect(bridge.getActiveFile()).toBeNull()
    })

    it("getDirtyFiles returns empty array initially", () => {
      const bridge = createBridge(store)
      expect(bridge.getDirtyFiles()).toEqual([])
    })
  })

  describe("openFile", () => {
    it("opens a file panel and returns ok", async () => {
      const bridge = createBridge(store)
      const result = await bridge.openFile("/a.ts")
      expect(result.status).toBe("ok")
      expect(store.state.openFile).toHaveBeenCalledWith("/a.ts", "file:/a.ts")
    })

    it("rejects path traversal", async () => {
      const bridge = createBridge(store)
      const result = await bridge.openFile("../etc/passwd")
      expect(result.status).toBe("error")
      expect(result.error?.code).toBe("VALIDATION")
    })

    it("rejects paths over 1024 chars", async () => {
      const bridge = createBridge(store)
      const result = await bridge.openFile("a".repeat(1025))
      expect(result.status).toBe("error")
    })

    it("activates existing panel for same file", async () => {
      const bridge = createBridge(store)
      await bridge.openFile("/a.ts")
      const result = await bridge.openFile("/a.ts")
      expect(result.status).toBe("ok")
      expect(store.state.activatePanel).toHaveBeenCalledWith("file:/a.ts")
    })

    it("rejects when at max panels", async () => {
      store.state.panels = Array.from({ length: 50 }, (_, i) => ({
        id: `p-${i}`,
        component: "editor",
      }))
      const bridge = createBridge(store)
      const result = await bridge.openFile("/new.ts")
      expect(result.status).toBe("error")
      expect(result.error?.code).toBe("MAX_PANELS")
    })

    it("activates existing panel even at max capacity", async () => {
      store.state.panels = Array.from({ length: 50 }, (_, i) => ({
        id: i === 0 ? "file:/a.ts" : `p-${i}`,
        component: "editor",
      }))
      const bridge = createBridge(store)
      const result = await bridge.openFile("/a.ts")
      expect(result.status).toBe("ok")
      expect(store.state.activatePanel).toHaveBeenCalledWith("file:/a.ts")
    })

    it("fires file:opened event", async () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.subscribe("file:opened", handler)
      await bridge.openFile("/a.ts")
      expect(handler).toHaveBeenCalledWith({ path: "/a.ts", mode: "edit" })
    })
  })

  describe("openPanel", () => {
    it("opens panel and returns ok", async () => {
      const bridge = createBridge(store)
      const result = await bridge.openPanel({ id: "chat", component: "ChatPanel" })
      expect(result.status).toBe("ok")
      expect(store.state.openPanel).toHaveBeenCalled()
    })

    it("activates existing panel with same id", async () => {
      const bridge = createBridge(store)
      await bridge.openPanel({ id: "chat", component: "ChatPanel" })
      await bridge.openPanel({ id: "chat", component: "ChatPanel" })
      expect(store.state.activatePanel).toHaveBeenCalledWith("chat")
    })

    it("rejects invalid panel ID", async () => {
      const bridge = createBridge(store)
      const result = await bridge.openPanel({ id: "bad id!", component: "x" })
      expect(result.status).toBe("error")
    })

    it("rejects params over 16KB", async () => {
      const bridge = createBridge(store)
      const result = await bridge.openPanel({
        id: "big",
        component: "x",
        params: { data: "x".repeat(16_384) },
      })
      expect(result.status).toBe("error")
    })
  })

  describe("closePanel", () => {
    it("closes panel and returns ok", async () => {
      const bridge = createBridge(store)
      await bridge.openPanel({ id: "chat", component: "ChatPanel" })
      const result = await bridge.closePanel("chat")
      expect(result.status).toBe("ok")
    })

    it("returns error for non-existent panel", async () => {
      const bridge = createBridge(store)
      const result = await bridge.closePanel("nope")
      expect(result.status).toBe("error")
      expect(result.error?.code).toBe("NOT_FOUND")
    })

    it("fires panel:closed event", async () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.subscribe("panel:closed", handler)
      await bridge.openPanel({ id: "chat", component: "ChatPanel" })
      await bridge.closePanel("chat")
      expect(handler).toHaveBeenCalledWith({ panelId: "chat" })
    })

    it("rejects closing essential panel", async () => {
      store.state.panels.push({ id: "filetree", component: "FileTree", essential: true })
      const bridge = createBridge(store)
      const result = await bridge.closePanel("filetree")
      expect(result.status).toBe("error")
      expect(result.error?.code).toBe("ESSENTIAL")
    })
  })

  describe("showNotification", () => {
    it("shows notification and fires event", async () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.subscribe("notification:shown", handler)
      const result = await bridge.showNotification("Hello", "info")
      expect(result.status).toBe("ok")
      expect(handler).toHaveBeenCalledWith({ message: "Hello", level: "info" })
    })

    it("truncates long messages", async () => {
      const bridge = createBridge(store)
      const result = await bridge.showNotification("x".repeat(501))
      expect(result.status).toBe("error")
    })
  })

  describe("closeWorkbenchLeftPane", () => {
    it("collapses the sidebar and fires sidebar:toggled", async () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.subscribe("sidebar:toggled", handler)

      const result = await bridge.closeWorkbenchLeftPane()

      expect(result.status).toBe("ok")
      expect(store.state.setSidebar).toHaveBeenCalledWith({ collapsed: true })
      expect(handler).toHaveBeenCalledWith({ collapsed: true })
    })
  })

  describe("navigateToLine", () => {
    it("opens file then navigates to line", async () => {
      const bridge = createBridge(store)
      const result = await bridge.navigateToLine("/a.ts", 42)
      expect(result.status).toBe("ok")
      expect(store.state.navigateToLine).toHaveBeenCalledWith("/a.ts", 42)
    })

    it("rejects non-positive line", async () => {
      const bridge = createBridge(store)
      const result = await bridge.navigateToLine("/a.ts", -1)
      expect(result.status).toBe("error")
    })
  })

  describe("expandToFile", () => {
    it("emits tree:expand event", async () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.subscribe("tree:expand", handler)
      const result = await bridge.expandToFile("/src/foo.ts")
      expect(result.status).toBe("ok")
      expect(handler).toHaveBeenCalledWith({ path: "/src/foo.ts" })
    })

    it("uncollapses sidebar when collapsed", async () => {
      store.state.sidebar.collapsed = true
      const bridge = createBridge(store)
      await bridge.expandToFile("/src/foo.ts")
      expect(store.state.setSidebar).toHaveBeenCalledWith({ collapsed: false })
    })

    it("rejects path traversal", async () => {
      const bridge = createBridge(store)
      const result = await bridge.expandToFile("../../etc/passwd")
      expect(result.status).toBe("error")
    })
  })

  describe("markDirty / markClean", () => {
    it("markDirty updates store and fires event", () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.subscribe("file:dirty", handler)
      bridge.markDirty("/a.ts")
      expect(store.state.markDirty).toHaveBeenCalledWith("/a.ts", "bridge")
      expect(handler).toHaveBeenCalledWith({ path: "/a.ts", dirty: true })
    })

    it("markClean updates store and fires event", () => {
      const bridge = createBridge(store)
      bridge.markDirty("/a.ts")
      const handler = vi.fn()
      bridge.subscribe("file:dirty", handler)
      bridge.markClean("/a.ts")
      expect(store.state.markClean).toHaveBeenCalledWith("/a.ts")
      expect(handler).toHaveBeenCalledWith({ path: "/a.ts", dirty: false })
    })

    it("getDirtyFiles returns dirty file list", () => {
      const bridge = createBridge(store)
      bridge.markDirty("/a.ts")
      bridge.markDirty("/b.ts")
      expect(bridge.getDirtyFiles()).toEqual(["/a.ts", "/b.ts"])
    })
  })

  describe("subscribe", () => {
    it("returns unsubscribe function", async () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      const unsub = bridge.subscribe("panel:opened", handler)
      await bridge.openPanel({ id: "a", component: "x" })
      expect(handler).toHaveBeenCalledOnce()
      unsub()
      await bridge.openPanel({ id: "b", component: "x" })
      expect(handler).toHaveBeenCalledOnce()
    })
  })

  describe("select", () => {
    it("fires when selected slice changes", () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.select((s) => s.activeFile, handler)
      store.state.activeFile = "/new.ts"
      store.notify()
      expect(handler).toHaveBeenCalledWith("/new.ts")
    })

    it("does not fire when unrelated state changes", () => {
      const bridge = createBridge(store)
      const handler = vi.fn()
      bridge.select((s) => s.activeFile, handler)
      store.state.sidebar.collapsed = true
      store.notify()
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe("command sequencing", () => {
    it("each result has incrementing seq number", async () => {
      const bridge = createBridge(store)
      const r1 = await bridge.openFile("/a.ts")
      const r2 = await bridge.openFile("/b.ts")
      expect(r2.seq).toBeGreaterThan(r1.seq)
    })
  })
})
