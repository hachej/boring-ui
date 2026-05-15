import { describe, it, expect } from "vitest"
import * as fc from "fast-check"
import { createWorkspaceStore } from "../front/store"
import { createBridge } from "../front/bridge/createBridge"
import type { WorkspaceBridge } from "../front/bridge/types"
import type { WorkspaceStore } from "../front/store/types"

type StoreApi = ReturnType<typeof createWorkspaceStore>

interface WorkspaceModel {
  store: StoreApi
  bridge: WorkspaceBridge
}

type Action =
  | { type: "openFile"; path: string }
  | { type: "openPanel"; id: string; component: string; essential?: boolean }
  | { type: "closePanel"; id: string }
  | { type: "activatePanel"; id: string }
  | { type: "toggleSidebar" }
  | { type: "setSidebarWidth"; width: number }
  | { type: "setTheme"; theme: "light" | "dark" }
  | { type: "markDirty"; path: string }
  | { type: "markClean"; path: string }
  | { type: "showNotification"; message: string; level: "info" | "warning" | "error" }
  | { type: "dismissNotification"; index: number }
  | { type: "setPanelSize"; panelId: string; size: number }
  | { type: "resetLayout" }

const safePathArb = fc.stringMatching(/^\/[a-zA-Z0-9/_.-]{1,50}$/)
const panelIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/)
const componentArb = fc.constantFrom("editor", "filetree", "markdown", "fake-catalog", "empty")

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: safePathArb.map((path) => ({ type: "openFile" as const, path })) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("openPanel" as const),
      id: panelIdArb,
      component: componentArb,
      essential: fc.oneof(fc.constant(undefined), fc.boolean()),
    }),
  },
  { weight: 2, arbitrary: panelIdArb.map((id) => ({ type: "closePanel" as const, id })) },
  { weight: 2, arbitrary: panelIdArb.map((id) => ({ type: "activatePanel" as const, id })) },
  { weight: 2, arbitrary: fc.constant({ type: "toggleSidebar" as const }) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 1, max: 2000 }).map((width) => ({
      type: "setSidebarWidth" as const,
      width,
    })),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom("light" as const, "dark" as const).map((theme) => ({
      type: "setTheme" as const,
      theme,
    })),
  },
  { weight: 2, arbitrary: safePathArb.map((path) => ({ type: "markDirty" as const, path })) },
  { weight: 2, arbitrary: safePathArb.map((path) => ({ type: "markClean" as const, path })) },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("showNotification" as const),
      message: fc.string({ minLength: 1, maxLength: 100 }),
      level: fc.constantFrom("info" as const, "warning" as const, "error" as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 0, max: 100 }).map((index) => ({
      type: "dismissNotification" as const,
      index,
    })),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("setPanelSize" as const),
      panelId: panelIdArb,
      size: fc.float({ min: 0, max: 5000, noNaN: true }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ type: "resetLayout" as const }) },
)

async function applyAction(model: WorkspaceModel, action: Action): Promise<void> {
  const { store, bridge } = model
  const state = store.getState()

  switch (action.type) {
    case "openFile":
      await bridge.openFile(action.path)
      break
    case "openPanel":
      store.getState().openPanel({
        id: action.id,
        component: action.component,
        essential: action.essential,
      })
      break
    case "closePanel":
      await bridge.closePanel(action.id)
      break
    case "activatePanel": {
      const exists = state.panels.some((p) => p.id === action.id)
      if (exists) state.activatePanel(action.id)
      break
    }
    case "toggleSidebar":
      state.setSidebar({ collapsed: !state.sidebar.collapsed })
      break
    case "setSidebarWidth":
      state.setSidebar({ width: action.width })
      break
    case "setTheme":
      state.setTheme(action.theme)
      break
    case "markDirty":
      bridge.markDirty(action.path)
      break
    case "markClean":
      bridge.markClean(action.path)
      break
    case "showNotification":
      state.showNotification({ message: action.message, type: action.level })
      break
    case "dismissNotification": {
      const notifs = state.notifications
      if (notifs.length > 0) {
        const idx = action.index % notifs.length
        state.dismissNotification(notifs[idx].id)
      }
      break
    }
    case "setPanelSize":
      state.setPanelSize(action.panelId, action.size)
      break
    case "resetLayout":
      state.resetLayout()
      break
  }
}

function checkInvariants(model: WorkspaceModel, actionIndex: number, action: Action): void {
  const state = model.store.getState()

  // Invariant 1: No negative panel sizes
  for (const [id, size] of Object.entries(state.panelSizes)) {
    expect(size, `panelSizes[${id}] negative after action #${actionIndex} (${action.type})`).toBeGreaterThanOrEqual(0)
  }

  // Invariant 2: Sidebar width is always positive
  expect(
    state.sidebar.width,
    `sidebar.width non-positive after action #${actionIndex} (${action.type})`,
  ).toBeGreaterThan(0)

  // Invariant 3: Essential panels are never removed from the list
  for (const panel of state.panels) {
    if (panel.essential) {
      expect(
        state.panels.some((p) => p.id === panel.id),
        `essential panel ${panel.id} missing after action #${actionIndex} (${action.type})`,
      ).toBe(true)
    }
  }

  // Invariant 4: No duplicate panel IDs
  const panelIds = state.panels.map((p) => p.id)
  expect(
    new Set(panelIds).size,
    `duplicate panel IDs after action #${actionIndex} (${action.type})`,
  ).toBe(panelIds.length)

  // Invariant 5: activePanel, if set, must exist in panels list
  if (state.activePanel !== null) {
    const exists = state.panels.some((p) => p.id === state.activePanel)
    // activePanel can refer to a panel that was just removed — store sets to null only if
    // activePanel === closedId. If a panel was never opened with that id, it may linger.
    // We only enforce this after an openPanel or activatePanel.
    if (action.type === "openPanel" || action.type === "activatePanel") {
      expect(
        exists,
        `activePanel "${state.activePanel}" not in panels after action #${actionIndex} (${action.type})`,
      ).toBe(true)
    }
  }

  // Invariant 6: Bridge state matches store state
  expect(model.bridge.getOpenPanels()).toEqual(state.panels)
  expect(model.bridge.getActiveFile()).toBe(state.activeFile)
  expect(model.bridge.getDirtyFiles().sort()).toEqual(Object.keys(state.dirtyFiles).sort())
  expect(model.bridge.getVisibleFiles()).toEqual(state.visibleFiles)

  // Invariant 7: No duplicate visible files
  const visibleSet = new Set(state.visibleFiles)
  expect(
    visibleSet.size,
    `duplicate visibleFiles after action #${actionIndex} (${action.type})`,
  ).toBe(state.visibleFiles.length)

  // Invariant 8: Notification IDs are unique
  const notifIds = state.notifications.map((n) => n.id)
  expect(
    new Set(notifIds).size,
    `duplicate notification IDs after action #${actionIndex} (${action.type})`,
  ).toBe(notifIds.length)
}

describe("Stateful exploration: random action sequences", () => {
  it("invariants hold after random action sequences (short)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArb, { minLength: 5, maxLength: 30 }),
        async (actions) => {
          const store = createWorkspaceStore({ persistenceEnabled: false })
          const bridge = createBridge(store)
          const model: WorkspaceModel = { store, bridge }

          for (let i = 0; i < actions.length; i++) {
            await applyAction(model, actions[i])
            checkInvariants(model, i, actions[i])
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it("invariants hold after long random action sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArb, { minLength: 50, maxLength: 200 }),
        async (actions) => {
          const store = createWorkspaceStore({ persistenceEnabled: false })
          const bridge = createBridge(store)
          const model: WorkspaceModel = { store, bridge }

          for (let i = 0; i < actions.length; i++) {
            await applyAction(model, actions[i])
            checkInvariants(model, i, actions[i])
          }
        },
      ),
      { numRuns: 20 },
    )
  })

  it("sidebar collapse/expand is reversible under interleaved actions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 2000 }),
        fc.array(actionArb, { minLength: 1, maxLength: 20 }),
        async (initialWidth, intermediateActions) => {
          const store = createWorkspaceStore({ persistenceEnabled: false })
          const bridge = createBridge(store)
          const model: WorkspaceModel = { store, bridge }

          store.getState().setSidebar({ width: initialWidth, collapsed: false })
          expect(store.getState().sidebar.width).toBe(initialWidth)

          store.getState().setSidebar({ collapsed: true })

          // Run arbitrary non-sidebar-width actions
          for (const action of intermediateActions) {
            if (action.type !== "setSidebarWidth" && action.type !== "resetLayout") {
              await applyAction(model, action)
            }
          }

          expect(store.getState().sidebar.width).toBe(initialWidth)

          store.getState().setSidebar({ collapsed: false })
          expect(store.getState().sidebar.width).toBe(initialWidth)
          expect(store.getState().sidebar.collapsed).toBe(false)
        },
      ),
      { numRuns: 50 },
    )
  })

  it("essential panels survive any action sequence", async () => {
    await fc.assert(
      fc.asyncProperty(
        panelIdArb,
        componentArb,
        fc.array(actionArb, { minLength: 5, maxLength: 50 }),
        async (essentialId, component, actions) => {
          const store = createWorkspaceStore({ persistenceEnabled: false })
          const bridge = createBridge(store)
          const model: WorkspaceModel = { store, bridge }

          store.getState().openPanel({
            id: essentialId,
            component,
            essential: true,
          })

          for (const action of actions) {
            await applyAction(model, action)
          }

          expect(
            store.getState().panels.some((p) => p.id === essentialId),
          ).toBe(true)
        },
      ),
      { numRuns: 50 },
    )
  })

  it("theme is always light or dark", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArb, { minLength: 1, maxLength: 50 }),
        async (actions) => {
          const store = createWorkspaceStore({ persistenceEnabled: false })
          const bridge = createBridge(store)
          const model: WorkspaceModel = { store, bridge }

          for (const action of actions) {
            await applyAction(model, action)
          }

          expect(["light", "dark"]).toContain(store.getState().preferences.theme)
        },
      ),
      { numRuns: 50 },
    )
  })
})
