import { useStore } from "zustand"
import type { WorkspaceStore } from "./types"

type WorkspaceStoreApi = {
  getState: () => WorkspaceStore
  subscribe: (listener: (state: WorkspaceStore, prevState: WorkspaceStore) => void) => () => void
  setState: (partial: Partial<WorkspaceStore>) => void
  getInitialState: () => WorkspaceStore
}

let storeRef: WorkspaceStoreApi | null = null

export function bindStore(store: WorkspaceStoreApi): void {
  storeRef = store
}

function getStore(): WorkspaceStoreApi {
  if (!storeRef) {
    throw new Error(
      "Workspace store not initialized. Wrap your app in WorkspaceProvider."
    )
  }
  return storeRef
}

export function useActiveFile(): string | null {
  return useStore(getStore(), (s) => s.activeFile)
}

export function useActivePanel(): string | null {
  return useStore(getStore(), (s) => s.activePanel)
}

export function useSidebarState() {
  return useStore(getStore(), (s) => s.sidebar)
}

export function useOpenPanels() {
  return useStore(getStore(), (s) => s.panels)
}

export function useDirtyFiles() {
  return useStore(getStore(), (s) => s.dirtyFiles)
}

export function useThemePreference() {
  return useStore(getStore(), (s) => s.preferences.theme)
}

export function useHydrationComplete() {
  return useStore(getStore(), (s) => s.hydrationComplete)
}
