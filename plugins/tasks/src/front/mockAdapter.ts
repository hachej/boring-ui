import type { BoringTaskAdapter, BoringTaskBoardConfig, BoringTaskCard } from "../shared"

export const mockBoardConfig: BoringTaskBoardConfig = {
  adapterId: "mock",
  defaultColumnId: "triage",
  columns: [
    { id: "triage", title: "Triage", description: "Fresh work that needs a first pass", color: "#8b5cf6" },
    { id: "ready", title: "Ready", description: "Clear enough to pick up", color: "#0ea5e9" },
    { id: "doing", title: "Doing", description: "In progress now", color: "#f59e0b" },
    { id: "review", title: "Review", description: "Needs human or agent review", color: "#ec4899" },
    { id: "done", title: "Done", description: "Completed or closed", color: "#22c55e" },
  ],
}

export const mockTasks: BoringTaskCard[] = [
  {
    id: "task-101",
    number: "TASK-101",
    title: "Standard task card contract",
    description: "Keep number, title, description, and status small enough for every adapter to map into.",
    statusId: "triage",
    tags: ["contract", "adapter"],
    epic: { id: "adapter-platform", title: "Adapter platform" },
    adapterId: "mock",
  },
  {
    id: "task-124",
    number: "TASK-124",
    title: "Adapter-supplied columns",
    description: "Columns are data from the adapter; the board does not hardcode Todo/In Progress/Done.",
    statusId: "ready",
    tags: ["columns", "config"],
    epic: { id: "board-ux", title: "Board UX" },
    adapterId: "mock",
  },
  {
    id: "task-138",
    number: "TASK-138",
    title: "Drag status through adapter boundary",
    description: "A drop calls moveTask(taskId, statusId). The adapter decides what that means for GitHub, Linear, Kata, or DB tasks.",
    statusId: "doing",
    tags: ["drag-drop", "action-loop"],
    epic: { id: "adapter-platform", title: "Adapter platform" },
    adapterId: "mock",
  },
  {
    id: "task-147",
    number: "TASK-147",
    title: "No tracker-specific UI actions",
    description: "Create, close, comment, and assign belong to adapter capabilities, not hardcoded board buttons.",
    statusId: "review",
    tags: ["actions", "capabilities"],
    epic: { id: "adapter-platform", title: "Adapter platform" },
    adapterId: "mock",
  },
  {
    id: "task-152",
    number: "TASK-152",
    title: "Unmapped statuses never disappear",
    description: "If a task status has no matching column, render it in a safe non-droppable overflow lane.",
    statusId: "external-new-state",
    tags: ["unmapped"],
    epic: { id: "board-ux", title: "Board UX" },
    adapterId: "mock",
  },
]

export function createMockTaskAdapter(initialTasks: readonly BoringTaskCard[] = mockTasks): BoringTaskAdapter {
  let tasks = initialTasks.map((task) => ({ ...task }))

  return {
    id: "mock",
    label: "Mock tasks",
    description: "Local demo adapter for the generic Kanban UI",
    capabilities: { move: true },
    getBoardConfig: () => mockBoardConfig,
    listTasks: () => tasks.map((task) => ({ ...task })),
    moveTask: ({ taskId, statusId }) => {
      const next = tasks.map((task) => task.id === taskId ? { ...task, statusId } : task)
      const moved = next.find((task) => task.id === taskId)
      if (!moved) throw new Error(`Task not found: ${taskId}`)
      tasks = next
      return { ...moved }
    },
  }
}
