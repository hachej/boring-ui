import { describe, it, expect, beforeEach, vi } from "vitest"
import * as fc from "fast-check"
import { createWorkspaceStore } from "../index"
import {
  validateLayoutPartition,
  validatePreferencesPartition,
} from "../validation"
import type { WorkspaceStore } from "../types"

function makeStore() {
  return createWorkspaceStore({ persistenceEnabled: false })
}

const panelIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/)
const componentNameArb = fc.constantFrom("editor", "filetree", "markdown", "data-catalog", "empty")
const filePathArb = fc.stringMatching(/^\/[a-zA-Z0-9/_.-]{1,100}$/)
const sidebarWidthArb = fc.integer({ min: 1, max: 2000 })
const themeArb = fc.constantFrom("light" as const, "dark" as const)

describe("Store property-based tests", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe("Invariant: sidebar collapse/expand is reversible", () => {
    it("collapse then expand preserves width", () => {
      fc.assert(
        fc.property(sidebarWidthArb, (width) => {
          const store = makeStore()
          store.getState().setSidebar({ width, collapsed: false })
          expect(store.getState().sidebar.width).toBe(width)
          expect(store.getState().sidebar.collapsed).toBe(false)

          store.getState().setSidebar({ collapsed: true })
          expect(store.getState().sidebar.collapsed).toBe(true)
          expect(store.getState().sidebar.width).toBe(width)

          store.getState().setSidebar({ collapsed: false })
          expect(store.getState().sidebar.collapsed).toBe(false)
          expect(store.getState().sidebar.width).toBe(width)
        }),
        { numRuns: 100 },
      )
    })

    it("multiple toggle cycles preserve width", () => {
      fc.assert(
        fc.property(
          sidebarWidthArb,
          fc.integer({ min: 1, max: 20 }),
          (width, cycles) => {
            const store = makeStore()
            store.getState().setSidebar({ width, collapsed: false })

            for (let i = 0; i < cycles; i++) {
              store.getState().setSidebar({ collapsed: true })
              expect(store.getState().sidebar.width).toBe(width)
              store.getState().setSidebar({ collapsed: false })
              expect(store.getState().sidebar.width).toBe(width)
            }
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  describe("Invariant: panel sizes are never negative", () => {
    it("setPanelSize with any non-negative value produces non-negative stored value", () => {
      fc.assert(
        fc.property(
          panelIdArb,
          fc.float({ min: 0, max: 10000, noNaN: true }),
          (panelId, size) => {
            const store = makeStore()
            store.getState().setPanelSize(panelId, size)
            expect(store.getState().panelSizes[panelId]).toBeGreaterThanOrEqual(0)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe("Invariant: panel operations maintain consistent state", () => {
    it("opening a panel adds it and sets activePanel", () => {
      fc.assert(
        fc.property(panelIdArb, componentNameArb, (id, component) => {
          const store = makeStore()
          store.getState().openPanel({ id, component })
          const state = store.getState()
          expect(state.panels.some((p) => p.id === id)).toBe(true)
          expect(state.activePanel).toBe(id)
        }),
        { numRuns: 100 },
      )
    })

    it("opening the same panel twice does not duplicate it", () => {
      fc.assert(
        fc.property(panelIdArb, componentNameArb, (id, component) => {
          const store = makeStore()
          store.getState().openPanel({ id, component })
          store.getState().openPanel({ id, component })
          const panels = store.getState().panels.filter((p) => p.id === id)
          expect(panels).toHaveLength(1)
        }),
        { numRuns: 100 },
      )
    })

    it("closing a panel removes it from the list", () => {
      fc.assert(
        fc.property(panelIdArb, componentNameArb, (id, component) => {
          const store = makeStore()
          store.getState().openPanel({ id, component })
          expect(store.getState().panels.some((p) => p.id === id)).toBe(true)
          store.getState().closePanel(id)
          expect(store.getState().panels.some((p) => p.id === id)).toBe(false)
        }),
        { numRuns: 100 },
      )
    })

    it("closing active panel sets activePanel to null", () => {
      fc.assert(
        fc.property(panelIdArb, componentNameArb, (id, component) => {
          const store = makeStore()
          store.getState().openPanel({ id, component })
          expect(store.getState().activePanel).toBe(id)
          store.getState().closePanel(id)
          expect(store.getState().activePanel).toBeNull()
        }),
        { numRuns: 100 },
      )
    })

    it("closing a non-active panel preserves activePanel", () => {
      fc.assert(
        fc.property(
          panelIdArb,
          panelIdArb.filter((id) => id.length > 0),
          componentNameArb,
          (id1, id2Seed, component) => {
            const id2 = id2Seed === id1 ? id1 + "_2" : id2Seed
            const store = makeStore()
            store.getState().openPanel({ id: id1, component })
            store.getState().openPanel({ id: id2, component })
            expect(store.getState().activePanel).toBe(id2)
            store.getState().closePanel(id1)
            expect(store.getState().activePanel).toBe(id2)
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  describe("Invariant: file tracking is consistent", () => {
    it("openFile adds to visibleFiles and sets activeFile", () => {
      fc.assert(
        fc.property(filePathArb, (file) => {
          const store = makeStore()
          store.getState().openFile(file)
          expect(store.getState().activeFile).toBe(file)
          expect(store.getState().visibleFiles).toContain(file)
        }),
        { numRuns: 100 },
      )
    })

    it("opening same file twice does not duplicate in visibleFiles", () => {
      fc.assert(
        fc.property(filePathArb, (file) => {
          const store = makeStore()
          store.getState().openFile(file)
          store.getState().openFile(file)
          const count = store.getState().visibleFiles.filter((f) => f === file).length
          expect(count).toBe(1)
        }),
        { numRuns: 100 },
      )
    })

    it("markDirty/markClean round-trips", () => {
      fc.assert(
        fc.property(filePathArb, panelIdArb, (file, panelId) => {
          const store = makeStore()
          store.getState().markDirty(file, panelId)
          expect(store.getState().dirtyFiles[file]).toBeDefined()
          store.getState().markClean(file)
          expect(store.getState().dirtyFiles[file]).toBeUndefined()
        }),
        { numRuns: 100 },
      )
    })
  })

  describe("Invariant: layout validation round-trips", () => {
    it("valid layout partitions pass validation idempotently", () => {
      const layoutPartitionArb = fc.record({
        layout: fc.constant(null),
        sidebar: fc.record({
          collapsed: fc.boolean(),
          width: fc.integer({ min: 1, max: 2000 }),
        }),
        panelSizes: fc.dictionary(
          panelIdArb,
          fc.float({ min: 0, max: 5000, noNaN: true }),
        ),
      })

      fc.assert(
        fc.property(layoutPartitionArb, (partition) => {
          const first = validateLayoutPartition(partition)
          expect(first).not.toBeNull()

          const second = validateLayoutPartition(first)
          expect(second).not.toBeNull()
          expect(second).toEqual(first)
        }),
        { numRuns: 100 },
      )
    })

    it("valid preferences round-trip through validation", () => {
      fc.assert(
        fc.property(themeArb, (theme) => {
          const first = validatePreferencesPartition({ theme })
          expect(first).not.toBeNull()
          expect(first!.theme).toBe(theme)

          const second = validatePreferencesPartition(first)
          expect(second).toEqual(first)
        }),
        { numRuns: 20 },
      )
    })

    it("layout partition with dockview grid round-trips", () => {
      const gridArb = fc.record({
        root: fc.constant({ type: "branch", data: [] }),
        width: fc.integer({ min: 0, max: 4000 }),
        height: fc.integer({ min: 0, max: 4000 }),
        orientation: fc.constantFrom(0, 1),
      })

      const panelArb = fc.record({
        id: fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/),
        contentComponent: fc.constant("editor"),
        title: fc.stringMatching(/^[a-zA-Z0-9 ]{0,50}$/),
      })

      const dockviewLayoutArb = fc.record({
        grid: gridArb,
        panels: fc.dictionary(
          fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/),
          panelArb,
        ),
      })

      const partitionArb = fc.record({
        layout: dockviewLayoutArb,
        sidebar: fc.record({
          collapsed: fc.boolean(),
          width: fc.integer({ min: 1, max: 2000 }),
        }),
        panelSizes: fc.dictionary(
          panelIdArb,
          fc.float({ min: 0, max: 5000, noNaN: true }),
        ),
      })

      fc.assert(
        fc.property(partitionArb, (partition) => {
          const first = validateLayoutPartition(partition)
          expect(first).not.toBeNull()

          const second = validateLayoutPartition(first)
          expect(second).toEqual(first)
        }),
        { numRuns: 50 },
      )
    })
  })

  describe("Invariant: notifications are unique and dismissible", () => {
    it("each notification gets a unique ID", () => {
      const uuids = new Set<string>()
      vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
        const id = `uuid-${uuids.size}`
        uuids.add(id)
        return id as `${string}-${string}-${string}-${string}-${string}`
      })

      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              message: fc.string({ minLength: 1, maxLength: 100 }),
              type: fc.constantFrom("info" as const, "warning" as const, "error" as const),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          (notifications) => {
            uuids.clear()
            const store = makeStore()
            for (const n of notifications) {
              store.getState().showNotification(n)
            }
            const ids = store.getState().notifications.map((n) => n.id)
            expect(new Set(ids).size).toBe(ids.length)
          },
        ),
        { numRuns: 50 },
      )

      vi.restoreAllMocks()
    })

    it("dismissing a notification removes only that one", () => {
      let counter = 0
      vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
        return `uuid-${counter++}` as `${string}-${string}-${string}-${string}-${string}`
      })

      const store = makeStore()
      store.getState().showNotification({ message: "A", type: "info" })
      store.getState().showNotification({ message: "B", type: "info" })
      store.getState().showNotification({ message: "C", type: "info" })

      const before = store.getState().notifications.length
      const targetId = store.getState().notifications[1].id
      store.getState().dismissNotification(targetId)
      const after = store.getState().notifications

      expect(after.length).toBe(before - 1)
      expect(after.some((n) => n.id === targetId)).toBe(false)

      vi.restoreAllMocks()
    })
  })
})
