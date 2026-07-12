// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BoringTaskCard, BoringTaskSessionBinding } from "../shared"
import { TaskCard } from "./TaskCard"
import { TaskSessionActivityProvider } from "./taskSessionActivity"

const postJson = vi.fn()
const getJson = vi.fn()
const openDetachedChat = vi.fn()
const pluginClient = { postJson, getJson }

vi.mock("@hachej/boring-workspace", () => ({
  useWorkspacePluginClient: () => pluginClient,
}))

vi.mock("@hachej/boring-workspace/plugin", () => ({
  useWorkspaceShellCapabilities: () => ({ openArtifact: vi.fn(), openDetachedChat }),
}))

interface TaskSessionListResponse { links?: BoringTaskSessionBinding[] }

const task: BoringTaskCard = {
  id: "task-1",
  number: "#612",
  title: "Wire sessions",
  statusId: "ready",
  adapterId: "github",
}

function renderCard() {
  return render(<TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
}

function link(overrides: Partial<BoringTaskSessionBinding> = {}): BoringTaskSessionBinding {
  return {
    id: "link-1",
    workspaceId: "workspace-a",
    adapterId: "github",
    taskId: "task-1",
    sessionId: "pi-1",
    title: "#612: Wire sessions",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  postJson.mockReset()
  getJson.mockReset()
  openDetachedChat.mockReset()
})

describe("TaskCard task chat sessions", () => {
  it("orders active sessions by priority, then all non-active sessions by recency", async () => {
    const workingOld = link({ id: "working-old", sessionId: "pi-working-old", title: "Working old", createdAt: "2026-07-01T00:00:00.000Z" })
    const workingNew = link({ id: "working-new", sessionId: "pi-working-new", title: "Working new", createdAt: "2026-07-01T00:00:00.000Z" })
    const queued = link({ id: "queued", sessionId: "pi-queued", title: "Queued", createdAt: "2026-07-04T00:00:00.000Z" })
    const errored = link({ id: "error", sessionId: "pi-error", title: "Errored", createdAt: "2026-07-05T00:00:00.000Z" })
    const idle = link({ id: "idle", sessionId: "pi-idle", title: "Idle", createdAt: "2026-07-06T00:00:00.000Z" })
    const missing = link({ id: "missing", sessionId: "pi-missing", title: "Missing", createdAt: "2026-07-10T00:00:00.000Z" })
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [idle, missing, errored, queued, workingOld, workingNew] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return {
        activities: [
          { sessionId: "pi-working-old", status: "working", source: "live-runtime", updatedAt: "2026-07-02T00:00:00.000Z" },
          { sessionId: "pi-working-new", status: "working", source: "live-runtime", updatedAt: "2026-07-03T00:00:00.000Z" },
          { sessionId: "pi-queued", status: "queued", source: "live-runtime", updatedAt: "2026-07-07T00:00:00.000Z" },
          { sessionId: "pi-error", status: "error", source: "live-runtime", updatedAt: "2026-07-08T00:00:00.000Z" },
          { sessionId: "pi-idle", status: "idle", source: "persisted", updatedAt: "2026-07-09T00:00:00.000Z" },
        ],
        omittedSessionIds: ["pi-missing"],
      }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    expect(await screen.findByLabelText("2 working linked chats")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))

    const rows = await screen.findAllByRole("listitem")
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Working new"), expect.stringContaining("Working old"), expect.stringContaining("Queued"), expect.stringContaining("Missing"), expect.stringContaining("Idle"), expect.stringContaining("Errored")]))
    expect(rows[0]).toHaveTextContent("Working new")
    expect(rows[1]).toHaveTextContent("Working old")
    expect(rows[2]).toHaveTextContent("Queued")
    expect(rows[3]).toHaveTextContent("Missing")
    expect(rows[4]).toHaveTextContent("Idle")
    expect(rows[5]).toHaveTextContent("Errored")
  })

  it("opens the one working linked session directly and keeps persisted standalone sessions idle", async () => {
    const working = link({ id: "link-working", sessionId: "pi-working", title: "Working chat" })
    const standalone = link({ id: "link-standalone", sessionId: "pi-standalone", title: "Standalone chat" })
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [standalone, working] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return {
        activities: [
          { sessionId: "pi-working", status: "working", source: "live-runtime", updatedAt: "2026-07-03T00:00:00.000Z" },
          { sessionId: "pi-standalone", status: "idle", source: "persisted", updatedAt: "2026-07-04T00:00:00.000Z" },
        ],
        omittedSessionIds: [],
      }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-working", title: "Working chat" }])

    renderCard()
    expect(await screen.findByLabelText("1 working linked chats")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /1 working/i }))

    await waitFor(() => expect(openDetachedChat).toHaveBeenCalledWith("pi-working", expect.objectContaining({ title: "Working chat" })))
    expect(screen.queryByRole("region", { name: /linked chat sessions/i })).not.toBeInTheDocument()
  })

  it("merges action refreshes without erasing other linked activity statuses", async () => {
    const workingA = link({ id: "working-a", sessionId: "pi-working-a", title: "Working A" })
    const workingB = link({ id: "working-b", sessionId: "pi-working-b", title: "Working B" })
    postJson.mockImplementation(async (path: string, body: { sessionIds?: string[] }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [workingA, workingB] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") {
        const ids = body.sessionIds ?? []
        if (ids.length === 1) return { activities: [{ sessionId: ids[0], status: "idle", source: "persisted" }], omittedSessionIds: [] }
        return {
          activities: ids.map((sessionId) => ({ sessionId, status: "working", source: "live-runtime" })),
          omittedSessionIds: [],
        }
      }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-working-a", title: "Working A" }, { id: "pi-working-b", title: "Working B" }])

    renderCard()
    expect(await screen.findByLabelText("2 working linked chats")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /2 working/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0])

    await waitFor(() => expect(openDetachedChat).toHaveBeenCalled())
    expect(await screen.findByLabelText("1 working linked chats")).toBeInTheDocument()
  })

  it("uses error semantics without emerald active styling and opens one queued session as active", async () => {
    const errored = link({ id: "errored", sessionId: "pi-error", title: "Errored" })
    const queued = link({ id: "queued", sessionId: "pi-queued", title: "Queued" })
    postJson.mockImplementation(async (path: string, body: { sessionIds?: string[] }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [errored, queued] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return {
        activities: (body.sessionIds ?? []).map((sessionId) => ({
          sessionId,
          status: sessionId === "pi-error" ? "error" : "queued",
          source: "live-runtime",
        })),
        omittedSessionIds: [],
      }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-queued", title: "Queued" }])

    const firstRender = renderCard()
    const activeBadge = await screen.findByLabelText("1 active linked chats")
    expect(activeBadge).toHaveClass("bg-emerald-500")
    expect(screen.queryByLabelText("2 active linked chats")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /queued/i }))
    await waitFor(() => expect(openDetachedChat).toHaveBeenCalledWith("pi-queued", expect.objectContaining({ title: "Queued" })))

    firstRender.unmount()
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [errored] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return { activities: [{ sessionId: "pi-error", status: "error", source: "live-runtime" }], omittedSessionIds: [] }
      throw new Error(`unexpected post ${path}`)
    })
    openDetachedChat.mockReset()
    renderCard()
    const errorBadge = await screen.findByLabelText("1 linked chats need attention")
    expect(errorBadge).toHaveClass("bg-destructive")
    expect(screen.queryByLabelText("1 active linked chats")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /need attention/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("keeps native keyboard focus on the disclosure trigger and uses motion-safe activity animation", async () => {
    const working = link({ id: "working", sessionId: "pi-working", title: "Working" })
    const workingSecond = link({ id: "working-second", sessionId: "pi-working-second", title: "Working second" })
    const queued = link({ id: "queued", sessionId: "pi-queued", title: "Queued" })
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [working, workingSecond, queued] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return {
        activities: [
          { sessionId: "pi-working", status: "working", source: "live-runtime" },
          { sessionId: "pi-working-second", status: "working", source: "live-runtime" },
          { sessionId: "pi-queued", status: "queued", source: "live-runtime" },
        ],
        omittedSessionIds: [],
      }
      throw new Error(`unexpected post ${path}`)
    })

    const { container } = renderCard()
    const trigger = await screen.findByRole("button", { name: /open chat.*working/i })
    expect(trigger).toHaveAttribute("type", "button")
    trigger.focus()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    const close = await screen.findByRole("button", { name: "Close task chats" })
    expect(container.querySelector("[class*='motion-safe:animate-pulse']")).toBeInTheDocument()
    expect(container.querySelector("[class*='motion-safe:animate-pulse']")?.classList.contains("animate-pulse")).toBe(false)
    close.focus()
    fireEvent.click(close)
    expect(trigger).toHaveFocus()
  })

  it("ignores arbitrary standalone status events and waits for authoritative activity", async () => {
    vi.useFakeTimers()
    const standalone = link({ id: "standalone", sessionId: "pi-standalone", title: "Standalone Pi" })
    let activityCalls = 0
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [standalone] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") {
        activityCalls += 1
        return { activities: [{ sessionId: "pi-standalone", status: "idle", source: "persisted" }], omittedSessionIds: [] }
      }
      throw new Error(`unexpected post ${path}`)
    })

    try {
      renderCard()
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      await act(async () => { await vi.advanceTimersByTimeAsync(25) })
      expect(activityCalls).toBe(1)
      expect(screen.getByLabelText("1 linked chats")).toBeInTheDocument()
      await act(async () => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", { detail: { sessionId: "pi-standalone", working: true } }))
      })
      expect(screen.getByLabelText("1 linked chats")).toBeInTheDocument()
      expect(screen.queryByLabelText("1 working linked chats")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("opens the linked-session panel immediately with pending feedback while activity refresh is in flight", async () => {
    const existing = link()
    const pendingActivity = deferred<{ activities?: []; omittedSessionIds?: string[] }>()
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [existing] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return pendingActivity.promise
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))

    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    expect(await screen.findByText("Checking chat activity…")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: /checking activity/i })).toHaveAttribute("aria-busy", "true"))

    await act(async () => {
      pendingActivity.resolve({ activities: [], omittedSessionIds: ["pi-1"] })
      await pendingActivity.promise
    })
  })

  it("does not navigate when open activity resolves after the session panel closes", async () => {
    const working = link({ id: "working", sessionId: "pi-working", title: "Working chat" })
    const pendingActivity = deferred<{ activities?: Array<{ sessionId: string; status: "idle" | "queued" | "working" | "error"; source: "live-runtime" | "persisted" }>; omittedSessionIds?: string[] }>()
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [working] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return pendingActivity.promise
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-working", title: "Working chat" }])

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close task chats" }))

    await act(async () => {
      pendingActivity.resolve({ activities: [{ sessionId: "pi-working", status: "working", source: "live-runtime" }], omittedSessionIds: [] })
      await pendingActivity.promise
      await Promise.resolve()
    })

    expect(getJson).not.toHaveBeenCalled()
    expect(openDetachedChat).not.toHaveBeenCalled()
    expect(screen.queryByRole("region", { name: /linked chat sessions/i })).not.toBeInTheDocument()
  })

  it("does not navigate when open activity resolves after the card unmounts", async () => {
    const working = link({ id: "working", sessionId: "pi-working", title: "Working chat" })
    const pendingActivity = deferred<{ activities?: Array<{ sessionId: string; status: "idle" | "queued" | "working" | "error"; source: "live-runtime" | "persisted" }>; omittedSessionIds?: string[] }>()
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [working] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return pendingActivity.promise
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-working", title: "Working chat" }])

    const { unmount } = renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    unmount()

    await act(async () => {
      pendingActivity.resolve({ activities: [{ sessionId: "pi-working", status: "working", source: "live-runtime" }], omittedSessionIds: [] })
      await pendingActivity.promise
      await Promise.resolve()
    })

    expect(getJson).not.toHaveBeenCalled()
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("opens from an action refresh even when a later board poll overlaps", async () => {
    vi.useFakeTimers()
    const working = link({ id: "working", sessionId: "pi-working", title: "Working chat" })
    const activityRequests: Array<{ sessionIds: string[]; request: ReturnType<typeof deferred<{ activities?: Array<{ sessionId: string; status: "idle" | "queued" | "working" | "error"; source: "live-runtime" | "persisted" }>; omittedSessionIds?: string[] }>> }> = []
    postJson.mockImplementation((path: string, body: { sessionIds?: string[] }) => {
      if (path === "/api/boring-tasks/sessions/list") return Promise.resolve({ links: [working] })
      if (path === "/api/v1/agent/pi-chat/sessions/activity") {
        const request = deferred<{ activities?: Array<{ sessionId: string; status: "idle" | "queued" | "working" | "error"; source: "live-runtime" | "persisted" }>; omittedSessionIds?: string[] }>()
        activityRequests.push({ sessionIds: body.sessionIds ?? [], request })
        return request.promise
      }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-working", title: "Working chat" }])

    try {
      renderCard()
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      await act(async () => { vi.advanceTimersByTime(25); await Promise.resolve() })
      expect(activityRequests.map((entry) => entry.sessionIds)).toEqual([["pi-working"]])
      await act(async () => {
        activityRequests[0].request.resolve({ activities: [{ sessionId: "pi-working", status: "working", source: "live-runtime" }], omittedSessionIds: [] })
        await activityRequests[0].request.promise
        await Promise.resolve()
      })
      expect(screen.getByLabelText("1 working linked chats")).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: /1 working/i }))
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(activityRequests).toHaveLength(2)
      await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve() })
      expect(activityRequests).toHaveLength(3)

      await act(async () => {
        activityRequests[1].request.resolve({ activities: [{ sessionId: "pi-working", status: "working", source: "live-runtime" }], omittedSessionIds: [] })
        await activityRequests[1].request.promise
        await Promise.resolve()
      })

      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(openDetachedChat).toHaveBeenCalledWith("pi-working", expect.objectContaining({ title: "Working chat" }))
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()

      await act(async () => {
        activityRequests[2].request.resolve({ activities: [{ sessionId: "pi-working", status: "idle", source: "persisted" }], omittedSessionIds: [] })
        await activityRequests[2].request.promise
        await Promise.resolve()
      })
      expect(openDetachedChat).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps session-list failure visible and blocks creating duplicate chats until retry succeeds", async () => {
    let listMode: "fail" | "empty" = "fail"
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") {
        if (listMode === "fail") throw new Error("session list down")
        return { links: [] }
      }
      if (path === "/api/v1/agent/pi-chat/sessions") return { id: "pi-new" }
      if (path === "/api/boring-tasks/sessions/link") return { link: link({ id: "link-new", sessionId: "pi-new" }) }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return { activities: [{ sessionId: "pi-new", status: "idle", source: "persisted" }], omittedSessionIds: [] }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /chat links unavailable/i }))

    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Linked chat sessions failed to load.")
    expect(screen.queryByText("No linked chats yet.")).not.toBeInTheDocument()
    const startNew = screen.getByRole("button", { name: "Start new chat" })
    expect(startNew).toBeDisabled()
    fireEvent.click(startNew)
    expect(postJson.mock.calls.filter(([path]) => path === "/api/v1/agent/pi-chat/sessions")).toHaveLength(0)

    listMode = "empty"
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(screen.getByText("No linked chats yet.")).toBeInTheDocument()
    expect(startNew).not.toBeDisabled()
    fireEvent.click(startNew)

    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/v1/agent/pi-chat/sessions", { title: "#612: Wire sessions" }))
  })

  it("does not reopen the session panel when a retry fails after close", async () => {
    const retryList = deferred<TaskSessionListResponse>()
    let listCalls = 0
    postJson.mockImplementation((path: string) => {
      if (path === "/api/boring-tasks/sessions/list") {
        listCalls += 1
        if (listCalls <= 2) return Promise.reject(new Error("session list down"))
        return retryList.promise
      }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /chat links unavailable/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    fireEvent.click(screen.getByRole("button", { name: "Close task chats" }))

    await act(async () => {
      retryList.reject(new Error("retry failed late"))
      await retryList.promise.catch(() => undefined)
      await Promise.resolve()
    })

    expect(screen.queryByRole("region", { name: /linked chat sessions/i })).not.toBeInTheDocument()
  })

  it("keeps the disclosure open on activity failure, supports retry, and shows missing activity", async () => {
    const existing = link()
    let mode: "fail" | "missing" = "fail"
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [existing] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") {
        if (mode === "fail") throw new Error("activity down")
        return { activities: [], omittedSessionIds: ["pi-1"] }
      }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    expect(screen.getByText("Activity refresh failed.")).toBeInTheDocument()

    mode = "missing"
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Activity unavailable")).toBeInTheDocument()
  })

  it("keeps activity retry errors scoped to the task sessions that failed", async () => {
    const taskA = { ...task, id: "task-a", number: "#613A", title: "Task A" }
    const taskB = { ...task, id: "task-b", number: "#613B", title: "Task B" }
    const linkA = link({ id: "link-a", taskId: "task-a", sessionId: "pi-a", title: "Chat A" })
    const linkB = link({ id: "link-b", taskId: "task-b", sessionId: "pi-b", title: "Chat B" })
    postJson.mockImplementation(async (path: string, body: { taskId?: string; sessionIds?: string[] }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: body.taskId === "task-b" ? [linkB] : [linkA] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") {
        const ids = body.sessionIds ?? []
        if (ids.includes("pi-a")) throw new Error("A activity down")
        return { activities: ids.map((sessionId) => ({ sessionId, status: "idle", source: "persisted" })), omittedSessionIds: [] }
      }
      throw new Error(`unexpected post ${path}`)
    })

    render(
      <TaskSessionActivityProvider>
        <TaskCard task={taskA} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />
        <TaskCard task={taskB} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />
      </TaskSessionActivityProvider>,
    )

    const triggers = await screen.findAllByRole("button", { name: /open chat/i })
    fireEvent.click(triggers[0])
    expect(await screen.findByText("Activity refresh failed.")).toBeInTheDocument()

    fireEvent.click(triggers[1])
    await waitFor(() => expect(screen.getAllByRole("region", { name: /linked chat sessions/i })).toHaveLength(2))
    expect(screen.getAllByText("Activity refresh failed.")).toHaveLength(1)
    expect(screen.getByText("Chat A").closest("section")).toHaveTextContent("Activity refresh failed.")
    expect(screen.getByText("Chat B").closest("section")).not.toHaveTextContent("Activity refresh failed.")
  })

  it("rolls up authoritative idle ahead of unavailable activity", async () => {
    const idle = link({ id: "idle", sessionId: "pi-idle", title: "Idle chat" })
    const missing = link({ id: "missing", sessionId: "pi-missing", title: "Missing chat" })
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [missing, idle] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return {
        activities: [{ sessionId: "pi-idle", status: "idle", source: "persisted" }],
        omittedSessionIds: ["pi-missing"],
      }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    const trigger = await screen.findByRole("button", { name: /Idle/i })
    expect(trigger).toBeInTheDocument()
    expect(screen.queryByText("Activity unavailable")).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(await screen.findByText("Idle")).toBeInTheDocument()
    expect(await screen.findByText("Activity unavailable")).toBeInTheDocument()
  })

  it("covers every linked session through bounded chunks and rolls up activity beyond the first chunk", async () => {
    const manyLinks = Array.from({ length: 101 }, (_, index) => link({ id: `link-${index}`, sessionId: `pi-${index}`, title: `Chat ${index}` }))
    const activityRequests: string[][] = []
    postJson.mockImplementation(async (path: string, body: { sessionIds?: string[] }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: manyLinks }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") {
        const ids = body.sessionIds ?? []
        activityRequests.push(ids)
        return { activities: ids.includes("pi-100") ? [{ sessionId: "pi-100", status: "working", source: "live-runtime" }] : [], omittedSessionIds: [] }
      }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    expect(await screen.findByLabelText("1 working linked chats")).toBeInTheDocument()
    expect(activityRequests).toHaveLength(2)
    expect(activityRequests.map((ids) => ids.length)).toEqual([100, 1])
    expect(activityRequests[1]).toEqual(["pi-100"])
  })

  it("does not erase a shared session's activity from another task after unlink", async () => {
    const sharedA = link({ id: "shared-a", taskId: "task-1", sessionId: "pi-shared", title: "Shared" })
    const uniqueA = link({ id: "unique-a", taskId: "task-1", sessionId: "pi-unique-a", title: "Unique A" })
    const sharedB = link({ id: "shared-b", taskId: "task-2", sessionId: "pi-shared", title: "Shared" })
    const uniqueB = link({ id: "unique-b", taskId: "task-2", sessionId: "pi-unique-b", title: "Unique B" })
    const otherTask = { ...task, id: "task-2", number: "#613", title: "Other task" }
    postJson.mockImplementation(async (path: string, body: { taskId?: string; sessionIds?: string[]; bindingId?: string }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: body.taskId === "task-2" ? [sharedB, uniqueB] : [sharedA, uniqueA] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return {
        activities: (body.sessionIds ?? []).map((sessionId) => ({ sessionId, status: "working", source: "live-runtime" })),
        omittedSessionIds: [],
      }
      if (path === "/api/boring-tasks/sessions/unlink") {
        expect(body.bindingId).toBe("shared-a")
        return { ok: true }
      }
      throw new Error(`unexpected post ${path}`)
    })

    render(
      <TaskSessionActivityProvider>
        <TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />
        <TaskCard task={otherTask} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />
      </TaskSessionActivityProvider>,
    )
    expect(await screen.findAllByLabelText("2 working linked chats")).toHaveLength(2)
    fireEvent.click(screen.getAllByRole("button", { name: /2 working/i })[0])
    const sharedRow = (await screen.findByText("Shared")).closest("li")
    expect(sharedRow).not.toBeNull()
    fireEvent.click(within(sharedRow!).getByRole("button", { name: "Unlink" }))

    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/unlink", { bindingId: "shared-a" }))
    await waitFor(() => expect(screen.getAllByLabelText("2 working linked chats")).toHaveLength(1))
  })

  it("retains activity when unlink fails and the optimistic removal is restored", async () => {
    const shared = link({ id: "shared", sessionId: "pi-shared", title: "Shared" })
    const other = link({ id: "other", sessionId: "pi-other", title: "Other" })
    postJson.mockImplementation(async (path: string, body: { sessionIds?: string[]; bindingId?: string }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [shared, other] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return {
        activities: (body.sessionIds ?? []).map((sessionId) => ({ sessionId, status: "working", source: "live-runtime" })),
        omittedSessionIds: [],
      }
      if (path === "/api/boring-tasks/sessions/unlink") throw new Error("unlink failed")
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    expect(await screen.findByLabelText("2 working linked chats")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /2 working/i }))
    const sharedRow = (await screen.findByText("Shared")).closest("li")
    expect(sharedRow).not.toBeNull()
    fireEvent.click(within(sharedRow!).getByRole("button", { name: "Unlink" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("unlink failed")
    expect(await screen.findByLabelText("2 working linked chats")).toBeInTheDocument()
  })

  it("ignores a stale mount-time list after creating and binding a chat", async () => {
    const mountList = deferred<TaskSessionListResponse>()
    const created = link({ id: "link-new", sessionId: "pi-new" })
    let listCalls = 0
    postJson.mockImplementation((path: string) => {
      if (path === "/api/boring-tasks/sessions/list") {
        listCalls += 1
        return listCalls === 1 ? mountList.promise : Promise.resolve({ links: [] })
      }
      if (path === "/api/v1/agent/pi-chat/sessions") return Promise.resolve({ id: "pi-new" })
      if (path === "/api/boring-tasks/sessions/link") return Promise.resolve({ link: created })
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return Promise.resolve({ activities: [{ sessionId: "pi-new", status: "idle", source: "persisted" }], omittedSessionIds: [] })
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/list", { adapterId: "github", taskId: "task-1" }))
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))

    await waitFor(() => expect(openDetachedChat).toHaveBeenCalledWith("pi-new", expect.objectContaining({ title: "#612: Wire sessions" })))
    await act(async () => {
      mountList.resolve({ links: [] })
      await mountList.promise
      await Promise.resolve()
    })

    expect(await screen.findByLabelText("1 linked chats")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /open chat for #612/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toHaveTextContent("#612: Wire sessions")
    expect(postJson.mock.calls.filter(([path]) => path === "/api/v1/agent/pi-chat/sessions")).toHaveLength(1)
  })

  it("creates, binds, and opens a chat when the task has no prior session", async () => {
    postJson.mockImplementation(async (path: string, body: unknown) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [] }
      if (path === "/api/v1/agent/pi-chat/sessions") return { id: "pi-new" }
      if (path === "/api/boring-tasks/sessions/link") return { link: link({ id: "link-new", sessionId: "pi-new" }) }
      throw new Error(`unexpected post ${path} ${JSON.stringify(body)}`)
    })

    renderCard()
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/list", { adapterId: "github", taskId: "task-1" }))
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))

    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/v1/agent/pi-chat/sessions", { title: "#612: Wire sessions" }))
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", { adapterId: "github", taskId: "task-1", sessionId: "pi-new", title: "#612: Wire sessions" })
    expect(openDetachedChat).toHaveBeenCalledWith("pi-new", expect.objectContaining({ title: "#612: Wire sessions", initialDraft: expect.stringContaining("Task ID: task-1") }))
  })

  it("does not navigate when a linked-row Open resolves after the panel closes", async () => {
    const existing = link()
    const pendingSessionLookup = deferred<Array<{ id: string; title: string }>>()
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [existing] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return { activities: [{ sessionId: "pi-1", status: "idle", source: "persisted" }], omittedSessionIds: [] }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockReturnValue(pendingSessionLookup.promise)

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Open" }))
    fireEvent.click(screen.getByRole("button", { name: "Close task chats" }))

    await act(async () => {
      pendingSessionLookup.resolve([{ id: "pi-1", title: "#612: Wire sessions" }])
      await pendingSessionLookup.promise
      await Promise.resolve()
    })

    expect(openDetachedChat).not.toHaveBeenCalled()
    expect(screen.queryByRole("region", { name: /linked chat sessions/i })).not.toBeInTheDocument()
  })

  it("does not navigate when a linked-row Open resolves after unlink", async () => {
    const existing = link()
    const pendingSessionLookup = deferred<Array<{ id: string; title: string }>>()
    postJson.mockImplementation(async (path: string, body: { bindingId?: string }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [existing] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return { activities: [{ sessionId: "pi-1", status: "idle", source: "persisted" }], omittedSessionIds: [] }
      if (path === "/api/boring-tasks/sessions/unlink") {
        expect(body.bindingId).toBe("link-1")
        return { ok: true }
      }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockReturnValue(pendingSessionLookup.promise)

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Open" }))
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }))

    await act(async () => {
      pendingSessionLookup.resolve([{ id: "pi-1", title: "#612: Wire sessions" }])
      await pendingSessionLookup.promise
      await Promise.resolve()
    })

    expect(openDetachedChat).not.toHaveBeenCalled()
    expect(await screen.findByText("No linked chats yet.")).toBeInTheDocument()
  })

  it("does not open a Start new chat navigation after the panel closes", async () => {
    const existing = link()
    const pendingCreate = deferred<{ id: string }>()
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [existing] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return { activities: [{ sessionId: "pi-1", status: "idle", source: "persisted" }], omittedSessionIds: [] }
      if (path === "/api/v1/agent/pi-chat/sessions") return pendingCreate.promise
      if (path === "/api/boring-tasks/sessions/link") return { link: link({ id: "link-new", sessionId: "pi-new" }) }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Start new chat" }))
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/v1/agent/pi-chat/sessions", { title: "#612: Wire sessions" }))
    fireEvent.click(screen.getByRole("button", { name: "Close task chats" }))

    await act(async () => {
      pendingCreate.resolve({ id: "pi-new" })
      await pendingCreate.promise
      await Promise.resolve()
    })

    expect(postJson).not.toHaveBeenCalledWith("/api/boring-tasks/sessions/link", expect.anything())
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("does not open a Start new chat navigation after the task is removed from the card", async () => {
    const existing = link()
    const replacementTask = { ...task, id: "task-removed", number: "#613", title: "Replacement" }
    const pendingCreate = deferred<{ id: string }>()
    const onDragStart = vi.fn()
    const onDragEnd = vi.fn()
    postJson.mockImplementation(async (path: string, body: { taskId?: string } = {}) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: body.taskId === "task-removed" ? [] : [existing] }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return { activities: [{ sessionId: "pi-1", status: "idle", source: "persisted" }], omittedSessionIds: [] }
      if (path === "/api/v1/agent/pi-chat/sessions") return pendingCreate.promise
      if (path === "/api/boring-tasks/sessions/link") return { link: link({ id: "link-new", sessionId: "pi-new" }) }
      throw new Error(`unexpected post ${path}`)
    })

    const { rerender } = render(<TaskCard task={task} draggable={false} onDragStart={onDragStart} onDragEnd={onDragEnd} />)
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Start new chat" }))
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/v1/agent/pi-chat/sessions", { title: "#612: Wire sessions" }))
    await act(async () => {
      rerender(<TaskCard task={replacementTask} draggable={false} onDragStart={onDragStart} onDragEnd={onDragEnd} />)
      await Promise.resolve()
    })

    await act(async () => {
      pendingCreate.resolve({ id: "pi-new" })
      await pendingCreate.promise
      await Promise.resolve()
    })

    expect(postJson).not.toHaveBeenCalledWith("/api/boring-tasks/sessions/link", expect.anything())
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("clears stale active top-level chat action while replacement links load", async () => {
    const working = link({ id: "working", sessionId: "pi-working", title: "Working chat" })
    const replacementTask = { ...task, id: "task-replacement", number: "#613", title: "Replacement" }
    const replacementList = deferred<TaskSessionListResponse>()
    postJson.mockImplementation((path: string, body: { taskId?: string; sessionIds?: string[] } = {}) => {
      if (path === "/api/boring-tasks/sessions/list") return body.taskId === "task-replacement" ? replacementList.promise : Promise.resolve({ links: [working] })
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return Promise.resolve({ activities: [{ sessionId: "pi-working", status: "working", source: "live-runtime" }], omittedSessionIds: [] })
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-working", title: "Working chat" }])

    const { rerender } = render(<TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
    expect(await screen.findByLabelText("1 working linked chats")).toBeInTheDocument()

    await act(async () => {
      rerender(<TaskCard task={replacementTask} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
      await Promise.resolve()
    })

    expect(screen.queryByLabelText("1 working linked chats")).not.toBeInTheDocument()
    const replacementChatButton = screen.getByRole("button", { name: /open chat for #613\. checking activity/i })
    expect(replacementChatButton).toHaveAttribute("aria-busy", "true")
    fireEvent.click(replacementChatButton)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(getJson).not.toHaveBeenCalled()
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("clears stale linked-row chat actions while replacement links load", async () => {
    const existing = link({ title: "Old row chat" })
    const replacementTask = { ...task, id: "task-replacement", number: "#613", title: "Replacement" }
    const replacementList = deferred<TaskSessionListResponse>()
    postJson.mockImplementation((path: string, body: { taskId?: string; sessionIds?: string[] } = {}) => {
      if (path === "/api/boring-tasks/sessions/list") return body.taskId === "task-replacement" ? replacementList.promise : Promise.resolve({ links: [existing] })
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return Promise.resolve({ activities: (body.sessionIds ?? []).map((sessionId) => ({ sessionId, status: "idle", source: "persisted" })), omittedSessionIds: [] })
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-1", title: "Old row chat" }])

    const { rerender } = render(<TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()

    await act(async () => {
      rerender(<TaskCard task={replacementTask} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
      await Promise.resolve()
    })

    expect(screen.queryByRole("region", { name: /linked chat sessions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /open chat for #613\. checking activity/i })).toHaveAttribute("aria-busy", "true")
    expect(getJson).not.toHaveBeenCalled()
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("shows linked sessions, reopens an available session, and unlinks", async () => {
    const existing = link()
    postJson.mockImplementation(async (path: string, body: { bindingId?: string }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [existing] }
      if (path === "/api/boring-tasks/sessions/unlink") {
        expect(body.bindingId).toBe("link-1")
        return { ok: true }
      }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-1", title: "#612: Wire sessions" }])

    renderCard()
    expect(await screen.findByLabelText("1 linked chats")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/v1/agent/pi-chat/sessions?limit=1&activeSessionId=pi-1"))
    expect(openDetachedChat).toHaveBeenCalledWith("pi-1", expect.objectContaining({ title: "#612: Wire sessions" }))

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }))
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/unlink", { bindingId: "link-1" }))
    await waitFor(() => expect(screen.queryByText("#612: Wire sessions")).not.toBeInTheDocument())
  })

  it("links an existing standalone Pi session through search", async () => {
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [link()] }
      if (path === "/api/boring-tasks/sessions/search") return { sessions: [{ id: "pi-standalone", title: "Standalone" }] }
      if (path === "/api/boring-tasks/sessions/link") return { link: link({ id: "link-standalone", sessionId: "pi-standalone", title: "Standalone" }) }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.change(await screen.findByPlaceholderText("Search chats"), { target: { value: "standalone" } })
    fireEvent.click(screen.getByRole("button", { name: /link existing/i }))
    expect(await screen.findByText("Standalone")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Link" }))

    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", {
      adapterId: "github",
      taskId: "task-1",
      sessionId: "pi-standalone",
      title: "Standalone",
    }))
  })

  it("ignores stale search results after the card rerenders for another task", async () => {
    const taskB = { ...task, id: "task-b", number: "#613", title: "Replacement" }
    const linkA = link({ id: "link-a", title: "Task A chat" })
    const linkB = link({ id: "link-b", taskId: "task-b", sessionId: "pi-b", title: "Task B chat" })
    const pendingSearch = deferred<{ sessions?: Array<{ id: string; title?: string }> }>()
    postJson.mockImplementation((path: string, body: { taskId?: string; sessionIds?: string[] } = {}) => {
      if (path === "/api/boring-tasks/sessions/list") return Promise.resolve({ links: body.taskId === "task-b" ? [linkB] : [linkA] })
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return Promise.resolve({ activities: (body.sessionIds ?? []).map((sessionId) => ({ sessionId, status: "idle", source: "persisted" })), omittedSessionIds: [] })
      if (path === "/api/boring-tasks/sessions/search") return pendingSearch.promise
      throw new Error(`unexpected post ${path}`)
    })

    const { rerender } = render(<TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.change(await screen.findByPlaceholderText("Search chats"), { target: { value: "stale" } })
    fireEvent.click(screen.getByRole("button", { name: /link existing/i }))
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/search", { query: "stale" }))

    await act(async () => {
      rerender(<TaskCard task={taskB} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
      await Promise.resolve()
    })
    await act(async () => {
      pendingSearch.resolve({ sessions: [{ id: "pi-stale", title: "Stale search result" }] })
      await pendingSearch.promise
      await Promise.resolve()
    })

    fireEvent.click(await screen.findByRole("button", { name: /open chat for #613/i }))
    expect(await screen.findByText("Task B chat")).toBeInTheDocument()
    expect(screen.queryByText("Stale search result")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("ignores stale link errors after the card rerenders for another task", async () => {
    const taskB = { ...task, id: "task-b", number: "#613", title: "Replacement" }
    const linkA = link({ id: "link-a", title: "Task A chat" })
    const linkB = link({ id: "link-b", taskId: "task-b", sessionId: "pi-b", title: "Task B chat" })
    const pendingLink = deferred<{ link?: BoringTaskSessionBinding }>()
    postJson.mockImplementation((path: string, body: { taskId?: string; sessionIds?: string[]; sessionId?: string } = {}) => {
      if (path === "/api/boring-tasks/sessions/list") return Promise.resolve({ links: body.taskId === "task-b" ? [linkB] : [linkA] })
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return Promise.resolve({ activities: (body.sessionIds ?? []).map((sessionId) => ({ sessionId, status: "idle", source: "persisted" })), omittedSessionIds: [] })
      if (path === "/api/boring-tasks/sessions/search") return Promise.resolve({ sessions: [{ id: "pi-stale", title: "Stale standalone" }] })
      if (path === "/api/boring-tasks/sessions/link" && body.sessionId === "pi-stale") return pendingLink.promise
      throw new Error(`unexpected post ${path}`)
    })

    const { rerender } = render(<TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: /link existing/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Link" }))
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", expect.objectContaining({ taskId: "task-1", sessionId: "pi-stale" })))

    await act(async () => {
      rerender(<TaskCard task={taskB} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
      await Promise.resolve()
    })
    await act(async () => {
      pendingLink.reject(new Error("stale link failed"))
      await pendingLink.promise.catch(() => undefined)
      await Promise.resolve()
    })

    fireEvent.click(await screen.findByRole("button", { name: /open chat for #613/i }))
    expect(await screen.findByText("Task B chat")).toBeInTheDocument()
    expect(screen.queryByText("stale link failed")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("ignores stale unlink errors after the card rerenders for another task", async () => {
    const taskB = { ...task, id: "task-b", number: "#613", title: "Replacement" }
    const linkA = link({ id: "link-a", title: "Task A chat" })
    const linkB = link({ id: "link-b", taskId: "task-b", sessionId: "pi-b", title: "Task B chat" })
    const pendingUnlink = deferred<{ ok: boolean }>()
    postJson.mockImplementation((path: string, body: { taskId?: string; sessionIds?: string[]; bindingId?: string } = {}) => {
      if (path === "/api/boring-tasks/sessions/list") return Promise.resolve({ links: body.taskId === "task-b" ? [linkB] : [linkA] })
      if (path === "/api/v1/agent/pi-chat/sessions/activity") return Promise.resolve({ activities: (body.sessionIds ?? []).map((sessionId) => ({ sessionId, status: "idle", source: "persisted" })), omittedSessionIds: [] })
      if (path === "/api/boring-tasks/sessions/unlink" && body.bindingId === "link-a") return pendingUnlink.promise
      throw new Error(`unexpected post ${path}`)
    })

    const { rerender } = render(<TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Unlink" }))
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/unlink", { bindingId: "link-a" }))

    await act(async () => {
      rerender(<TaskCard task={taskB} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
      await Promise.resolve()
    })
    await act(async () => {
      pendingUnlink.reject(new Error("stale unlink failed"))
      await pendingUnlink.promise.catch(() => undefined)
      await Promise.resolve()
    })

    fireEvent.click(await screen.findByRole("button", { name: /open chat for #613/i }))
    expect(await screen.findByText("Task B chat")).toBeInTheDocument()
    expect(screen.queryByText("stale unlink failed")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("renders the linked-session disclosure and actions in compact cards", async () => {
    postJson.mockResolvedValue({ links: [link()] })
    getJson.mockResolvedValue([{ id: "pi-1", title: "#612: Wire sessions" }])

    render(<TaskCard task={task} compact draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unlink" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /link existing/i })).toBeInTheDocument()
  })

  it("surfaces unavailable linked sessions without opening them", async () => {
    postJson.mockResolvedValue({ links: [link()] })
    getJson.mockResolvedValue([])

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Open" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available")
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("does not open an unbound chat when binding fails after creation", async () => {
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [] }
      if (path === "/api/v1/agent/pi-chat/sessions") return { id: "pi-orphan" }
      if (path === "/api/boring-tasks/sessions/link") throw new Error("binding failed")
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/list", { adapterId: "github", taskId: "task-1" }))
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Created chat pi-orphan")
    expect(openDetachedChat).not.toHaveBeenCalled()
  })
})
