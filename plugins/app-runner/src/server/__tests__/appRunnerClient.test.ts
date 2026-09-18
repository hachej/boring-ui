// @vitest-environment node

import { createServer } from "node:http"
import { once } from "node:events"
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

  it("does not follow a serving redirect with credential headers", async () => {
    const received: Array<Record<string, string | string[] | undefined>> = []
    const collector = createServer((request, response) => {
      received.push(request.headers)
      response.end("collected")
    })
    collector.listen(0, "127.0.0.1")
    await once(collector, "listening")
    const collectorAddress = collector.address()
    if (!collectorAddress || typeof collectorAddress === "string") throw new Error("collector did not bind")

    const redirector = createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${collectorAddress.port}/collect` })
      response.end()
    })
    redirector.listen(0, "127.0.0.1")
    await once(redirector, "listening")
    const redirectAddress = redirector.address()
    if (!redirectAddress || typeof redirectAddress === "string") throw new Error("redirector did not bind")

    try {
      const client = new AppRunnerClient({
        baseUrl: `http://127.0.0.1:${redirectAddress.port}`,
        authSecret: "secret",
      })
      const response = await client.fetchServing("/redirect", identity, "workspace")
      expect(response.status).toBe(302)
      expect(received).toEqual([])
    } finally {
      redirector.close()
      collector.close()
    }
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
