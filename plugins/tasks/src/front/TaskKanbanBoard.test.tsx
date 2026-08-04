import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { WorkspacePluginClientProvider } from "@hachej/boring-workspace"
import type { BoringTaskAdapter } from "../shared"
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

function renderBoard(adapters: readonly BoringTaskAdapter[]) {
  return render(
    <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId="tasks-test">
      <TaskKanbanBoard adapters={adapters} />
    </WorkspacePluginClientProvider>,
  )
}

describe("TaskKanbanBoard source isolation", () => {
  beforeEach(() => localStorage.clear())

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
