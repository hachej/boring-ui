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

afterEach(() => {
  vi.unstubAllGlobals()
})

it("runs warmup in the background and seeds the tree cache", async () => {
  const onStatusChange = vi.fn()
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/tree")) return json({ entries: [{ name: "src", type: "directory", path: "src" }] })
    if (url.includes("/api/v1/agent/sessions")) return json([])
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
    if (String(input).includes("/api/v1/agent/sessions")) {
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
    if (url.includes("/api/v1/agent/sessions")) {
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
      onStatusChange={onStatusChange}
    />,
  )

  await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ status: "ready" }), { timeout: 2_500 })
  expect(sessionCalls).toBe(3)
})

it("reports degraded ready-status SSE as failed", async () => {
  const onStatusChange = vi.fn()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/agent/sessions")) {
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
    if (String(input).includes("/api/v1/agent/sessions")) {
      return json({ error: { code: "RUNTIME_PROVISIONING_FAILED", message: "Agent runtime failed to prepare" } }, { status: 503 })
    }
    return json({ entries: [] })
  }))

  render(
    <WorkspaceBackgroundBoot
      workspaceId="w-runtime-failed"
      requestHeaders={{ "x-boring-workspace-id": "w-runtime-failed" }}
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
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/sessions"))).toBe(false)
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
