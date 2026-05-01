import type { BridgeEventMap, CommandResult, WorkspaceBridge } from "../bridge/types"
import type { WorkspaceState, PanelState } from "../store/types"

type SpyFactory = <T extends (...args: any[]) => any>(implementation?: T) => any

export interface MockBridgeState {
  openPanels: PanelState[]
  activeFile: string | null
  dirtyFiles: string[]
  visibleFiles: string[]
}

export interface CreateMockBridgeOptions {
  state?: Partial<MockBridgeState>
  fn?: SpyFactory
}

type SelectorEntry<T = unknown> = {
  selector: (state: WorkspaceState) => T
  handler: (value: T) => void
  lastValue: T
}

export type MockWorkspaceBridge = WorkspaceBridge & {
  emit<K extends keyof BridgeEventMap>(event: K, payload: BridgeEventMap[K]): void
  setState(next: Partial<MockBridgeState>): void
  getStateSnapshot(): MockBridgeState
}

const OK: Omit<CommandResult, "seq"> = { status: "ok" }

function getSpyFactory(fn?: SpyFactory): SpyFactory {
  if (fn) return fn
  const viLike = (globalThis as { vi?: { fn: SpyFactory } }).vi
  if (viLike?.fn) return viLike.fn.bind(viLike)
  throw new Error(
    "createMockBridge requires a mock factory. Pass { fn: vi.fn } or run under Vitest globals.",
  )
}

function cloneState(state: MockBridgeState): MockBridgeState {
  return {
    openPanels: [...state.openPanels],
    activeFile: state.activeFile,
    dirtyFiles: [...state.dirtyFiles],
    visibleFiles: [...state.visibleFiles],
  }
}

function toWorkspaceState(state: MockBridgeState): WorkspaceState {
  const dirtyEntries = Object.fromEntries(
    state.dirtyFiles.map((path) => [path, { panelId: "bridge", savedAt: null }]),
  )
  return {
    hydrationComplete: true,
    layout: null,
    sidebar: { collapsed: false, width: 260 },
    panelSizes: {},
    preferences: { theme: "dark" },
    panels: state.openPanels,
    activePanel: state.openPanels[0]?.id ?? null,
    activeFile: state.activeFile,
    visibleFiles: state.visibleFiles,
    dirtyFiles: dirtyEntries,
    notifications: [],
  }
}

export function createMockBridge(options: CreateMockBridgeOptions = {}): MockWorkspaceBridge {
  const spy = getSpyFactory(options.fn)
  let seq = 0

  const state: MockBridgeState = {
    openPanels: options.state?.openPanels ? [...options.state.openPanels] : [],
    activeFile: options.state?.activeFile ?? null,
    dirtyFiles: options.state?.dirtyFiles ? [...options.state.dirtyFiles] : [],
    visibleFiles: options.state?.visibleFiles ? [...options.state.visibleFiles] : [],
  }

  const listeners = new Map<keyof BridgeEventMap, Set<(payload: any) => void>>()
  const selectors = new Set<SelectorEntry<any>>()

  function nextResult(): CommandResult {
    seq += 1
    return { seq, ...OK }
  }

  function emit<K extends keyof BridgeEventMap>(event: K, payload: BridgeEventMap[K]): void {
    const handlers = listeners.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      handler(payload)
    }
  }

  function notifySelectors(): void {
    const snapshot = toWorkspaceState(state)
    for (const entry of selectors) {
      const next = entry.selector(snapshot)
      if (!Object.is(next, entry.lastValue)) {
        entry.lastValue = next
        entry.handler(next)
      }
    }
  }

  function mergeState(next: Partial<MockBridgeState>): void {
    if (next.openPanels) state.openPanels = [...next.openPanels]
    if (next.activeFile !== undefined) state.activeFile = next.activeFile
    if (next.dirtyFiles) state.dirtyFiles = [...next.dirtyFiles]
    if (next.visibleFiles) state.visibleFiles = [...next.visibleFiles]
    notifySelectors()
  }

  const bridge: MockWorkspaceBridge = {
    getOpenPanels: spy(() => [...state.openPanels]),
    getActiveFile: spy(() => state.activeFile),
    getDirtyFiles: spy(() => [...state.dirtyFiles]),
    getVisibleFiles: spy(() => [...state.visibleFiles]),

    openFile: spy(async (path, opts) => {
      if (!state.visibleFiles.includes(path)) state.visibleFiles.push(path)
      state.activeFile = path
      const panelId = `file:${path}`
      const mode = opts?.mode ?? "edit"
      if (!state.openPanels.some((panel) => panel.id === panelId)) {
        state.openPanels.push({ id: panelId, component: "editor", params: { path, mode } })
      }
      notifySelectors()
      emit("file:opened", { path, mode })
      return nextResult()
    }),

    openPanel: spy(async (config) => {
      const existing = state.openPanels.some((panel) => panel.id === config.id)
      if (!existing) {
        state.openPanels.push({
          id: config.id,
          component: config.component,
          params: config.params,
        })
      }
      notifySelectors()
      emit("panel:opened", { panelId: config.id, params: config.params ?? {} })
      return nextResult()
    }),

    closePanel: spy(async (id) => {
      state.openPanels = state.openPanels.filter((panel) => panel.id !== id)
      notifySelectors()
      emit("panel:closed", { panelId: id })
      return nextResult()
    }),

    closeWorkbenchLeftPane: spy(async () => {
      emit("sidebar:toggled", { collapsed: true })
      return nextResult()
    }),

    showNotification: spy(async (message, level = "info") => {
      emit("notification:shown", { message, level })
      return nextResult()
    }),

    navigateToLine: spy(async (file, _line) => {
      state.activeFile = file
      if (!state.visibleFiles.includes(file)) state.visibleFiles.push(file)
      notifySelectors()
      return nextResult()
    }),

    expandToFile: spy(async (path) => {
      emit("tree:expand", { path })
      return nextResult()
    }),

    markDirty: spy((path) => {
      if (!state.dirtyFiles.includes(path)) state.dirtyFiles.push(path)
      notifySelectors()
      emit("file:dirty", { path, dirty: true })
    }),

    markClean: spy((path) => {
      state.dirtyFiles = state.dirtyFiles.filter((candidate) => candidate !== path)
      notifySelectors()
      emit("file:dirty", { path, dirty: false })
    }),

    subscribe: spy(<K extends keyof BridgeEventMap>(
      event: K,
      handler: (payload: BridgeEventMap[K]) => void,
    ) => {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(handler as (payload: unknown) => void)
      return () => {
        set?.delete(handler as (payload: unknown) => void)
      }
    }),

    select: spy(<T>(
      selector: (workspaceState: WorkspaceState) => T,
      handler: (value: T) => void,
    ) => {
      const entry: SelectorEntry<T> = {
        selector,
        handler,
        lastValue: selector(toWorkspaceState(state)),
      }
      selectors.add(entry)
      return () => {
        selectors.delete(entry)
      }
    }),

    emit,

    setState(next) {
      mergeState(next)
    },

    getStateSnapshot() {
      return cloneState(state)
    },
  }

  return bridge
}
