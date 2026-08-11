import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, test } from "vitest"

import { WorkspacePluginClientProvider } from "@hachej/boring-workspace"
import type { BoringTaskAdapter, BoringTaskCard } from "../shared"
import { TaskKanbanBoard } from "./TaskKanbanBoard"

const COLUMNS = [
  { id: "open", title: "Open" },
  { id: "in-progress", title: "In progress" },
  { id: "closed", title: "Closed" },
]

function card(id: string, statusId: string, title: string, epic?: { id: string; title: string }, tags?: string[]): BoringTaskCard {
  return { id, number: id, title, statusId, adapterId: "beads", ...(epic ? { epic } : {}), ...(tags ? { tags } : {}) }
}

const TASKS: BoringTaskCard[] = [
  card("bd-1", "open", "Lane worktree pool", { id: "bd-100", title: "Factory migration" }, ["lane"]),
  card("bd-2", "closed", "Lane registry", { id: "bd-100", title: "Factory migration" }),
  card("bd-3", "closed", "Retired spike", { id: "bd-200", title: "Old spike" }),
  card("bd-4", "in-progress", "Unparented chore"),
]

function beadsAdapter(tasks: BoringTaskCard[] = TASKS): BoringTaskAdapter {
  return {
    id: "beads",
    label: "Beads",
    capabilities: { move: false },
    getBoardConfig: async () => ({ adapterId: "beads", columns: COLUMNS }),
    listTasks: async () => tasks,
  }
}

function renderBoard(adapter: BoringTaskAdapter = beadsAdapter(), workspaceId = "epics-test") {
  return render(
    <WorkspacePluginClientProvider agentTypeId="default" apiBaseUrl="" workspaceId={workspaceId}>
      <TaskKanbanBoard adapters={[adapter]} />
    </WorkspacePluginClientProvider>,
  )
}

async function openEpicsView(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Lane worktree pool")
  await user.click(screen.getByRole("button", { name: "Show epics view" }))
}

describe("TaskKanbanBoard epics view", () => {
  beforeEach(() => localStorage.clear())

  test("switches to an epics-first list with per-epic counts and a status breakdown", async () => {
    const user = userEvent.setup()
    renderBoard()
    await openEpicsView(user)

    const epic = screen.getByRole("button", { name: /Factory migration/ })
    expect(epic).toHaveAttribute("aria-expanded", "false")
    expect(epic).toHaveTextContent("bd-100")
    expect(epic).toHaveTextContent("Open1")
    expect(epic).toHaveTextContent("Closed1")
    expect(epic).toHaveTextContent("1/2")
    expect(screen.getByRole("button", { name: /No epic/ })).toBeInTheDocument()
    // Collapsed by default: beads are not rendered until the epic is expanded.
    expect(screen.queryByText("Lane worktree pool")).not.toBeInTheDocument()
  })

  test("hides fully closed epics by default and restores them through the visible toggle", async () => {
    const user = userEvent.setup()
    renderBoard()
    await openEpicsView(user)

    expect(screen.queryByRole("button", { name: /Old spike/ })).not.toBeInTheDocument()
    expect(screen.getByText(/1 fully closed epic \(1 task\) hidden/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "All epics" }))
    expect(screen.getByRole("button", { name: /Old spike/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "All epics" })).toHaveAttribute("aria-pressed", "true")

    await user.click(screen.getByRole("button", { name: "Active epics" }))
    expect(screen.queryByRole("button", { name: /Old spike/ })).not.toBeInTheDocument()
  })

  test("expands and collapses an epic with disclosure semantics wired to its panel", async () => {
    const user = userEvent.setup()
    renderBoard()
    await openEpicsView(user)

    const epic = screen.getByRole("button", { name: /Factory migration/ })
    await user.click(epic)
    expect(epic).toHaveAttribute("aria-expanded", "true")
    const panelId = epic.getAttribute("aria-controls")
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)).not.toBeNull()
    expect(screen.getByText("Lane worktree pool")).toBeInTheDocument()
    expect(screen.getByText("Lane registry")).toBeInTheDocument()

    await user.click(epic)
    expect(epic).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Lane worktree pool")).not.toBeInTheDocument()
  })

  test("is keyboard operable from the view switcher through to a bead", async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByText("Lane worktree pool")
    screen.getByRole("button", { name: "Show epics view" }).focus()
    await user.keyboard("{Enter}")
    const epic = screen.getByRole("button", { name: /Factory migration/ })
    epic.focus()
    await user.keyboard(" ")
    expect(epic).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Lane worktree pool")).toBeInTheDocument()
  })

  test("composes with the epic and tag filters instead of forking the pipeline", async () => {
    const user = userEvent.setup()
    renderBoard()
    await openEpicsView(user)

    await user.selectOptions(screen.getByLabelText("Epic"), "beads:bd-100")
    expect(screen.queryByRole("button", { name: /No epic/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Factory migration/ })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText("Epic"), "all")
    await user.selectOptions(screen.getByLabelText("Tag"), "lane")
    const epic = screen.getByRole("button", { name: /Factory migration/ })
    expect(epic).toHaveTextContent("1/1")
    expect(screen.queryByRole("button", { name: /No epic/ })).not.toBeInTheDocument()
  })

  test("hides beads whose column is switched off, and drops an epic that empties", async () => {
    const user = userEvent.setup()
    renderBoard()
    await openEpicsView(user)

    await user.click(screen.getByRole("button", { name: /^Columns / }))
    await user.click(screen.getByRole("checkbox", { name: /Open/ }))

    // Its only open bead is hidden, so the epic is no longer active — but the
    // toggle label states exactly how much is being withheld.
    expect(screen.queryByRole("button", { name: /Factory migration/ })).not.toBeInTheDocument()
    expect(screen.getByText(/fully closed epic/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "All epics" }))
    const epic = screen.getByRole("button", { name: /Factory migration/ })
    expect(epic).toHaveTextContent("0/1")
    expect(epic).toHaveTextContent("Closed")
  })

  test("persists the epics view selection across a remount", async () => {
    const user = userEvent.setup()
    const first = renderBoard()
    await openEpicsView(user)
    first.unmount()

    renderBoard()
    expect(await screen.findByRole("button", { name: /Factory migration/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Active epics" })).toHaveAttribute("aria-pressed", "true")
  })

  test("opens the shared task detail dialog from a bead inside an epic", async () => {
    const user = userEvent.setup()
    const detailed: BoringTaskAdapter = {
      ...beadsAdapter(),
      capabilities: { move: false, detail: true },
      getTask: async () => ({
        task: TASKS[0] as BoringTaskCard,
        body: "Bead body from the epics view.",
        metadata: [],
        relations: [],
      }),
    }
    renderBoard(detailed)
    await openEpicsView(user)
    await user.click(screen.getByRole("button", { name: /Factory migration/ }))
    await user.click(screen.getByRole("button", { name: "View details for bd-1" }))

    expect(await screen.findByRole("dialog", { name: "Lane worktree pool" })).toBeInTheDocument()
    expect(screen.getByText("Bead body from the epics view.")).toBeInTheDocument()
  })
})
