import { render, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { getPreloadedTreeEntries } from "../../../plugins/filesystemPlugin/front/data/treePreloadCache"
import { WorkspaceBackgroundBoot } from "../WorkspaceBackgroundBoot"

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
}

const SESSION_PRELOAD_PATHS = ["/api/v1/tree?path=.", "/api/v1/agent/pi-chat/sessions"]

afterEach(() => {
  vi.unstubAllGlobals()
})

it("runs warmup in the background without gating on sessions and seeds the tree cache", async () => {
  const onStatusChange = vi.fn()
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/tree")) return json({ entries: [{ name: "src", type: "directory", path: "src" }] })
    if (url.includes("/api/v1/agent/pi-chat/sessions")) throw new Error("sessions should not gate workspace warmup")
    if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal("fetch", fetchMock)

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-bg"
      apiBaseUrl="/base"
      requestHeaders={{ "x-boring-workspace-id": "w-bg" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ status: "ready" }))
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/sessions"))).toBe(false)
  expect(getPreloadedTreeEntries("/base", "w-bg", ".")).toEqual([
    { name: "src", type: "directory", path: "src" },
  ])
})

it("keeps retryable WORKSPACE_NOT_READY as preparing", async () => {
  const onStatusChange = vi.fn()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/v1/tree")) {
      return json({
        error: {
          code: "WORKSPACE_NOT_READY",
          details: { code: "WORKSPACE_NOT_READY", retryable: true, requirement: "workspace-fs" },
        },
      }, { status: 503 })
    }
    return json([])
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-preparing"
      requestHeaders={{ "x-boring-workspace-id": "w-preparing" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => {
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: "preparing",
      message: "Workspace is still preparing",
      requirement: "workspace-fs",
    })
  })
})

it("keeps retryable AGENT_RUNTIME_NOT_READY as preparing", async () => {
  const onStatusChange = vi.fn()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/v1/agent/pi-chat/sessions")) {
      return json({
        error: {
          code: "AGENT_RUNTIME_NOT_READY",
          details: { code: "AGENT_RUNTIME_NOT_READY", retryable: true },
        },
      }, { status: 503 })
    }
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-preparing"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-preparing" }}
      preloadPaths={SESSION_PRELOAD_PATHS}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => {
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: "preparing",
      message: "Workspace is still preparing",
    })
  })
})

it("keeps polling transient runtime-preparing warmup after ready-status completes", async () => {
  const onStatusChange = vi.fn()
  let sessionCalls = 0
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/agent/pi-chat/sessions")) {
      sessionCalls += 1
      if (sessionCalls <= 2) {
        return json({
          error: {
            code: "AGENT_RUNTIME_NOT_READY",
            details: { code: "AGENT_RUNTIME_NOT_READY", retryable: true },
          },
        }, { status: 503 })
      }
      return json([])
    }
    if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-eventually-ready"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-eventually-ready" }}
      preloadPaths={SESSION_PRELOAD_PATHS}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ status: "ready" }), { timeout: 2_500 })
  expect(sessionCalls).toBe(3)
})

it("treats ready chat/workspace capabilities as warm before runtime dependencies finish", async () => {
  const onStatusChange = vi.fn()
  const encoder = new TextEncoder()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/ready-status")) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'event: status\ndata: {"state":"ready","capabilities":{"chat":{"state":"ready"},"workspace":{"state":"ready"},"runtimeDependencies":{"state":"preparing"}}}\n\n',
          ))
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }
    if (url.includes("/api/v1/agent/pi-chat/sessions")) return json([])
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-deps-background"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-deps-background" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({
    status: "ready",
    runtimeDependencies: { state: "preparing" },
  }))
})

it("preserves runtime dependency status while other warmup paths are retrying", async () => {
  const onStatusChange = vi.fn()
  let treeCalls = 0
  let readyStatusCalls = 0
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/ready-status")) {
      readyStatusCalls += 1
      const runtimeState = readyStatusCalls === 1 ? "preparing" : "ready"
      return new Response(
        `event: status\ndata: {"state":"ready","capabilities":{"chat":{"state":"ready"},"workspace":{"state":"ready"},"runtimeDependencies":{"state":"${runtimeState}"}}}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )
    }
    if (url.includes("/api/v1/tree")) {
      treeCalls += 1
      if (treeCalls === 1) {
        return json({
          error: {
            code: "WORKSPACE_NOT_READY",
            details: { code: "WORKSPACE_NOT_READY", retryable: true, requirement: "workspace-fs" },
          },
        }, { status: 503 })
      }
      return json({ entries: [] })
    }
    if (url.includes("/api/v1/agent/pi-chat/sessions")) return json([])
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-deps-mixed-retry"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-deps-mixed-retry" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith({
    status: "ready",
    runtimeDependencies: { state: "preparing" },
  }), { timeout: 2_500 })
  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({
    status: "ready",
    runtimeDependencies: { state: "ready" },
  }), { timeout: 2_500 })
})

it("updates runtime dependency status after workspace becomes usable", async () => {
  const onStatusChange = vi.fn()
  let readyStatusCalls = 0
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/ready-status")) {
      readyStatusCalls += 1
      const runtimeState = readyStatusCalls === 1 ? "preparing" : "ready"
      return new Response(
        `event: status\ndata: {"state":"ready","capabilities":{"chat":{"state":"ready"},"workspace":{"state":"ready"},"runtimeDependencies":{"state":"${runtimeState}"}}}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )
    }
    if (url.includes("/api/v1/agent/pi-chat/sessions")) return json([])
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-deps-update"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-deps-update" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith({
    status: "ready",
    runtimeDependencies: { state: "preparing" },
  }))
  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({
    status: "ready",
    runtimeDependencies: { state: "ready" },
  }), { timeout: 2_500 })
})

it("treats network-level fetch failures as retryable preparing, then recovers", async () => {
  // Server restarting: fetch rejects with TypeError. The warmup must keep
  // retrying (preparing), not fail terminally, and recover once the server
  // is back — without a remount.
  const onStatusChange = vi.fn()
  let calls = 0
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls += 1
    if (calls <= 2) throw new TypeError("Failed to fetch")
    if (url.includes("/api/v1/tree")) return json({ entries: [] })
    if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
    return json([])
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-netfail"
      apiBaseUrl="/base"
      requestHeaders={{ "x-boring-workspace-id": "w-netfail" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ status: "ready" }), { timeout: 8000 })
  expect(onStatusChange.mock.calls.some(([status]) => status.status === "failed")).toBe(false)
}, 15_000)

it("times out a hung warmup attempt and recovers on retry", async () => {
  // Right after a server restart the event loop can be saturated for tens of
  // seconds; an un-timed first fetch would hang forever and pin the
  // "Preparing workspace" overlay until remount. A hung attempt must be
  // aborted and retried.
  vi.useFakeTimers()
  try {
    const onStatusChange = vi.fn()
    let calls = 0
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls += 1
      if (calls <= 2) {
        // Hang until aborted by the per-attempt timeout.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
        })
      }
      if (url.includes("/api/v1/tree")) return Promise.resolve(json({ entries: [] }))
      if (url.includes("/api/v1/ready-status")) return Promise.resolve(new Response(null, { status: 200 }))
      return Promise.resolve(json([]))
    }))

    render(
      <WorkspaceBackgroundBoot
        workspaceId="w-hang"
        apiBaseUrl="/base"
        requestHeaders={{ "x-boring-workspace-id": "w-hang" }}
        onStatusChange={onStatusChange}
      />,
    )

    // First attempts hang; advance past the attempt timeout + retry delay.
    await vi.advanceTimersByTimeAsync(11_000)
    await vi.advanceTimersByTimeAsync(11_000)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: "ready" })
    expect(onStatusChange.mock.calls.some(([status]) => status.status === "failed")).toBe(false)
  } finally {
    vi.useRealTimers()
  }
}, 20_000)

it("reports degraded ready-status SSE as failed", async () => {
  const onStatusChange = vi.fn()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/agent/pi-chat/sessions")) {
      return json({
        error: {
          code: "AGENT_RUNTIME_NOT_READY",
          details: { code: "AGENT_RUNTIME_NOT_READY", retryable: true },
        },
      }, { status: 503 })
    }
    if (url.includes("/api/v1/ready-status")) {
      return new Response('event: status\ndata: {"state":"degraded","message":"Agent runtime failed to prepare"}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    }
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-degraded"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-degraded" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => {
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: "failed",
      message: "Agent runtime failed to prepare",
    })
  })
})

it("reports JSON error envelope messages for non-retryable warmup failures", async () => {
  const onStatusChange = vi.fn()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/v1/agent/pi-chat/sessions")) {
      return json({ error: { code: "RUNTIME_PROVISIONING_FAILED", message: "Agent runtime failed to prepare" } }, { status: 503 })
    }
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-failed"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-failed" }}
      preloadPaths={SESSION_PRELOAD_PATHS}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => {
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: "failed",
      message: "Agent runtime failed to prepare",
    })
  })
})

it("reports non-retryable warmup failures", async () => {
  const onStatusChange = vi.fn()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/v1/tree")) return new Response("boom", { status: 500 })
    return json([])
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-failed"
      requestHeaders={{ "x-boring-workspace-id": "w-failed" }}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => {
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: "failed", message: "boom" })
  })
})

it("does not request runtime readiness when provisionWorkspace is false", async () => {
  const onStatusChange = vi.fn()
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/v1/tree")) return json({ entries: [] })
    return json([])
  })
  vi.stubGlobal("fetch", fetchMock)

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-no-provision"
      requestHeaders={{ "x-boring-workspace-id": "w-no-provision" }}
      provisionWorkspace={false}
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ status: "ready" }))
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/ready-status"))).toBe(false)
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/sessions"))).toBe(false)
})

it("ignores stale responses after workspace switch", async () => {
  const onStatusChange = vi.fn()
  let resolveTree: ((response: Response) => void) | undefined
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/tree")) {
      return new Promise<Response>((resolve) => { resolveTree = resolve })
    }
    return Promise.resolve(json([]))
  })
  vi.stubGlobal("fetch", fetchMock)

  const { rerender } = render(
    <WorkspaceBackgroundBoot
      workspaceId="old"
      requestHeaders={{ "x-boring-workspace-id": "old" }}
      onStatusChange={onStatusChange}
    />,
  )
  rerender(
    <WorkspaceBackgroundBoot
      workspaceId="new"
      requestHeaders={{ "x-boring-workspace-id": "new" }}
      onStatusChange={onStatusChange}
    />,
  )
  resolveTree?.(json({ entries: [{ name: "old", type: "file", path: "old" }] }))

  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith({ status: "preparing" }))
  expect(getPreloadedTreeEntries(undefined, "old", ".")).toBeUndefined()
})
