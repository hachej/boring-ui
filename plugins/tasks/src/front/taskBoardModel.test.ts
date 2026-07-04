import { describe, expect, it } from "vitest"
import type { BoringTaskBoardConfig, BoringTaskCard } from "../shared"
import { groupTasksByColumn, UNMAPPED_COLUMN_ID } from "./taskBoardModel"

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
