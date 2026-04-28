/**
 * Test ergonomics helper for the unified PaneProps shape.
 *
 * Production panes accept a `{ params, api, containerApi, className? }`
 * envelope (mirrors dockview's IDockviewPanelProps). In tests we don't
 * want every render call to instantiate stubs for both API surfaces, so
 * this helper builds a plausible default envelope. Override individual
 * fields when the test cares about them.
 *
 * ```tsx
 * render(<CodeEditorPane {...createMockPaneProps({ path: "src/main.ts" })} />)
 * ```
 */
import type { PaneProps } from "../registry/types"

const NOOP = () => {
  /* noop */
}

const NOOP_DISPOSABLE = { dispose: NOOP }

const NOOP_EVENT = { event: () => NOOP_DISPOSABLE }

function makeApi(id: string): unknown {
  return {
    id,
    title: id,
    isFocused: false,
    isActive: true,
    isVisible: true,
    width: 0,
    height: 0,
    location: { type: "grid", referenceGroup: undefined },
    setActive: NOOP,
    setTitle: NOOP,
    setSize: NOOP,
    close: NOOP,
    moveTo: NOOP,
    maximize: NOOP,
    exitMaximized: NOOP,
    isMaximized: () => false,
    minimize: NOOP,
    onDidActiveChange: NOOP_EVENT.event,
    onDidVisibilityChange: NOOP_EVENT.event,
    onDidDimensionsChange: NOOP_EVENT.event,
    onDidFocusChange: NOOP_EVENT.event,
    onDidLocationChange: NOOP_EVENT.event,
    onDidParametersChange: NOOP_EVENT.event,
    onDidTitleChange: NOOP_EVENT.event,
    onDidRenamed: NOOP_EVENT.event,
    onWillFocus: NOOP_EVENT.event,
  }
}

function makeContainerApi(): unknown {
  return {
    width: 0,
    height: 0,
    minimumHeight: 0,
    maximumHeight: Infinity,
    minimumWidth: 0,
    maximumWidth: Infinity,
    activePanel: undefined,
    panels: [],
    groups: [],
    activeGroup: undefined,
    addPanel: NOOP,
    addGroup: NOOP,
    removePanel: NOOP,
    removeGroup: NOOP,
    getPanel: NOOP,
    getGroup: NOOP,
    moveGroupOrPanel: NOOP,
    fromJSON: NOOP,
    toJSON: () => ({}),
    clear: NOOP,
    focus: NOOP,
    layout: NOOP,
    onDidLayoutChange: NOOP_EVENT.event,
    onDidLayoutFromJSON: NOOP_EVENT.event,
    onDidAddPanel: NOOP_EVENT.event,
    onDidRemovePanel: NOOP_EVENT.event,
    onDidActivePanelChange: NOOP_EVENT.event,
    onDidAddGroup: NOOP_EVENT.event,
    onDidRemoveGroup: NOOP_EVENT.event,
    onDidActiveGroupChange: NOOP_EVENT.event,
    onUnhandledDragOverEvent: NOOP_EVENT.event,
    onDidDrop: NOOP_EVENT.event,
    onWillDrop: NOOP_EVENT.event,
    onWillDragGroup: NOOP_EVENT.event,
    onWillDragPanel: NOOP_EVENT.event,
    onDidActivePanelChange_: NOOP_EVENT.event,
  }
}

export interface CreateMockPaneOptions<T> {
  params: T
  panelId?: string
  className?: string
  /** Override individual `api` fields without re-stubbing the whole surface. */
  apiOverrides?: Partial<PaneProps<T>["api"]>
  /** Override individual `containerApi` fields. */
  containerApiOverrides?: Partial<PaneProps<T>["containerApi"]>
}

export function createMockPaneProps<T>(
  optsOrParams: T | CreateMockPaneOptions<T>,
): PaneProps<T> {
  const opts: CreateMockPaneOptions<T> =
    optsOrParams !== null &&
    typeof optsOrParams === "object" &&
    "params" in optsOrParams
      ? (optsOrParams as CreateMockPaneOptions<T>)
      : { params: optsOrParams as T }

  const panelId = opts.panelId ?? "test-panel"
  const api = makeApi(panelId) as PaneProps<T>["api"]
  const containerApi = makeContainerApi() as PaneProps<T>["containerApi"]

  // Cast each spread back to the dockview type — TypeScript widens
  // {...api, ...overrides} to a union that loses some of dockview's
  // required event signatures, but the structural shape we ship is
  // identical at runtime.
  return {
    params: opts.params,
    api: { ...api, ...(opts.apiOverrides ?? {}) } as PaneProps<T>["api"],
    containerApi: {
      ...containerApi,
      ...(opts.containerApiOverrides ?? {}),
    } as PaneProps<T>["containerApi"],
    ...(opts.className !== undefined ? { className: opts.className } : {}),
  }
}
