import { describe, it, expect, beforeEach } from "vitest"
import * as fc from "fast-check"
import { createBridge } from "../createBridge"
import { createWorkspaceStore } from "../../../store"
import type { WorkspaceBridge } from "../types"
import type { PanelState } from "../../../store/types"

function setup() {
  const store = createWorkspaceStore({ persistenceEnabled: false })
  const bridge = createBridge(store)
  return { store, bridge }
}

const safePathArb = fc.stringMatching(/^\/[a-zA-Z0-9/_.-]{1,100}$/)
const panelIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/)
const componentArb = fc.constantFrom("editor", "filetree", "markdown", "data-catalog", "empty")

describe("Bridge property-based tests", () => {
  describe("Invariant: essential panels cannot be closed", () => {
    it("closePanel rejects essential panels with ESSENTIAL error", async () => {
      await fc.assert(
        fc.asyncProperty(panelIdArb, componentArb, async (id, component) => {
          const { store, bridge } = setup()
          const panel: PanelState = { id, component, essential: true }
          store.getState().openPanel(panel)

          const result = await bridge.closePanel(id)
          expect(result.status).toBe("error")
          expect(result.error?.code).toBe("ESSENTIAL")
          expect(store.getState().panels.some((p) => p.id === id)).toBe(true)
        }),
        { numRuns: 50 },
      )
    })

    it("non-essential panels can be closed", async () => {
      await fc.assert(
        fc.asyncProperty(panelIdArb, componentArb, async (id, component) => {
          const { store, bridge } = setup()
          store.getState().openPanel({ id, component, essential: false })

          const result = await bridge.closePanel(id)
          expect(result.status).toBe("ok")
          expect(store.getState().panels.some((p) => p.id === id)).toBe(false)
        }),
        { numRuns: 50 },
      )
    })

    it("essential panels survive arbitrary close sequences", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(panelIdArb, { minLength: 2, maxLength: 10 }),
          componentArb,
          async (ids, component) => {
            const uniqueIds = [...new Set(ids)]
            if (uniqueIds.length < 2) return

            const { store, bridge } = setup()
            const essentialId = uniqueIds[0]

            store.getState().openPanel({ id: essentialId, component, essential: true })
            for (const id of uniqueIds.slice(1)) {
              store.getState().openPanel({ id, component })
            }

            for (const id of uniqueIds.reverse()) {
              await bridge.closePanel(id)
            }

            expect(store.getState().panels.some((p) => p.id === essentialId)).toBe(true)
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  describe("Invariant: bridge state matches store state", () => {
    it("getOpenPanels returns same panels as store", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: panelIdArb,
              component: componentArb,
            }),
            { minLength: 0, maxLength: 10 },
          ),
          async (panelConfigs) => {
            const { store, bridge } = setup()
            const seenIds = new Set<string>()

            for (const config of panelConfigs) {
              if (seenIds.has(config.id)) continue
              seenIds.add(config.id)
              store.getState().openPanel(config)
            }

            const bridgePanels = bridge.getOpenPanels()
            const storePanels = store.getState().panels
            expect(bridgePanels).toEqual(storePanels)
          },
        ),
        { numRuns: 50 },
      )
    })

    it("getActiveFile matches store activeFile after openFile", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(safePathArb, { minLength: 1, maxLength: 10 }),
          async (paths) => {
            const { store, bridge } = setup()
            for (const path of paths) {
              await bridge.openFile(path)
            }
            expect(bridge.getActiveFile()).toBe(store.getState().activeFile)
          },
        ),
        { numRuns: 50 },
      )
    })

    it("getDirtyFiles matches store dirtyFiles keys", () => {
      fc.assert(
        fc.property(
          fc.array(safePathArb, { minLength: 1, maxLength: 10 }),
          (paths) => {
            const { store, bridge } = setup()
            const uniquePaths = [...new Set(paths)]
            for (const path of uniquePaths) {
              bridge.markDirty(path)
            }
            const bridgeDirty = bridge.getDirtyFiles().sort()
            const storeDirty = Object.keys(store.getState().dirtyFiles).sort()
            expect(bridgeDirty).toEqual(storeDirty)
          },
        ),
        { numRuns: 50 },
      )
    })

    it("getVisibleFiles matches store visibleFiles after openFile", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(safePathArb, { minLength: 1, maxLength: 10 }),
          async (paths) => {
            const { store, bridge } = setup()
            for (const path of paths) {
              await bridge.openFile(path)
            }
            const bridgeVisible = bridge.getVisibleFiles().sort()
            const storeVisible = [...store.getState().visibleFiles].sort()
            expect(bridgeVisible).toEqual(storeVisible)
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  describe("Invariant: MAX_PANELS cap is enforced", () => {
    it("cannot exceed MAX_PANELS", async () => {
      const { store, bridge } = setup()
      const results: string[] = []
      for (let i = 0; i < 55; i++) {
        const result = await bridge.openPanel({
          id: `panel-${i}`,
          component: "editor",
        })
        results.push(result.status)
      }

      expect(store.getState().panels.length).toBeLessThanOrEqual(50)
      expect(results.filter((r) => r === "error").length).toBeGreaterThan(0)
    })
  })

  describe("Invariant: bridge command validation rejects bad input", () => {
    it("openFile rejects path traversal", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringMatching(/^[a-zA-Z0-9/._-]{0,50}$/).map((s) => `../${s}`),
          async (path) => {
            const { bridge } = setup()
            const result = await bridge.openFile(path)
            expect(result.status).toBe("error")
            expect(result.error?.code).toBe("VALIDATION")
          },
        ),
        { numRuns: 30 },
      )
    })

    it("openFile rejects null bytes", async () => {
      await fc.assert(
        fc.asyncProperty(
          safePathArb.map((p) => p + "\0"),
          async (path) => {
            const { bridge } = setup()
            const result = await bridge.openFile(path)
            expect(result.status).toBe("error")
          },
        ),
        { numRuns: 30 },
      )
    })

    it("closePanel on nonexistent panel returns NOT_FOUND", async () => {
      await fc.assert(
        fc.asyncProperty(panelIdArb, async (id) => {
          const { bridge } = setup()
          const result = await bridge.closePanel(id)
          expect(result.status).toBe("error")
          expect(result.error?.code).toBe("NOT_FOUND")
        }),
        { numRuns: 30 },
      )
    })
  })

  describe("Invariant: dirty/clean state is consistent", () => {
    it("markDirty then markClean leaves file clean", () => {
      fc.assert(
        fc.property(safePathArb, (path) => {
          const { bridge } = setup()
          bridge.markDirty(path)
          expect(bridge.getDirtyFiles()).toContain(path)
          bridge.markClean(path)
          expect(bridge.getDirtyFiles()).not.toContain(path)
        }),
        { numRuns: 50 },
      )
    })

    it("markClean on already-clean file is idempotent", () => {
      fc.assert(
        fc.property(safePathArb, (path) => {
          const { bridge } = setup()
          bridge.markClean(path)
          bridge.markClean(path)
          expect(bridge.getDirtyFiles()).not.toContain(path)
        }),
        { numRuns: 30 },
      )
    })
  })
})
