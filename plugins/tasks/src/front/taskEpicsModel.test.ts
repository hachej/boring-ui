import { describe, expect, test } from "vitest"

import type { BoringTaskCard, BoringTaskColumn } from "../shared"
import { NO_EPIC_GROUP_KEY, epicGroupKey, groupTasksByEpic, isTerminalColumnId, selectVisibleEpicGroups } from "./taskEpicsModel"

const columns: BoringTaskColumn[] = [
  { id: "open", title: "Open" },
  { id: "in-progress", title: "In progress", color: "#0ea5e9" },
  { id: "closed", title: "Closed" },
]

function card(id: string, statusId: string, epic?: { id: string; title: string }, adapterId = "beads"): BoringTaskCard {
  return { id, number: id, title: `Task ${id}`, statusId, adapterId, ...(epic ? { epic } : {}) }
}

describe("taskEpicsModel", () => {
  test("scopes the epic key to its adapter so two sources never collide", () => {
    expect(epicGroupKey(card("a", "open", { id: "e1", title: "Epic" }))).toBe("beads:e1")
    expect(epicGroupKey(card("a", "open", { id: "e1", title: "Epic" }, "github"))).toBe("github:e1")
    expect(epicGroupKey(card("a", "open"))).toBeUndefined()
  })

  test("recognises terminal columns across adapters, case-insensitively", () => {
    expect(isTerminalColumnId("closed")).toBe(true)
    expect(isTerminalColumnId("Done")).toBe(true)
    expect(isTerminalColumnId("in-progress")).toBe(false)
  })

  test("groups by epic, orders by title, and puts the unassigned group last", () => {
    const groups = groupTasksByEpic([
      card("1", "open", { id: "e2", title: "Zebra" }),
      card("2", "open"),
      card("3", "open", { id: "e1", title: "Alpha" }),
    ], columns)
    expect(groups.map((group) => group.title)).toEqual(["Alpha", "Zebra", "No epic"])
    expect(groups.at(-1)?.key).toBe(NO_EPIC_GROUP_KEY)
  })

  test("counts open versus closed beads and reports activity per epic", () => {
    const groups = groupTasksByEpic([
      card("1", "closed", { id: "e1", title: "Alpha" }),
      card("2", "in-progress", { id: "e1", title: "Alpha" }),
      card("3", "closed", { id: "e2", title: "Beta" }),
    ], columns)
    const [alpha, beta] = groups
    expect(alpha).toMatchObject({ taskCount: 2, openCount: 1, closedCount: 1, active: true })
    expect(beta).toMatchObject({ taskCount: 1, openCount: 0, closedCount: 1, active: false })
  })

  test("orders the status breakdown by board column order and carries column colors", () => {
    const groups = groupTasksByEpic([
      card("1", "closed", { id: "e1", title: "Alpha" }),
      card("2", "in-progress", { id: "e1", title: "Alpha" }),
      card("3", "open", { id: "e1", title: "Alpha" }),
    ], columns)
    expect(groups[0]?.statuses.map((status) => status.columnId)).toEqual(["open", "in-progress", "closed"])
    expect(groups[0]?.statuses[1]).toMatchObject({ title: "In progress", color: "#0ea5e9", count: 1 })
  })

  test("still counts beads whose status is absent from the board config", () => {
    const groups = groupTasksByEpic([card("1", "mystery", { id: "e1", title: "Alpha" })], columns)
    expect(groups[0]).toMatchObject({ taskCount: 1, openCount: 1 })
    expect(groups[0]?.statuses[0]).toMatchObject({ columnId: "mystery", title: "mystery", count: 1 })
  })

  test("falls back to the raw epic id when the parent bead has no resolvable title", () => {
    const groups = groupTasksByEpic([card("1", "open", { id: "bd-9", title: "bd-9" })], columns)
    expect(groups[0]?.title).toBe("bd-9")
    expect(groups[0]?.epicId).toBe("bd-9")
  })

  test("hides fully closed epics by default and states exactly what is withheld", () => {
    const groups = groupTasksByEpic([
      card("1", "open", { id: "e1", title: "Alpha" }),
      card("2", "closed", { id: "e2", title: "Beta" }),
      card("3", "closed", { id: "e2", title: "Beta" }),
    ], columns)
    expect(selectVisibleEpicGroups(groups, false)).toMatchObject({ hiddenEpicCount: 1, hiddenTaskCount: 2 })
    expect(selectVisibleEpicGroups(groups, false).visible.map((group) => group.title)).toEqual(["Alpha"])
    expect(selectVisibleEpicGroups(groups, true)).toMatchObject({ hiddenEpicCount: 0, hiddenTaskCount: 0 })
    expect(selectVisibleEpicGroups(groups, true).visible).toHaveLength(2)
  })
})
