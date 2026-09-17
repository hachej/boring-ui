// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import { AppRunnerClient } from "../appRunnerClient"

const identity = { id: "alice", name: "Alice" }

describe("AppRunnerClient cancellation", () => {
  it("does not dispatch an already-aborted request", async () => {
    const fetchImpl = vi.fn(async () => new Response("unexpected"))
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    const client = new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch })

    await expect(client.current("ws", "app", identity, controller.signal)).rejects.toThrow("cancelled")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("keeps the deadline active while the response body stalls", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true })
        },
      })
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } })
    })
    const client = new AppRunnerClient({ baseUrl: "http://hub", timeoutMs: 5, fetchImpl: fetchImpl as typeof fetch })

    await expect(client.current("ws", "app", identity)).rejects.toThrow(/timed out after 5ms/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("aborts a stalled hub request at the configured deadline", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }))
    const client = new AppRunnerClient({ baseUrl: "http://hub", timeoutMs: 5, fetchImpl: fetchImpl as typeof fetch })

    await expect(client.current("ws", "app", identity)).rejects.toThrow(/timed out after 5ms/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
