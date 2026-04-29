import { describe, it, expect, beforeEach } from "vitest"
import type { RecentEntry } from "../types"
import {
  loadRecent,
  saveRecent,
  addCatalogToRecent,
  addCommandToRecent,
  STORAGE_KEY,
  MAX_ENTRIES,
} from "../recentStore"

beforeEach(() => {
  localStorage.clear()
})

describe("RecentEntry discriminated union", () => {
  it("narrows correctly via switch on type", () => {
    const catalog: RecentEntry = {
      type: "catalog",
      catalogId: "files",
      rowId: "/src/App.tsx",
      rowSnapshot: { id: "/src/App.tsx", title: "App.tsx" },
      selectedAt: 1000,
    }
    const command: RecentEntry = {
      type: "command",
      commandId: "toggle-theme",
      titleSnapshot: "Toggle Theme",
      selectedAt: 2000,
    }

    function getLabel(entry: RecentEntry): string {
      switch (entry.type) {
        case "catalog":
          return entry.rowSnapshot.title
        case "command":
          return entry.titleSnapshot
      }
    }

    expect(getLabel(catalog)).toBe("App.tsx")
    expect(getLabel(command)).toBe("Toggle Theme")
  })
})

describe("loadRecent / saveRecent", () => {
  it("returns empty array when no storage", () => {
    expect(loadRecent()).toEqual([])
  })

  it("round-trips entries through save/load", () => {
    const entries: RecentEntry[] = [
      {
        type: "catalog",
        catalogId: "files",
        rowId: "a.ts",
        rowSnapshot: { id: "a.ts", title: "a.ts" },
        selectedAt: 1,
      },
      {
        type: "command",
        commandId: "theme",
        titleSnapshot: "Toggle Theme",
        selectedAt: 2,
      },
    ]
    saveRecent(entries)
    expect(loadRecent()).toEqual(entries)
  })

  it("drops invalid entries on load", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { type: "catalog", catalogId: "x", rowId: "y", rowSnapshot: { id: "y", title: "y" }, selectedAt: 1 },
        { type: "bogus" },
        null,
        42,
      ]),
    )
    const loaded = loadRecent()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].type).toBe("catalog")
  })

  it("returns empty array on corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{{{")
    expect(loadRecent()).toEqual([])
  })
})

describe("addCatalogToRecent", () => {
  it("prepends catalog entry to list", () => {
    addCatalogToRecent("files", { id: "a.ts", title: "a.ts" })
    const entries = loadRecent()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      type: "catalog",
      catalogId: "files",
      rowId: "a.ts",
    })
  })

  it("dedupes by catalogId + rowId, moving to top", () => {
    addCatalogToRecent("files", { id: "a.ts", title: "a.ts" })
    addCatalogToRecent("files", { id: "b.ts", title: "b.ts" })
    addCatalogToRecent("files", { id: "a.ts", title: "a.ts (updated)" })
    const entries = loadRecent()
    expect(entries).toHaveLength(2)
    expect(entries[0].type === "catalog" && entries[0].rowId).toBe("a.ts")
    expect(entries[0].type === "catalog" && entries[0].rowSnapshot.title).toBe("a.ts (updated)")
  })

  it("caps at MAX_ENTRIES, evicting oldest", () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      addCatalogToRecent("files", { id: `file-${i}`, title: `file-${i}` })
    }
    const entries = loadRecent()
    expect(entries).toHaveLength(MAX_ENTRIES)
    expect(entries[0].type === "catalog" && entries[0].rowId).toBe(`file-${MAX_ENTRIES + 4}`)
  })
})

describe("addCommandToRecent", () => {
  it("prepends command entry", () => {
    addCommandToRecent("theme", "Toggle Theme")
    const entries = loadRecent()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      type: "command",
      commandId: "theme",
      titleSnapshot: "Toggle Theme",
    })
  })

  it("dedupes by commandId, moving to top", () => {
    addCommandToRecent("theme", "Toggle Theme")
    addCommandToRecent("sidebar", "Toggle Sidebar")
    addCommandToRecent("theme", "Toggle Theme v2")
    const entries = loadRecent()
    expect(entries).toHaveLength(2)
    expect(entries[0].type === "command" && entries[0].commandId).toBe("theme")
    expect(entries[0].type === "command" && entries[0].titleSnapshot).toBe("Toggle Theme v2")
  })
})

describe("mixed catalog + command entries", () => {
  it("preserves order across types", () => {
    addCatalogToRecent("files", { id: "a.ts", title: "a.ts" })
    addCommandToRecent("theme", "Toggle Theme")
    addCatalogToRecent("files", { id: "b.ts", title: "b.ts" })
    const entries = loadRecent()
    expect(entries).toHaveLength(3)
    expect(entries[0].type).toBe("catalog")
    expect(entries[1].type).toBe("command")
    expect(entries[2].type).toBe("catalog")
  })
})
