import { afterEach, describe, expect, test, vi } from "vitest"
import { readFileRecords } from "../fileRecords"

const originalWindow = globalThis.window

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
  })
})

function mockFetch(body: unknown = { rows: [], total: 0, hasMore: false }): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

describe("readFileRecords", () => {
  test("calls the records endpoint with query params", async () => {
    const fetch = mockFetch({ path: "data/niches.json", rows: [{ id: 1 }] })

    const result = await readFileRecords({
      apiBaseUrl: "http://localhost:3000/",
      path: "data/niches.json",
      offset: 10,
      limit: 25,
      q: "climate",
    })

    expect(result).toEqual({ path: "data/niches.json", rows: [{ id: 1 }] })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe("http://localhost:3000/api/v1/files/records?path=data%2Fniches.json&offset=10&limit=25&q=climate")
    expect(init).toMatchObject({ method: "GET", headers: {} })
  })

  test("sends provided workspace id and custom headers", async () => {
    const fetch = mockFetch()

    await readFileRecords({
      path: "data.json",
      headers: { Authorization: "Bearer token" },
      workspaceId: "ws_123",
    })

    expect(fetch.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer token",
      "x-boring-workspace-id": "ws_123",
    })
  })

  test("derives CLI workspace id from location without React hooks", async () => {
    Object.defineProperty(globalThis, "window", {
      value: { location: { pathname: "/workspace/active-workspace" } },
      configurable: true,
    })
    const fetch = mockFetch()

    await readFileRecords({ path: "data.json" })

    expect(fetch.mock.calls[0][1].headers).toEqual({
      "x-boring-workspace-id": "active-workspace",
    })
  })

  test("preserves explicit workspace header", async () => {
    const fetch = mockFetch()

    await readFileRecords({
      path: "data.json",
      headers: { "X-Boring-Workspace-Id": "explicit" },
      workspaceId: "ignored",
    })

    expect(fetch.mock.calls[0][1].headers).toEqual({ "X-Boring-Workspace-Id": "explicit" })
  })

  test("passes abort signal", async () => {
    const fetch = mockFetch()
    const controller = new AbortController()

    await readFileRecords({ path: "data.json", signal: controller.signal })

    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })
})
