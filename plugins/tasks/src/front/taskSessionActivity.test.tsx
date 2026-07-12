// @vitest-environment jsdom
import { useEffect } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskSessionActivityProvider, useTaskSessionActivity } from "./taskSessionActivity"

const postJson = vi.fn()
const pluginClient = { postJson }

vi.mock("@hachej/boring-workspace", () => ({
  useWorkspacePluginClient: () => pluginClient,
}))

type ActivityResponse = {
  activities?: Array<{ sessionId: string; status: "idle" | "queued" | "working" | "error"; source: "live-runtime" | "persisted"; updatedAt?: string }>
  omittedSessionIds?: string[]
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

function Probe() {
  const activity = useTaskSessionActivity()

  useEffect(() => {
    return activity.registerSessionIds(["board-a", "board-b"])
  }, [activity.registerSessionIds])

  return (
    <div>
      <button type="button" onClick={() => { void activity.refreshSessionIds(["board-a"]) }}>Refresh A</button>
      <button type="button" onClick={() => activity.setOptimisticActivity("board-a", { status: "working", source: "live-runtime" })}>Optimistic A working</button>
      <span data-testid="activity-a">{activity.activities["board-a"]?.status ?? "none"}</span>
      <span data-testid="activity-b">{activity.activities["board-b"]?.status ?? "none"}</span>
    </div>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  postJson.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("TaskSessionActivityProvider request scoping", () => {
  it("keeps unrelated board poll results when a single-session refresh supersedes one session", async () => {
    const pending: Array<{ sessionIds: string[]; request: ReturnType<typeof deferred<ActivityResponse>> }> = []
    postJson.mockImplementation((path: string, body: { sessionIds?: string[] }) => {
      if (path !== "/api/v1/agent/pi-chat/sessions/activity") throw new Error(`unexpected post ${path}`)
      const request = deferred<ActivityResponse>()
      pending.push({ sessionIds: body.sessionIds ?? [], request })
      return request.promise
    })

    render(<TaskSessionActivityProvider><Probe /></TaskSessionActivityProvider>)

    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(25) })
    expect(pending.map((entry) => entry.sessionIds)).toEqual([["board-a", "board-b"]])

    fireEvent.click(screen.getByRole("button", { name: "Refresh A" }))
    expect(pending.map((entry) => entry.sessionIds)).toEqual([["board-a", "board-b"], ["board-a"]])

    await act(async () => {
      pending[1].request.resolve({ activities: [{ sessionId: "board-a", status: "idle", source: "persisted" }], omittedSessionIds: [] })
      await pending[1].request.promise
      await Promise.resolve()
    })
    expect(screen.getByTestId("activity-a")).toHaveTextContent("idle")
    expect(screen.getByTestId("activity-b")).toHaveTextContent("none")

    await act(async () => {
      pending[0].request.resolve({
        activities: [
          { sessionId: "board-a", status: "working", source: "live-runtime" },
          { sessionId: "board-b", status: "working", source: "live-runtime" },
        ],
        omittedSessionIds: [],
      })
      await pending[0].request.promise
      await Promise.resolve()
    })

    expect(screen.getByTestId("activity-a")).toHaveTextContent("idle")
    expect(screen.getByTestId("activity-b")).toHaveTextContent("working")
  })

  it("lets an in-flight authoritative poll reconcile after an optimistic browser update", async () => {
    const pending: Array<{ sessionIds: string[]; request: ReturnType<typeof deferred<ActivityResponse>> }> = []
    postJson.mockImplementation((path: string, body: { sessionIds?: string[] }) => {
      if (path !== "/api/v1/agent/pi-chat/sessions/activity") throw new Error(`unexpected post ${path}`)
      const request = deferred<ActivityResponse>()
      pending.push({ sessionIds: body.sessionIds ?? [], request })
      return request.promise
    })

    render(<TaskSessionActivityProvider><Probe /></TaskSessionActivityProvider>)

    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(25) })
    expect(pending.map((entry) => entry.sessionIds)).toEqual([["board-a", "board-b"]])

    fireEvent.click(screen.getByRole("button", { name: "Optimistic A working" }))
    expect(screen.getByTestId("activity-a")).toHaveTextContent("working")

    await act(async () => {
      pending[0].request.resolve({
        activities: [
          { sessionId: "board-a", status: "idle", source: "persisted" },
          { sessionId: "board-b", status: "queued", source: "live-runtime" },
        ],
        omittedSessionIds: [],
      })
      await pending[0].request.promise
      await Promise.resolve()
    })

    expect(screen.getByTestId("activity-a")).toHaveTextContent("idle")
    expect(screen.getByTestId("activity-b")).toHaveTextContent("queued")
  })
})
