import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { WorkspaceStore } from "./types"
import {
  validateLayoutPartition,
  validatePreferencesPartition,
} from "./validation"

const SIZE_WARN_THRESHOLD = 100_000
const LAYOUT_VERSION = "2.0"

let persistenceDisabled = false
let onQuotaExhausted: (() => void) | null = null

function safeSetItem(key: string, value: string): void {
  if (persistenceDisabled) return
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    if (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.code === 22)
    ) {
      localStorage.removeItem(key)
      try {
        localStorage.setItem(key, value)
      } catch {
        persistenceDisabled = true
        console.error(
          "localStorage quota exceeded. Persistence disabled for this session."
        )
        onQuotaExhausted?.()
      }
    }
  }
}

function restorePreferences(key: string): { theme: "light" | "dark" } {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { theme: "light" }
    const parsed = JSON.parse(raw)
    const validated = validatePreferencesPartition(parsed?.state)
    if (!validated) return { theme: "light" }
    return { theme: validated.theme }
  } catch {
    return { theme: "light" }
  }
}

export interface CreateWorkspaceStoreOptions {
  workspaceId?: string
  onLayoutVersionMismatch?: () => void
}

export function createWorkspaceStore(options: CreateWorkspaceStoreOptions = {}) {
  const layoutKey = options.workspaceId
    ? `boring-ui-v2:layout:${options.workspaceId}`
    : "boring-ui-v2:layout"
  const preferencesKey = "boring-ui-v2:preferences"

  const restoredPreferences = restorePreferences(preferencesKey)

  const store = create<WorkspaceStore>()(
    persist(
      (set, get) => ({
        hydrationComplete: false,
        layout: null,
        sidebar: { collapsed: false, width: 260 },
        panelSizes: {},
        preferences: restoredPreferences,

        panels: [],
        activePanel: null,
        activeFile: null,
        visibleFiles: [],
        dirtyFiles: {},
        notifications: [],

        setHydrationComplete: (complete) =>
          set({ hydrationComplete: complete }),
        setLayout: (layout) => set({ layout }),
        setSidebar: (partial) =>
          set({ sidebar: { ...get().sidebar, ...partial } }),
        setPanelSize: (panelId, size) =>
          set({ panelSizes: { ...get().panelSizes, [panelId]: size } }),
        setTheme: (theme) => {
          set({ preferences: { theme } })
          safeSetItem(
            preferencesKey,
            JSON.stringify({ state: { theme }, version: 0 })
          )
        },

        openPanel: (panel) =>
          set((s) => {
            const exists = s.panels.some((p) => p.id === panel.id)
            return {
              panels: exists ? s.panels : [...s.panels, panel],
              activePanel: panel.id,
            }
          }),
        closePanel: (panelId) =>
          set((s) => ({
            panels: s.panels.filter((p) => p.id !== panelId),
            activePanel:
              s.activePanel === panelId ? null : s.activePanel,
          })),
        activatePanel: (panelId) => set({ activePanel: panelId }),
        openFile: (file, panelId) =>
          set((s) => ({
            activeFile: file,
            visibleFiles: s.visibleFiles.includes(file)
              ? s.visibleFiles
              : [...s.visibleFiles, file],
            activePanel: panelId ?? s.activePanel,
          })),
        markDirty: (file, panelId) =>
          set((s) => ({
            dirtyFiles: {
              ...s.dirtyFiles,
              [file]: { panelId, savedAt: null },
            },
          })),
        markClean: (file) =>
          set((s) => {
            const { [file]: _, ...rest } = s.dirtyFiles
            return { dirtyFiles: rest }
          }),
        showNotification: (notification) =>
          set((s) => ({
            notifications: [
              ...s.notifications,
              {
                ...notification,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
              },
            ],
          })),
        dismissNotification: (id) =>
          set((s) => ({
            notifications: s.notifications.filter((n) => n.id !== id),
          })),
        navigateToLine: (file, _line) =>
          set({ activeFile: file }),
      }),
      {
        name: layoutKey,
        partialize: (state) => ({
          layout: state.layout,
          sidebar: state.sidebar,
          panelSizes: state.panelSizes,
        }),
        onRehydrateStorage: () => (state) => {
          state?.setHydrationComplete(true)
        },
        storage: {
          getItem: (name) => {
            try {
              const raw = localStorage.getItem(name)
              if (!raw) return null
              const parsed = JSON.parse(raw)

              if (parsed?.version !== undefined) {
                const storedVersion = String(parsed.version)
                if (storedVersion !== LAYOUT_VERSION) {
                  if (options.onLayoutVersionMismatch) {
                    options.onLayoutVersionMismatch()
                  } else {
                    localStorage.removeItem(name)
                  }
                  return null
                }
              }

              const validated = validateLayoutPartition(parsed?.state)
              if (!validated) {
                console.error("Layout restored with defaults")
                return null
              }
              return { ...parsed, state: validated }
            } catch {
              console.error("Layout restored with defaults")
              return null
            }
          },
          setItem: (name, value) => {
            const envelope = { ...value, version: LAYOUT_VERSION }
            const serialized = JSON.stringify(envelope)
            if (serialized.length > SIZE_WARN_THRESHOLD) {
              console.warn(
                `Workspace state serialized to ${serialized.length} bytes (budget: <${SIZE_WARN_THRESHOLD})`
              )
            }
            safeSetItem(name, serialized)
          },
          removeItem: (name) => {
            localStorage.removeItem(name)
          },
        },
      }
    )
  )

  onQuotaExhausted = () => {
    store.getState().showNotification({
      message: "Storage full — layout changes won't be saved this session.",
      type: "warning",
    })
  }

  let storageHandler: ((e: StorageEvent) => void) | null = null
  if (typeof window !== "undefined") {
    storageHandler = (e: StorageEvent) => {
      if (e.key === layoutKey) {
        console.log("Layout key changed in another tab (not auto-applied)")
      }
    }
    window.addEventListener("storage", storageHandler)
  }

  const cleanup = () => {
    if (storageHandler) {
      window.removeEventListener("storage", storageHandler)
      storageHandler = null
    }
    onQuotaExhausted = null
  }

  return Object.assign(store, { cleanup })
}
