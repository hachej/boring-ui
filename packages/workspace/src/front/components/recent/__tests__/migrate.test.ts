import { describe, it, expect, beforeEach } from "vitest"
import { loadRecent, STORAGE_KEY } from "../recentStore"
import type { RecentEntry } from "../types"

beforeEach(() => {
  localStorage.clear()
})

describe("loadRecent", () => {
  it("loads typed recent entries", () => {
    const typed: RecentEntry[] = [
      {
        type: "catalog",
        catalogId: "files",
        rowId: "src/a.ts",
        rowSnapshot: { id: "src/a.ts", title: "a.ts" },
        selectedAt: 1,
      },
      {
        type: "command",
        commandId: "foo",
        titleSnapshot: "Foo",
        selectedAt: 2,
      },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(typed))
    expect(loadRecent()).toEqual(typed)
  })

  it("drops removed string recent entries instead of migrating them", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["src/a.ts", "cmd:foo"]))
    expect(loadRecent()).toEqual([])
  })

  it("filters invalid mixed entries", () => {
    const valid: RecentEntry = {
      type: "command",
      commandId: "sidebar",
      titleSnapshot: "Toggle Sidebar",
      selectedAt: 500,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["src/a.ts", valid, null, 42]))
    expect(loadRecent()).toEqual([valid])
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
