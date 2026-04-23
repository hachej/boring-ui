import type { WorkspaceStore } from "../store/types"
import type {
  WorkspaceBridge,
  BridgeEventMap,
  CommandResult,
  DynamicPaneConfig,
  Unsubscribe,
} from "./types"
import {
  openFileSchema,
  openPanelSchema,
  closePanelSchema,
  notificationSchema,
  navigateToLineSchema,
  expandToFileSchema,
  MAX_PANELS,
} from "./validation"

type StoreApi = {
  getState: () => WorkspaceStore
  subscribe: (listener: (state: WorkspaceStore, prev: WorkspaceStore) => void) => () => void
}

type EventHandler = (data: unknown) => void

export function createBridge(store: StoreApi): WorkspaceBridge {
  let seq = 0
  const listeners = new Map<string, Set<EventHandler>>()

  function nextSeq(): number {
    return ++seq
  }

  function ok(): CommandResult {
    return { seq: nextSeq(), status: "ok" }
  }

  function err(code: string, message: string): CommandResult {
    return { seq: nextSeq(), status: "error", error: { code, message } }
  }

  function emit<K extends keyof BridgeEventMap>(event: K, data: BridgeEventMap[K]) {
    const handlers = listeners.get(event)
    if (handlers) {
      for (const h of handlers) h(data)
    }
  }

  const bridge: WorkspaceBridge = {
    getOpenPanels() {
      return store.getState().panels
    },

    getActiveFile() {
      return store.getState().activeFile
    },

    getDirtyFiles() {
      return Object.keys(store.getState().dirtyFiles)
    },

    getVisibleFiles() {
      return store.getState().visibleFiles
    },

    async openFile(path, opts) {
      const parsed = openFileSchema.safeParse({ path, mode: opts?.mode })
      if (!parsed.success) return err("VALIDATION", parsed.error.issues[0].message)

      const state = store.getState()
      const mode = parsed.data.mode ?? "edit"
      const panelId = `file:${path}`
      const existing = state.panels.find((p) => p.id === panelId)
      if (existing) {
        const prev = state.activePanel
        state.activatePanel(panelId)
        emit("panel:activated", { panelId, previousPanelId: prev })
        return ok()
      }

      if (state.panels.length >= MAX_PANELS) {
        return err("MAX_PANELS", `cannot exceed ${MAX_PANELS} open panels`)
      }

      state.openFile(path, panelId)
      state.openPanel({ id: panelId, component: "editor", params: { path, mode } })
      emit("file:opened", { path, mode })
      emit("panel:opened", { panelId, params: { path, mode } })
      return ok()
    },

    async openPanel(config) {
      const parsed = openPanelSchema.safeParse(config)
      if (!parsed.success) return err("VALIDATION", parsed.error.issues[0].message)

      const state = store.getState()
      const existing = state.panels.find((p) => p.id === config.id)
      if (existing) {
        const prev = state.activePanel
        state.activatePanel(config.id)
        emit("panel:activated", { panelId: config.id, previousPanelId: prev })
        return ok()
      }

      if (state.panels.length >= MAX_PANELS) {
        return err("MAX_PANELS", `cannot exceed ${MAX_PANELS} open panels`)
      }

      state.openPanel({
        id: config.id,
        component: config.component,
        params: config.params,
      })
      emit("panel:opened", { panelId: config.id, params: config.params ?? {} })
      return ok()
    },

    async closePanel(id) {
      const parsed = closePanelSchema.safeParse({ id })
      if (!parsed.success) return err("VALIDATION", parsed.error.issues[0].message)

      const state = store.getState()
      const panel = state.panels.find((p) => p.id === id)
      if (!panel) return err("NOT_FOUND", `panel ${id} not found`)
      if (panel.essential) return err("ESSENTIAL", `panel ${id} is essential and cannot be closed`)

      state.closePanel(id)
      emit("panel:closed", { panelId: id })
      return ok()
    },

    async showNotification(msg, level = "info") {
      const parsed = notificationSchema.safeParse({ msg, level })
      if (!parsed.success) return err("VALIDATION", parsed.error.issues[0].message)

      const storeLevel = level === "warn" ? "warning" : level
      store.getState().showNotification({ message: parsed.data.msg, type: storeLevel })
      emit("notification:shown", { message: parsed.data.msg, level })
      return ok()
    },

    async navigateToLine(file, line) {
      const parsed = navigateToLineSchema.safeParse({ file, line })
      if (!parsed.success) return err("VALIDATION", parsed.error.issues[0].message)

      const result = await bridge.openFile(file)
      if (result.status === "error") return result
      store.getState().navigateToLine(file, parsed.data.line)
      return ok()
    },

    async expandToFile(path) {
      const parsed = expandToFileSchema.safeParse({ path })
      if (!parsed.success) return err("VALIDATION", parsed.error.issues[0].message)

      const state = store.getState()
      if (state.sidebar.collapsed) {
        state.setSidebar({ collapsed: false })
        emit("sidebar:toggled", { collapsed: false })
      }
      emit("tree:expand", { path: parsed.data.path })
      return ok()
    },

    markDirty(path) {
      store.getState().markDirty(path, "bridge")
      emit("file:dirty", { path, dirty: true })
    },

    markClean(path) {
      store.getState().markClean(path)
      emit("file:dirty", { path, dirty: false })
    },

    subscribe<K extends keyof BridgeEventMap>(
      event: K,
      handler: (data: BridgeEventMap[K]) => void,
    ): Unsubscribe {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      const h = handler as EventHandler
      set.add(h)
      return () => set!.delete(h)
    },

    select<T>(
      selector: (state: WorkspaceStore) => T,
      handler: (value: T) => void,
    ): Unsubscribe {
      let prev = selector(store.getState())
      return store.subscribe((state) => {
        const next = selector(state)
        if (!Object.is(next, prev)) {
          prev = next
          handler(next)
        }
      })
    },
  }

  return bridge
}
