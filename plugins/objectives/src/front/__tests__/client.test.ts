import { afterEach, describe, expect, it, vi } from "vitest"
import { createObjectivesClient, ObjectivesClientError } from "../client"

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("createObjectivesClient", () => {
  it("calls objective.v1.list through the workspace-bridge endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/v1/workspace-bridge/call")
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ op: "objective.v1.list", input: {} })
      return jsonResponse({ ok: true, output: { objectives: [{ id: "obj_1", title: "Ship v2" }] } })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createObjectivesClient()
    await expect(client.list()).resolves.toEqual([{ id: "obj_1", title: "Ship v2" }])
  })

  it("passes a status filter to objective.v1.list", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ op: "objective.v1.list", input: { status: "paused" } })
      return jsonResponse({ ok: true, output: { objectives: [] } })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createObjectivesClient()
    await expect(client.list("paused")).resolves.toEqual([])
  })

  it("gets a single objective through objective.v1.get", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, output: { objective: { id: "obj_1" } } }))
    vi.stubGlobal("fetch", fetchMock)

    const client = createObjectivesClient()
    await expect(client.get("obj_1")).resolves.toEqual({ id: "obj_1" })
  })

  it("creates an objective through objective.v1.create", async () => {
    const fetchMock = vi.fn(async (_input, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.op).toBe("objective.v1.create")
      expect(body.input).toMatchObject({ title: "Ship v2" })
      return jsonResponse({ ok: true, output: { objective: { id: "obj_1", title: "Ship v2" } } })
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createObjectivesClient()
    await expect(client.create({
      title: "Ship v2",
      objective: "Ship the v2 rewrite",
      metric: "WAU",
      baseline: 100,
      target: 500,
    })).resolves.toMatchObject({ id: "obj_1" })
  })

  it("updates an objective through objective.v1.update", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, output: { objective: { id: "obj_1", current: 250 } } }))
    vi.stubGlobal("fetch", fetchMock)

    const client = createObjectivesClient()
    await expect(client.update({ id: "obj_1", current: 250 })).resolves.toMatchObject({ current: 250 })
  })

  it("throws ObjectivesClientError on a bridge error response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: { code: "BRIDGE_INVALID_REQUEST", message: "bad input" } }, 400))
    vi.stubGlobal("fetch", fetchMock)

    const client = createObjectivesClient()
    await expect(client.get("missing")).rejects.toMatchObject({
      code: "BRIDGE_INVALID_REQUEST",
      message: "bad input",
    })
    await expect(client.get("missing")).rejects.toBeInstanceOf(ObjectivesClientError)
  })
})
