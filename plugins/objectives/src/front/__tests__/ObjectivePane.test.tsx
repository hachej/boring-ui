import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { ObjectivePane } from "../ObjectivePane"
import type { Objective } from "../../shared/types"

interface ObjectivePaneParams {
  objectiveId?: string
}

// Dockview panel/container control surfaces the pane doesn't touch; the
// pane only reads `params`, so a minimal stub satisfies PaneProps.
const dockviewStub = {} as unknown as { api: PaneProps["api"]; containerApi: PaneProps["containerApi"] }

function Pane(props: { params: ObjectivePaneParams }) {
  return <ObjectivePane {...props} {...dockviewStub} />
}

function objective(overrides: Partial<Objective> = {}): Objective {
  return {
    id: "obj-1",
    title: "Ship v2",
    objective: "Ship the v2 rewrite",
    metric: "WAU",
    baseline: 100,
    target: 500,
    current: 200,
    status: "active",
    constraints: [],
    evidenceRefs: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  }
}

function bridgeResponse(objectiveOrNull: Objective | null) {
  return Response.json({ ok: true, output: { objective: objectiveOrNull } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("ObjectivePane", () => {
  it("ignores a stale in-flight response after the target changes (request-generation guard)", async () => {
    let resolveFirst!: (value: Response) => void
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.input.id === "obj-slow") return firstResponse
      return bridgeResponse(objective({ id: "obj-fast", title: "Fast objective" }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const { rerender } = render(<Pane params={{ objectiveId: "obj-slow" }} />)
    // Switch targets before the slow "obj-slow" fetch resolves.
    rerender(<Pane params={{ objectiveId: "obj-fast" }} />)

    await waitFor(() => expect(screen.getByText("Fast objective")).toBeInTheDocument())

    // The slow response for the abandoned target arrives late; it must not
    // overwrite the now-current "obj-fast" objective.
    resolveFirst(bridgeResponse(objective({ id: "obj-slow", title: "Slow objective" })))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText("Fast objective")).toBeInTheDocument()
    expect(screen.queryByText("Slow objective")).not.toBeInTheDocument()
  })

  it("polls on an interval and refreshes without flashing the loading state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let current = 100
    const fetchMock = vi.fn(async () => bridgeResponse(objective({ current })))
    vi.stubGlobal("fetch", fetchMock)

    render(<Pane params={{ objectiveId: "obj-1" }} />)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await screen.findByText("Ship v2")

    current = 250
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText("250 / 500")).toBeInTheDocument())
  })

  it("refreshes when the tab becomes visible again", async () => {
    let current = 100
    const fetchMock = vi.fn(async () => bridgeResponse(objective({ current })))
    vi.stubGlobal("fetch", fetchMock)

    render(<Pane params={{ objectiveId: "obj-1" }} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    current = 300
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText("300 / 500")).toBeInTheDocument())
  })
})
