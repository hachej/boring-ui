import { describe, it, expect, beforeEach } from "vitest"
import { migrateRecent } from "../migrate"
import { loadRecent, STORAGE_KEY } from "../recentStore"
import type { RecentEntry } from "../types"

beforeEach(() => {
  localStorage.clear()
})

describe("migrateRecent", () => {
  it("returns empty array for empty input", () => {
    expect(migrateRecent([])).toEqual([])
  })

  it("converts plain path strings to catalog entries", () => {
    const result = migrateRecent(["src/App.tsx", "lib/utils.ts"])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      type: "catalog",
      catalogId: "files",
      rowId: "src/App.tsx",
      rowSnapshot: { id: "src/App.tsx", title: "App.tsx", subtitle: "src/" },
    })
    expect(result[1]).toMatchObject({
      type: "catalog",
      catalogId: "files",
      rowId: "lib/utils.ts",
      rowSnapshot: { id: "lib/utils.ts", title: "utils.ts", subtitle: "lib/" },
    })
  })

  it("converts cmd: prefixed strings to command entries", () => {
    const result = migrateRecent(["cmd:toggle-theme"])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: "command",
      commandId: "toggle-theme",
      titleSnapshot: "toggle-theme",
    })
  })

  it("handles mixed legacy strings", () => {
    const result = migrateRecent(["src/a.ts", "cmd:foo", "src/b.ts"])
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe("catalog")
    expect(result[1].type).toBe("command")
    expect(result[2].type).toBe("catalog")
  })

  it("passes through already-migrated RecentEntry objects", () => {
    const existing: RecentEntry = {
      type: "catalog",
      catalogId: "files",
      rowId: "x.ts",
      rowSnapshot: { id: "x.ts", title: "x.ts" },
      selectedAt: 999,
    }
    const result = migrateRecent([existing])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(existing)
  })

  it("handles mixed legacy strings and objects", () => {
    const existing: RecentEntry = {
      type: "command",
      commandId: "sidebar",
      titleSnapshot: "Toggle Sidebar",
      selectedAt: 500,
    }
    const result = migrateRecent(["src/a.ts", existing, "cmd:bar"])
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe("catalog")
    expect(result[1]).toBe(existing)
    expect(result[2].type).toBe("command")
  })

  it("skips null, numbers, and other non-string/non-object entries", () => {
    const result = migrateRecent([null, 42, true, "src/ok.ts"])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ type: "catalog", rowId: "src/ok.ts" })
  })

  it("handles path without slash (bare filename)", () => {
    const result = migrateRecent(["README.md"])
    expect(result[0]).toMatchObject({
      type: "catalog",
      rowSnapshot: { id: "README.md", title: "README.md" },
    })
    expect((result[0] as Extract<RecentEntry, { type: "catalog" }>).rowSnapshot.subtitle).toBeUndefined()
  })
})

describe("loadRecent with legacy migration", () => {
  it("migrates legacy string array on first load", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["src/a.ts", "cmd:foo"]))
    const entries = loadRecent()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: "catalog", rowId: "src/a.ts" })
    expect(entries[1]).toMatchObject({ type: "command", commandId: "foo" })
  })

  it("persists migrated shape back to localStorage", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["src/a.ts"]))
    loadRecent()
    const stored: RecentEntry[] = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored[0]).toMatchObject({ type: "catalog", rowId: "src/a.ts" })
  })

  it("is idempotent — second load returns same shape", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["src/a.ts", "cmd:bar"]))
    const first = loadRecent()
    const second = loadRecent()
    expect(first).toEqual(second)
  })

  it("handles corrupt JSON gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{{{")
    expect(loadRecent()).toEqual([])
  })

  it("handles non-array JSON gracefully", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: "val" }))
    expect(loadRecent()).toEqual([])
  })
})
