import { describe, expect, it } from "vitest"
import type { BoringTaskBoardConfig, BoringTaskCard } from "../shared"
import { groupTasksByColumn, taskMatchesSearch, UNMAPPED_COLUMN_ID } from "./taskBoardModel"

const board: BoringTaskBoardConfig = {
  adapterId: "test",
  columns: [
    { id: "todo", title: "Todo" },
    { id: "doing", title: "Doing" },
  ],
}

const tasks: BoringTaskCard[] = [
  { id: "1", number: "T-1", title: "One", statusId: "todo", adapterId: "test" },
  { id: "2", number: "T-2", title: "Two", statusId: "missing", adapterId: "test" },
]

describe("groupTasksByColumn", () => {
  it("groups task cards by adapter-supplied columns", () => {
    const columns = groupTasksByColumn(board, tasks)

    expect(columns.map((column) => column.id)).toEqual(["todo", "doing", UNMAPPED_COLUMN_ID])
    expect(columns[0]?.tasks.map((task) => task.id)).toEqual(["1"])
    expect(columns[1]?.tasks).toEqual([])
  })

  it("keeps unmapped statuses visible in a non-droppable overflow column", () => {
    const columns = groupTasksByColumn(board, tasks)
    const unmapped = columns.find((column) => column.id === UNMAPPED_COLUMN_ID)

    expect(unmapped?.acceptsDrop).toBe(false)
    expect(unmapped?.unmapped).toBe(true)
    expect(unmapped?.tasks.map((task) => task.id)).toEqual(["2"])
  })
})

describe("taskMatchesSearch", () => {
  const searchableTask: BoringTaskCard = {
    id: "776",
    number: "#776",
    title: "Bind native Pi sessions",
    description: "Exact durable session links",
    statusId: "doing",
    adapterId: "github:workspace",
    tags: ["enhancement"],
    epic: { id: "task-control", title: "Task control" },
    pullRequests: [{ id: "804", number: "#804", title: "Bind task sessions" }],
  }

  it.each(["776", "native session", "durable", "enhancement", "task control", "#804 bind"])("matches %s", (query) => {
    expect(taskMatchesSearch(searchableTask, query)).toBe(true)
  })

  it("treats a numeric task identifier as an exact task-number lookup", () => {
    expect(taskMatchesSearch(searchableTask, "776")).toBe(true)
    expect(taskMatchesSearch(searchableTask, "804")).toBe(false)
  })

  it("requires every search term", () => {
    expect(taskMatchesSearch(searchableTask, "native missing")).toBe(false)
  })
})
