import type { BoringTaskBoardConfig, BoringTaskCard, BoringTaskColumn } from "../shared"

export const UNMAPPED_COLUMN_ID = "__unmapped__"

export interface BoringTaskColumnView extends BoringTaskColumn {
  tasks: BoringTaskCard[]
  unmapped?: boolean
}

export function groupTasksByColumn(
  board: BoringTaskBoardConfig,
  tasks: readonly BoringTaskCard[],
): BoringTaskColumnView[] {
  const configuredIds = new Set(board.columns.map((column) => column.id))
  const columns: BoringTaskColumnView[] = board.columns.map((column) => ({ ...column, tasks: [] }))
  const byId = new Map(columns.map((column) => [column.id, column]))
  const unmapped: BoringTaskCard[] = []

  for (const task of tasks) {
    const column = byId.get(task.statusId)
    if (column) column.tasks.push(task)
    else unmapped.push(task)
  }

  if (unmapped.length > 0) {
    columns.push({
      id: UNMAPPED_COLUMN_ID,
      title: "Unmapped",
      description: "Tasks whose adapter status is not in this board config",
      acceptsDrop: false,
      tasks: unmapped,
      unmapped: true,
    })
  }

  return columns.filter((column) => column.tasks.length > 0 || configuredIds.has(column.id))
}

export function canDropInColumn(column: BoringTaskColumn): boolean {
  return column.id !== UNMAPPED_COLUMN_ID && column.acceptsDrop !== false
}
