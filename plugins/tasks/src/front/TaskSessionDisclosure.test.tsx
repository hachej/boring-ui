import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard, BoringTaskSessionLink } from "../shared"
import { buildTaskSessionRows, TaskSessionDisclosure, type TaskSessionActivity } from "./TaskSessionDisclosure"

const task: BoringTaskCard = {
  id: "776",
  number: "#776",
  title: "Bind task sessions",
  statusId: "ready-for-agent",
  adapterId: "github:workspace",
}

const link = (id: string, sessionId: string, createdAt: string): BoringTaskSessionLink => ({
  id,
  adapterId: task.adapterId,
  taskId: task.id,
  agentTypeId: "alpha",
  sessionId,
  createdAt,
})

const activity = (sessionId: string, overrides: Partial<TaskSessionActivity> = {}): TaskSessionActivity => ({
  sessionId,
  title: `Session ${sessionId}`,
  updatedAt: "2026-07-19T01:00:00.000Z",
  status: "idle",
  queuedCount: 0,
  hasError: false,
  ...overrides,
})

function shell(overrides: Partial<WorkspaceShellCapabilities> = {}): WorkspaceShellCapabilities {
  return {
    openArtifact: vi.fn(() => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
    openFullChat: vi.fn(() => ({ success: true as const })),
    openInboxItem: vi.fn(() => ({ success: true as const })),
    ...overrides,
  }
}

describe("buildTaskSessionRows", () => {
  it("orders available activity first and applies Working > Queued > Error > Idle", () => {
    const links = [
      link("unavailable", "missing", "2026-07-19T04:00:00.000Z"),
      link("queued", "queued", "2026-07-19T02:00:00.000Z"),
      link("working", "working", "2026-07-19T01:00:00.000Z"),
      link("error", "error", "2026-07-19T03:00:00.000Z"),
    ]
    const rows = buildTaskSessionRows(links, [
      activity("queued", { updatedAt: "2026-07-19T02:00:00.000Z", queuedCount: 1, hasError: true }),
      activity("working", { updatedAt: "2026-07-19T05:00:00.000Z", status: "streaming", queuedCount: 1, hasError: true }),
      activity("error", { updatedAt: "2026-07-19T03:00:00.000Z", status: "error", hasError: true }),
    ], ["missing"])

    expect(rows.map((row) => [row.link.id, row.status, row.available])).toEqual([
      ["working", "Working", true],
      ["error", "Error", true],
      ["queued", "Queued", true],
      ["unavailable", "Idle", false],
    ])
  })
})

describe("TaskSessionDisclosure", () => {
  it("loads lazily, opens exact sessions, and unlinks without deleting transcripts", async () => {
    const user = userEvent.setup()
    const storedLink = link("link-1", "native-exact", "2026-07-19T01:00:00.000Z")
    const outputArtifacts = Array.from({ length: 11 }, (_, index) => ({ id: `artifact-${index + 1}`, surfaceKind: "workspace.open.path", target: `docs/${index + 1}.md`, title: `Artifact ${index + 1}` }))
    const postJson = vi.fn(async (path: string) => {
      if (path.endsWith("/sessions/activity")) return { sessions: [activity("native-exact", { title: "Exact work" })], omittedSessionIds: [] }
      if (path.endsWith("/sessions/handovers")) return { ok: true, matches: [{ sessionId: "native-exact", handover: { id: "handover:latest", runId: "run", terminalEntryId: "latest", artifacts: outputArtifacts } }], omittedSessionIds: [] }
      if (path.endsWith("/sessions/unlink")) return { ok: true, link: storedLink }
      throw new Error(`unexpected path ${path}`)
    })
    const shellCapabilities = shell({
      openArtifact: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "surface unavailable" })),
    })
    vi.spyOn(window, "confirm").mockReturnValue(true)

    const { rerender } = render(<TaskSessionDisclosure
      task={task}
      shell={shellCapabilities}
      pluginClient={{
        postJson: postJson as unknown as WorkspacePluginClient["postJson"],
        getJson: vi.fn(async () => ({ summary: { title: "Exact work", updatedAt: Date.parse("2026-07-19T01:00:00.000Z") }, state: { status: "idle", queue: { followUps: [{}] } } })) as WorkspacePluginClient["getJson"],
      }}
      sessionLinks={[storedLink]}
    />)

    const sessionsToggle = screen.getByRole("button", { name: "1 session" })
    expect(sessionsToggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Exact work")).not.toBeInTheDocument()
    expect(postJson).not.toHaveBeenCalled()
    await user.click(sessionsToggle)
    expect(await screen.findByRole("button", { name: "1 session" })).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("Exact work")).toBeInTheDocument()
    expect(screen.getByText("Queued")).toBeInTheDocument()
    expect(postJson.mock.calls.filter(([path]) => path.endsWith("/sessions/list"))).toHaveLength(0)
    expect(postJson.mock.calls.filter(([path]) => path.endsWith("/sessions/handovers"))).toHaveLength(1)
    await user.click(sessionsToggle)
    expect(screen.queryByText("Exact work")).not.toBeInTheDocument()
    await user.click(sessionsToggle)
    expect(screen.getByText("Exact work")).toBeInTheDocument()
    expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument()
    expect(postJson.mock.calls.filter(([path]) => path.endsWith("/sessions/list"))).toHaveLength(0)
    expect(postJson.mock.calls.filter(([path]) => path.endsWith("/sessions/handovers"))).toHaveLength(1)
    expect(screen.getAllByRole("listitem")).toHaveLength(10)
    expect(screen.getByRole("button", { name: "Show 1 more" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open Artifact 1" }))
    expect(shellCapabilities.openArtifact).toHaveBeenCalledWith({ type: "surface", surfaceKind: "workspace.open.path", target: "docs/1.md" }, expect.objectContaining({ sessionId: "native-exact" }))
    expect(screen.getByLabelText("Artifact 1 unavailable")).toHaveTextContent("Unavailable")
    expect(shellCapabilities.openDetachedChat).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Open Exact work in popover" })).not.toHaveClass("hidden")
    expect(screen.queryByRole("menuitem", { name: "Open Exact work in full chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Unlink session from #776" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open Exact work in popover" }))
    expect(shellCapabilities.openDetachedChat).toHaveBeenCalledWith({ agentTypeId: "alpha", sessionId: "native-exact" }, expect.objectContaining({ title: "Exact work" }))
    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    expect(screen.getByRole("menuitem", { name: "Open Exact work in full chat" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menuitem", { name: "Open Exact work in full chat" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    await user.click(screen.getByRole("menuitem", { name: "Open Exact work in full chat" }))
    expect(shellCapabilities.openFullChat).toHaveBeenCalledWith({ agentTypeId: "alpha", sessionId: "native-exact" })

    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    await user.click(screen.getByRole("menuitem", { name: "Unlink session from #776" }))
    expect(window.confirm).toHaveBeenCalledWith("Unlink this chat from #776? The transcript will be kept.")
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/unlink", { linkId: "link-1" })
    rerender(<TaskSessionDisclosure
      task={task}
      shell={shellCapabilities}
      pluginClient={{
        postJson: postJson as unknown as WorkspacePluginClient["postJson"],
        getJson: vi.fn(async () => ({ summary: { title: "Exact work", updatedAt: Date.parse("2026-07-19T01:00:00.000Z") }, state: { status: "idle", queue: { followUps: [{}] } } })) as WorkspacePluginClient["getJson"],
      }}
      sessionLinks={[]}
    />)
    await waitFor(() => expect(screen.getByRole("button", { name: "0 sessions" })).toBeInTheDocument())
  })

  it("keeps only the session menu opened in the exact task disclosure", async () => {
    const user = userEvent.setup()
    const secondTask = { ...task, id: "777", number: "#777", title: "Second task" }
    const firstLink = link("link-first", "native-first", "2026-07-19T01:00:00.000Z")
    const secondLink = { ...link("link-second", "native-second", "2026-07-19T02:00:00.000Z"), taskId: secondTask.id }
    const postJson = vi.fn(async (path: string, body: unknown) => {
      const taskId = (body as { taskId?: string }).taskId
      if (path.endsWith("/sessions/handovers")) return { ok: true, matches: [], omittedSessionIds: [] }
      const sessionIds = (body as { sessionIds?: string[] }).sessionIds ?? []
      return { sessions: sessionIds.map((sessionId) => activity(sessionId, { title: sessionId === "native-second" ? "Second work" : "First work" })), omittedSessionIds: [] }
    })
    const client = {
      postJson: postJson as unknown as WorkspacePluginClient["postJson"],
      getJson: vi.fn(async (path: string) => ({
        summary: { title: path.includes("native-second") ? "Second work" : "First work", updatedAt: "2026-07-19T01:00:00.000Z" },
        state: { status: "idle", queuedMessages: [] },
      })) as WorkspacePluginClient["getJson"],
    }

    render(<>
      <TaskSessionDisclosure task={task} shell={shell()} pluginClient={client} sessionLinks={[firstLink]} />
      <TaskSessionDisclosure task={secondTask} shell={shell()} pluginClient={client} sessionLinks={[secondLink]} />
    </>)
    const toggles = screen.getAllByRole("button", { name: "1 session" })
    await user.click(toggles[0]!)
    await user.click(toggles[1]!)
    await screen.findByText("First work")
    await screen.findByText("Second work")

    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    expect(screen.getByRole("menuitem", { name: "Open First work in full chat" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Open session actions for #777" }))
    expect(screen.queryByRole("menuitem", { name: "Open First work in full chat" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Open Second work in full chat" })).toBeInTheDocument()
  })

  it("renders denied activity as unavailable and fails closed through addressed shell capabilities", async () => {
    const user = userEvent.setup()
    const unavailable = link("link-old", "native-denied", "2026-07-19T01:00:00.000Z")
    const available = link("link-new", "native-open", "2026-07-19T02:00:00.000Z")
    const postJson = vi.fn(async (path: string) => path.endsWith("/sessions/handovers")
      ? { ok: true, matches: [], omittedSessionIds: ["native-denied"] }
      : { sessions: [activity("native-open", { title: "Open work" })], omittedSessionIds: ["native-denied"] })
    const shellCapabilities = shell({
      openDetachedChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "disconnected context" })),
      openFullChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "disconnected context" })),
    })

    render(<TaskSessionDisclosure
      task={task}
      shell={shellCapabilities}
      pluginClient={{
        postJson: postJson as unknown as WorkspacePluginClient["postJson"],
        getJson: vi.fn(async (path: string) => {
          if (path.includes("native-denied")) throw new Error("forbidden")
          return { summary: { title: "Open work", updatedAt: Date.parse("2026-07-19T02:00:00.000Z") }, state: { status: "idle", queue: { followUps: [] } } }
        }) as WorkspacePluginClient["getJson"],
      }}
      sessionLinks={[unavailable, available]}
    />)
    await user.click(screen.getByRole("button", { name: "2 sessions" }))
    expect(screen.getByRole("button", { name: "2 sessions" })).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("Unavailable session")).toBeInTheDocument()
    expect(screen.queryByText("Session native-denied")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open Open work in popover" }))
    expect(shellCapabilities.openDetachedChat).toHaveBeenCalledWith(
      { agentTypeId: "alpha", sessionId: "native-open" },
      expect.objectContaining({ title: "Open work" }),
    )
    await user.click(screen.getAllByRole("button", { name: "Open session actions for #776" })[0]!)
    await user.click(screen.getByRole("menuitem", { name: "Open Open work in full chat" }))
    expect(shellCapabilities.openFullChat).toHaveBeenCalledWith({ agentTypeId: "alpha", sessionId: "native-open" })
  })
})
