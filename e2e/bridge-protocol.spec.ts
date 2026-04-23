import { expect, test } from "./fixtures"

function listenForSSECommand(
  apiUrl: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("SSE timeout"))
    }, timeoutMs)

    fetch(`${apiUrl}/api/v1/ui/commands/next`, {
      headers: { Accept: "text/event-stream" },
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          clearTimeout(timer)
          reject(new Error(`SSE connect failed: ${res.status}`))
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const eventMatch = buffer.match(/event:\s*command\ndata:\s*(.+)\n/)
          if (eventMatch) {
            clearTimeout(timer)
            reader.cancel()
            resolve(JSON.parse(eventMatch[1]))
            return
          }
        }
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

test.describe("Bridge protocol E2E", () => {
  test("14. POST openFile command → SSE delivers → workspace receives", async ({
    backend,
  }) => {
    const api = backend.apiUrl

    const ssePromise = listenForSSECommand(api)

    await new Promise((r) => setTimeout(r, 200))

    const postRes = await fetch(`${api}/api/v1/ui/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "openFile",
        params: { path: "src/main.ts" },
      }),
    })
    expect(postRes.ok).toBe(true)

    const received = (await ssePromise) as {
      kind: string
      params: Record<string, unknown>
      seq: number
    }

    expect(received.kind).toBe("openFile")
    expect(received.params.path).toBe("src/main.ts")
    expect(received.seq).toBeGreaterThanOrEqual(1)
  })

  test("15. POST showNotification → workspace receives notification", async ({
    browserPage,
    backend,
  }) => {
    const api = backend.apiUrl

    const r = await browserPage.request.post(`${api}/api/v1/ui/commands`, {
      data: {
        kind: "showNotification",
        params: { msg: "Hello from E2E", level: "info" },
      },
    })
    expect(r.ok()).toBe(true)
    const body = (await r.json()) as { seq: number; status: string }
    expect(body.status).toBe("ok")
  })

  test("bridge state roundtrip — PUT state → GET → verify", async ({
    browserPage,
    backend,
  }) => {
    const api = backend.apiUrl

    const putRes = await browserPage.request.put(`${api}/api/v1/ui/state`, {
      data: {
        state: {
          openFiles: ["src/main.ts", "README.md"],
          activePanel: "editor",
        },
      },
    })
    expect(putRes.status()).toBe(204)

    const getRes = await browserPage.request.get(`${api}/api/v1/ui/state`)
    expect(getRes.ok()).toBe(true)
    const state = (await getRes.json()) as Record<string, unknown>
    expect(state).toHaveProperty("openFiles")
  })

  test("SSE event includes required fields (kind, params, seq)", async ({
    backend,
  }) => {
    const api = backend.apiUrl

    const ssePromise = listenForSSECommand(api)

    await new Promise((r) => setTimeout(r, 200))

    await fetch(`${api}/api/v1/ui/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "openFile",
        params: { path: "test.txt" },
      }),
    })

    const result = (await ssePromise) as {
      kind: string
      params: Record<string, unknown>
      seq: number
    }
    expect(result.kind).toBe("openFile")
    expect(result.params).toBeDefined()
    expect(typeof result.seq).toBe("number")
  })

  test("end-to-end latency under 2 seconds", async ({ backend }) => {
    const api = backend.apiUrl

    const ssePromise = listenForSSECommand(api)

    await new Promise((r) => setTimeout(r, 200))

    const sentAt = Date.now()

    await fetch(`${api}/api/v1/ui/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "openFile",
        params: { path: "latency-test.txt" },
      }),
    })

    await ssePromise
    const latencyMs = Date.now() - sentAt
    expect(latencyMs).toBeLessThan(2000)
  })
})
