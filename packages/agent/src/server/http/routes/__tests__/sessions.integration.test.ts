// In-process integration test for sessions routes.
//
// The existing sessions.test.ts uses `app.inject()` which bypasses the JSON
// content-type parser — same blind spot that hid the file DELETE bug. This
// file boots a real Fastify on a real port and hits it with real `fetch`
// using the exact request shapes `useSessions` (front/hooks/useSessions.ts)
// sends. Catches header/body contract drift between client and server.
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sessionRoutes, InMemorySessionStore } from "../sessions"
import type { AgentHarness } from "../../../../shared/harness"

// Minimal harness — only the `sessions` API matters for the route handlers
// covered here. `sendMessage` isn't exercised by /api/v1/agent/sessions/*.
function createTestHarness(): AgentHarness {
  const store = new InMemorySessionStore()
  return {
    id: "test-harness",
    placement: "server",
    sendMessage: () => {
      throw new Error("sendMessage not used in these tests")
    },
    sessions: store,
  }
}

let app: FastifyInstance
let baseUrl: string

beforeEach(async () => {
  app = Fastify({ logger: false })
  const harness = createTestHarness()
  await app.register(sessionRoutes, {
    harness,
    workdir: "/tmp/test",
  })
  await app.ready()
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" })
})

afterEach(async () => {
  await app.close()
})

describe("sessions routes ↔ real fetch (in-process integration)", () => {
  // --- GET / : list ---
  it("GET /api/v1/agent/sessions returns [] from a fresh store", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // --- POST / : create ---
  it("POST /api/v1/agent/sessions creates with the body's title", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "My session" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.title).toBe("My session")
  })

  // REGRESSION-CLASS: empty body with application/json content-type would
  // have triggered FST_ERR_CTP_EMPTY_JSON_BODY (the file DELETE bug). For
  // POST that's harder — the body is required — but `useSessions.create({})`
  // sends `body: JSON.stringify({})` so an empty-object body must work.
  it("POST /api/v1/agent/sessions accepts empty body (no title) — matches useSessions.create() default", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBeTruthy()
  })

  it("POST /api/v1/agent/sessions rejects malformed JSON with 400 (not crash)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    })
    expect(res.status).toBe(400)
  })

  // --- DELETE /:id : the bug shape that bit us in fileRoutes ---
  // useSessions.delete sends `{ method: 'DELETE' }` with NO body and NO
  // Content-Type — this test pins that exact shape works.
  it("DELETE /api/v1/agent/sessions/:id works WITHOUT Content-Type header (body-less DELETE)", async () => {
    // First create one to delete.
    const created = await (
      await fetch(`${baseUrl}/api/v1/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    ).json()
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions/${encodeURIComponent(created.id)}`, {
      method: "DELETE",
    })
    expect(res.status).toBeLessThan(400)
  })

  // REGRESSION: same body-less DELETE but accidentally carrying
  // Content-Type: application/json (the bug shape from file.ts). Fastify's
  // JSON parser rejects with FST_ERR_CTP_EMPTY_JSON_BODY → 400 → UI
  // surfaces "Delete failed HTTP 400". Pin that this is what happens, so a
  // future client adding a Content-Type header to DELETEs will trip this.
  it("DELETE with Content-Type: application/json + no body returns 400 (the file-route bug shape)", async () => {
    const created = await (
      await fetch(`${baseUrl}/api/v1/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    ).json()
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions/${encodeURIComponent(created.id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    })
    expect(res.status).toBe(400)
  })

  it("DELETE returns 404 when session does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions/nonexistent-id`, {
      method: "DELETE",
    })
    expect(res.status).toBe(404)
  })

  // --- list reflects created/deleted ---
  it("create + list + delete reflect store state at every step", async () => {
    const created = await (
      await fetch(`${baseUrl}/api/v1/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "lifecycle" }),
      })
    ).json()

    const listed = await (await fetch(`${baseUrl}/api/v1/agent/sessions`)).json()
    expect(listed.map((s: { id: string }) => s.id)).toContain(created.id)

    await fetch(`${baseUrl}/api/v1/agent/sessions/${encodeURIComponent(created.id)}`, { method: "DELETE" })

    const after = await (await fetch(`${baseUrl}/api/v1/agent/sessions`)).json()
    expect(after.map((s: { id: string }) => s.id)).not.toContain(created.id)
  })

  // --- header / body invariants ---
  it("list response is JSON with content-type: application/json", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions`)
    expect(res.headers.get("content-type")).toMatch(/^application\/json/)
  })

  // --- GET /:id : detail ---
  it("GET /api/v1/agent/sessions/:id returns 404 when session does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions/missing`)
    expect(res.status).toBe(404)
  })

  it("GET /api/v1/agent/sessions/:id returns the session detail when it exists", async () => {
    const created = await (
      await fetch(`${baseUrl}/api/v1/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "detail" }),
      })
    ).json()
    const res = await fetch(`${baseUrl}/api/v1/agent/sessions/${encodeURIComponent(created.id)}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(created.id)
    expect(body.title).toBe("detail")
  })
})
