import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { WorkspacePluginClientProvider } from "@hachej/boring-workspace"
import type { BoringTaskAdapter, BoringTaskDetail } from "../shared"
import { TaskHttpError } from "./httpTaskAdapter"
import { TaskKanbanBoard } from "./TaskKanbanBoard"

function adapter(id: string, title: string, listTasks: BoringTaskAdapter["listTasks"]): BoringTaskAdapter {
  return {
    id,
    label: title,
    capabilities: { move: false },
    getBoardConfig: async () => ({ adapterId: id, columns: [{ id: "open", title: "Open" }] }),
    listTasks,
  }
}

function task(adapterId: string, id: string, title: string) {
  return { id, number: id, title, statusId: "open", adapterId }
}

function detailFor(adapterId: string, id: string, body = "Full plain-text description."): BoringTaskDetail {
  return {
    task: { ...task(adapterId, id, "Detailed task"), priority: "P1", issueType: "feature", assignee: "worker-1", tags: ["tasks"] },
    body,
    acceptanceCriteria: "Keyboard access works.\nContent remains plain text.",
    notes: "Owner review required.",
    metadata: [{ id: "created-by", label: "Created by", value: "steward" }],
    relations: [{ id: "root", title: "Parent task", direction: "parent", status: "open", nativeType: "parent-child" }],
    updatedAt: "2026-08-04T12:00:00Z",
  }
}

function renderBoard(adapters: readonly BoringTaskAdapter[], workspaceId = "tasks-test") {
  return render(
    <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId={workspaceId}>
      <TaskKanbanBoard adapters={adapters} />
    </WorkspacePluginClientProvider>,
  )
}

describe("TaskKanbanBoard source isolation", () => {
  beforeEach(() => localStorage.clear())

  test("ignores a delayed source response from the previous Workspace", async () => {
    let resolveFirst!: (tasks: ReturnType<typeof task>[]) => void
    const firstAdapter = adapter("shared", "Shared", vi.fn(() => new Promise<ReturnType<typeof task>[]>((resolve) => { resolveFirst = resolve })))
    const view = renderBoard([firstAdapter], "workspace-a")

    const secondAdapter = adapter("shared", "Shared", vi.fn(async () => [task("shared", "b1", "Workspace B current")]))
    view.rerender(
      <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId="workspace-b">
        <TaskKanbanBoard adapters={[secondAdapter]} />
      </WorkspacePluginClientProvider>,
    )
    expect(await screen.findByText("Workspace B current")).toBeInTheDocument()
    await act(async () => resolveFirst([task("shared", "a1", "Workspace A stale")]))

    await waitFor(() => expect(firstAdapter.listTasks).toHaveBeenCalledOnce())
    expect(screen.queryByText("Workspace A stale")).not.toBeInTheDocument()
    expect(screen.getByText("Workspace B current")).toBeInTheDocument()
  })

  test("never hydrates another Workspace's cached task data", async () => {
    const firstAdapter = adapter("shared", "Shared", vi.fn(async () => [task("shared", "1", "Workspace A secret")]))
    const first = renderBoard([firstAdapter], "workspace-a")
    expect(await screen.findByText("Workspace A secret")).toBeInTheDocument()

    const secondAdapter = adapter("shared", "Shared", vi.fn(async () => []))
    first.rerender(
      <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId="workspace-b">
        <TaskKanbanBoard adapters={[secondAdapter]} />
      </WorkspacePluginClientProvider>,
    )
    expect(screen.queryByText("Workspace A secret")).not.toBeInTheDocument()
    await waitFor(() => expect(secondAdapter.listTasks).toHaveBeenCalled())
    expect(screen.queryByText("Workspace A secret")).not.toBeInTheDocument()
  })

  test("ignores an in-flight mutation after switching Workspaces", async () => {
    const user = userEvent.setup()
    let rejectDelete!: (error: Error) => void
    const deleteResult = new Promise<void>((_resolve, reject) => { rejectDelete = reject })
    const firstAdapter: BoringTaskAdapter = {
      ...adapter("shared", "Shared", vi.fn(async () => [task("shared", "a1", "Workspace A task")])),
      capabilities: { move: false, delete: true },
      deleteTask: vi.fn(async () => await deleteResult),
    }
    const view = renderBoard([firstAdapter], "workspace-a")
    expect(await screen.findByText("Workspace A task")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open actions for a1" }))
    await user.click(screen.getByRole("button", { name: "Delete issue" }))

    const secondAdapter = adapter("shared", "Shared", vi.fn(async () => [task("shared", "b1", "Workspace B task")]))
    view.rerender(
      <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId="workspace-b">
        <TaskKanbanBoard adapters={[secondAdapter]} />
      </WorkspacePluginClientProvider>,
    )
    expect(await screen.findByText("Workspace B task")).toBeInTheDocument()
    rejectDelete(new Error("late Workspace A failure"))

    await waitFor(() => expect(firstAdapter.deleteTask).toHaveBeenCalled())
    expect(screen.queryByText("Workspace A task")).not.toBeInTheDocument()
    expect(screen.getByText("Workspace B task")).toBeInTheDocument()
    expect(screen.queryByText("late Workspace A failure")).not.toBeInTheDocument()
  })

  test("cleans up a refresh invalidated by a later mutation", async () => {
    const user = userEvent.setup()
    let resolveRefresh!: (tasks: ReturnType<typeof task>[]) => void
    let resolveDelete!: () => void
    const listTasks = vi.fn()
      .mockResolvedValueOnce([task("shared", "a1", "Delete during refresh")])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const source: BoringTaskAdapter = {
      ...adapter("shared", "Shared", listTasks),
      capabilities: { move: false, delete: true },
      deleteTask: vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve })),
    }
    renderBoard([source])
    expect(await screen.findByText("Delete during refresh")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await user.click(screen.getByRole("button", { name: "Open actions for a1" }))
    await user.click(screen.getByRole("button", { name: "Delete issue" }))
    resolveRefresh([task("shared", "a1", "Delete during refresh")])
    resolveDelete()

    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled())
    expect(screen.queryByText("Delete during refresh")).not.toBeInTheDocument()
  })

  test("does not let a stale refresh resurrect a successfully deleted task", async () => {
    const user = userEvent.setup()
    let resolveRefresh!: (tasks: ReturnType<typeof task>[]) => void
    let resolveDelete!: () => void
    const listTasks = vi.fn()
      .mockResolvedValueOnce([task("shared", "a1", "Delete me")])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const source: BoringTaskAdapter = {
      ...adapter("shared", "Shared", listTasks),
      capabilities: { move: false, delete: true },
      deleteTask: vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve })),
    }
    renderBoard([source])
    expect(await screen.findByText("Delete me")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open actions for a1" }))
    await user.click(screen.getByRole("button", { name: "Delete issue" }))
    await user.click(screen.getByRole("button", { name: "Refresh" }))

    resolveRefresh([task("shared", "a1", "Delete me")])
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2))
    expect(screen.queryByText("Delete me")).not.toBeInTheDocument()
    resolveDelete()
    await waitFor(() => expect(source.deleteTask).toHaveBeenCalledOnce())
    expect(screen.queryByText("Delete me")).not.toBeInTheDocument()
  })

  test("keeps healthy source tasks visible and retries only the failing source", async () => {
    const user = userEvent.setup()
    let failing = true
    const healthyList = vi.fn(async () => [task("healthy", "1", "Healthy issue")])
    const recoveringList = vi.fn(async () => {
      if (failing) throw new TaskHttpError("TASK_BEADS_TIMEOUT", "Beads read timed out.", true)
      return [task("recovering", "b1", "Recovered bead")]
    })
    const healthy = adapter("healthy", "GitHub", healthyList)
    const recovering = adapter("recovering", "Beads", recoveringList)

    renderBoard([healthy, recovering])

    expect(await screen.findByText("Healthy issue")).toBeInTheDocument()
    expect(await screen.findByText("Beads read timed out.")).toBeInTheDocument()
    failing = false
    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("Recovered bead")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText("Beads read timed out.")).not.toBeInTheDocument())
    expect(healthyList).toHaveBeenCalledTimes(1)
    expect(recoveringList).toHaveBeenCalledTimes(2)
  })

  test("opens plain-text detail accessibly, traps focus, closes on Escape, and returns focus", async () => {
    const user = userEvent.setup()
    let resolveDetail: ((detail: BoringTaskDetail) => void) | undefined
    const getTask = vi.fn(() => new Promise<BoringTaskDetail>((resolve) => { resolveDetail = resolve }))
    const detailed: BoringTaskAdapter = {
      ...adapter("beads", "Beads", async () => [{ ...task("beads", "b1", "Detailed task"), priority: "P1", issueType: "feature" }]),
      capabilities: { move: false, detail: true },
      getTask,
    }
    renderBoard([detailed])

    const trigger = await screen.findByRole("button", { name: "View details for b1" })
    const setDragData = vi.fn()
    fireEvent.dragStart(trigger, { dataTransfer: { setData: setDragData } })
    expect(setDragData).not.toHaveBeenCalled()
    await user.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "Detailed task" })
    expect(dialog).toHaveTextContent("Loading task details")
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    resolveDetail?.(detailFor("beads", "b1", "Literal <strong>text</strong>\nSecond line."))
    expect(await screen.findByText("Literal <strong>text</strong>", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("Keyboard access works.", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("Owner review required.")).toBeInTheDocument()
    expect(screen.getByText("Created by")).toBeInTheDocument()
    expect(screen.getByText("Parent task")).toBeInTheDocument()
    expect(dialog.querySelector("strong")).toBeNull()

    for (let index = 0; index < 4; index += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Detailed task" })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  test("shows loading instead of stale content when another task opens", async () => {
    const user = userEvent.setup()
    let resolveSecond: ((detail: BoringTaskDetail) => void) | undefined
    const getTask = vi.fn()
      .mockResolvedValueOnce(detailFor("beads", "b1", "First task detail."))
      .mockImplementationOnce(() => new Promise<BoringTaskDetail>((resolve) => { resolveSecond = resolve }))
    const detailed: BoringTaskAdapter = {
      ...adapter("beads", "Beads", async () => [task("beads", "b1", "First task"), task("beads", "b2", "Second task")]),
      capabilities: { move: false, detail: true },
      getTask,
    }
    renderBoard([detailed])

    await user.click(await screen.findByRole("button", { name: "View details for b1" }))
    expect(await screen.findByText("First task detail.")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "View details for b2" }))
    expect(screen.getByText("Loading task details")).toBeInTheDocument()
    expect(screen.queryByText("First task detail.")).not.toBeInTheDocument()
    resolveSecond?.(detailFor("beads", "b2", "Second task detail."))
    expect(await screen.findByText("Second task detail.")).toBeInTheDocument()
  })

  test("keeps detail controls in list view and retries typed failures", async () => {
    const user = userEvent.setup()
    const getTask = vi.fn()
      .mockRejectedValueOnce(new TaskHttpError("TASK_BEADS_TIMEOUT", "Beads detail timed out.", true))
      .mockResolvedValueOnce(detailFor("beads", "b1"))
    const detailed: BoringTaskAdapter = {
      ...adapter("beads", "Beads", async () => [task("beads", "b1", "Detailed task")]),
      capabilities: { move: false, detail: true },
      getTask,
    }
    renderBoard([detailed])

    await screen.findByText("Detailed task")
    await user.click(screen.getByRole("button", { name: "Show list view" }))
    await user.click(screen.getByRole("button", { name: "View details for b1" }))
    expect(await screen.findByText("Beads detail timed out.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Full plain-text description.")).toBeInTheDocument()
    expect(getTask).toHaveBeenCalledTimes(2)
  })

  test("retains successful cached source data and labels it stale after refresh failure", async () => {
    const user = userEvent.setup()
    let failing = false
    const beadsList = vi.fn(async () => {
      if (failing) throw new TaskHttpError("TASK_BEADS_COMMAND_FAILED", "Beads read failed.", true)
      return [task("beads", "b1", "Existing bead")]
    })
    const beads = adapter("beads", "Beads", beadsList)

    const first = renderBoard([beads])
    expect(await screen.findByText("Existing bead")).toBeInTheDocument()

    failing = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))

    expect(await screen.findByText("Beads · showing cached data")).toBeInTheDocument()
    expect(screen.getByText("Existing bead")).toBeInTheDocument()

    first.unmount()
    renderBoard([beads])
    expect(await screen.findByText("Existing bead")).toBeInTheDocument()
    expect(screen.getByText("Beads · showing cached data")).toBeInTheDocument()
    await waitFor(() => expect(beadsList).toHaveBeenCalledTimes(3))
  })
})
