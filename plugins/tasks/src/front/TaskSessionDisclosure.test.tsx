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
    openBrowserLocalDetachedChat: vi.fn(() => ({ success: true as const })),
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
      if (path.endsWith("/sessions/list")) return { ok: true, links: [storedLink] }
      if (path.endsWith("/sessions/activity")) return { sessions: [activity("native-exact", { title: "Exact work" })], omittedSessionIds: [] }
      if (path.endsWith("/sessions/handovers")) return { ok: true, matches: [{ sessionId: "native-exact", handover: { id: "handover:latest", runId: "run", terminalEntryId: "latest", artifacts: outputArtifacts } }], omittedSessionIds: [] }
      if (path.endsWith("/sessions/unlink")) return { ok: true, link: storedLink }
      throw new Error(`unexpected path ${path}`)
    })
    const shellCapabilities = shell({
      openArtifact: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "surface unavailable" })),
    })
    vi.spyOn(window, "confirm").mockReturnValue(true)

    render(<TaskSessionDisclosure
      task={task}
      shell={shellCapabilities}
      pluginClient={{ postJson: postJson as unknown as WorkspacePluginClient["postJson"] }}
    />)

    expect(await screen.findByRole("button", { name: "1 session" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Exact work")).not.toBeInTheDocument()
    expect(postJson.mock.calls.some(([path]) => String(path).endsWith("/sessions/handovers"))).toBe(false)
    await user.click(screen.getByRole("button", { name: "1 session" }))
    expect(await screen.findByText("Exact work")).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(10)
    expect(screen.getByRole("button", { name: "Show 1 more" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open Artifact 1" }))
    expect(shellCapabilities.openArtifact).toHaveBeenCalledWith({ type: "surface", surfaceKind: "workspace.open.path", target: "docs/1.md" }, expect.objectContaining({ sessionId: "native-exact" }))
    expect(screen.getByLabelText("Artifact 1 unavailable")).toHaveTextContent("Unavailable")
    expect(shellCapabilities.openDetachedChat).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Open Exact work in popover" })).not.toHaveClass("hidden")
    expect(screen.queryByRole("button", { name: "Open Exact work in full chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Unlink session from #776" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open Exact work in popover" }))
    expect(shellCapabilities.openDetachedChat).toHaveBeenCalledWith("native-exact", expect.objectContaining({ title: "Exact work" }))
    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    expect(screen.getByRole("button", { name: "Open Exact work in full chat" })).toBeInTheDocument()
    await user.click(screen.getByText("Exact work"))
    expect(screen.queryByRole("button", { name: "Open Exact work in full chat" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    await user.click(screen.getByRole("button", { name: "Open Exact work in full chat" }))
    expect(shellCapabilities.openFullChat).toHaveBeenCalledWith("native-exact")
    expect(shellCapabilities.openBrowserLocalDetachedChat).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    await user.click(screen.getByRole("button", { name: "Unlink session from #776" }))
    expect(window.confirm).toHaveBeenCalledWith("Unlink this chat from #776? The transcript will be kept.")
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/unlink", { linkId: "link-1" })
    await waitFor(() => expect(screen.getByRole("button", { name: "0 sessions" })).toBeInTheDocument())
  })

  it("keeps only the session menu opened in the exact task disclosure", async () => {
    const user = userEvent.setup()
    const secondTask = { ...task, id: "777", number: "#777", title: "Second task" }
    const firstLink = link("link-first", "native-first", "2026-07-19T01:00:00.000Z")
    const secondLink = { ...link("link-second", "native-second", "2026-07-19T02:00:00.000Z"), taskId: secondTask.id }
    const postJson = vi.fn(async (path: string, body: unknown) => {
      const taskId = (body as { taskId?: string }).taskId
      if (path.endsWith("/sessions/list")) return { ok: true, links: taskId === secondTask.id ? [secondLink] : [firstLink] }
      if (path.endsWith("/sessions/handovers")) return { ok: true, matches: [], omittedSessionIds: [] }
      const sessionIds = (body as { sessionIds?: string[] }).sessionIds ?? []
      return { sessions: sessionIds.map((sessionId) => activity(sessionId, { title: sessionId === "native-second" ? "Second work" : "First work" })), omittedSessionIds: [] }
    })
    const client = { postJson: postJson as unknown as WorkspacePluginClient["postJson"] }

    render(<>
      <TaskSessionDisclosure task={task} shell={shell()} pluginClient={client} />
      <TaskSessionDisclosure task={secondTask} shell={shell()} pluginClient={client} />
    </>)
    const toggles = await screen.findAllByRole("button", { name: "1 session" })
    await user.click(toggles[0]!)
    await user.click(toggles[1]!)
    await screen.findByText("First work")
    await screen.findByText("Second work")

    await user.click(screen.getByRole("button", { name: "Open session actions for #776" }))
    expect(screen.getByRole("button", { name: "Open First work in full chat" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open session actions for #777" }))
    expect(screen.queryByRole("button", { name: "Open First work in full chat" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open Second work in full chat" })).toBeInTheDocument()
  })

  it("renders denied activity as unavailable and falls back to validated host events", async () => {
    const user = userEvent.setup()
    const { sessionId: _redactedSessionId, ...unavailable } = link("link-old", "native-denied", "2026-07-19T01:00:00.000Z")
    const available = link("link-new", "native-open", "2026-07-19T02:00:00.000Z")
    const postJson = vi.fn(async (path: string) => path.endsWith("/sessions/list")
      ? { ok: true, links: [unavailable, available] }
      : path.endsWith("/sessions/handovers")
        ? { ok: true, matches: [], omittedSessionIds: ["native-open"] }
        : { sessions: [activity("native-open", { title: "Open work" })], omittedSessionIds: [] })
    const dispatch = vi.spyOn(window, "dispatchEvent")
    const shellCapabilities = shell({
      openDetachedChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "disconnected context" })),
      openFullChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "disconnected context" })),
    })

    render(<TaskSessionDisclosure
      task={task}
      shell={shellCapabilities}
      pluginClient={{ postJson: postJson as unknown as WorkspacePluginClient["postJson"] }}
    />)
    await user.click(await screen.findByRole("button", { name: "2 sessions" }))
    expect(await screen.findByText("Unavailable session")).toBeInTheDocument()
    expect(screen.queryByText("Session native-denied")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open Open work in popover" }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "boring-workspace:open-detached-chat" }))
    await user.click(screen.getAllByRole("button", { name: "Open session actions for #776" })[0]!)
    await user.click(screen.getByRole("button", { name: "Open Open work in full chat" }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "boring-workspace:open-full-chat" }))
    dispatch.mockRestore()
  })
})
