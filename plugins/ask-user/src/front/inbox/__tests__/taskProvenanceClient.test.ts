import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveRelatedTasks } from "../taskProvenanceClient"

afterEach(() => vi.unstubAllGlobals())

describe("resolveRelatedTasks", () => {
  it("deduplicates exact native session IDs and normalizes bounded task summaries", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
      ok: true,
      matches: [{ sessionId: "s1", tasks: [
        { adapterId: "github", taskId: "1", number: "#1", title: "One", statusId: "todo", url: "https://example.test/1" },
        { adapterId: "github", taskId: 2, number: "#2", title: "Invalid", statusId: "todo" },
      ] }],
      omittedSessionIds: ["denied"],
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(resolveRelatedTasks({ apiBaseUrl: "/api", headers: { "x-boring-workspace-id": "trusted" }, sessionIds: ["s1", "s1", "denied"] })).resolves.toEqual({
      matches: [{ sessionId: "s1", tasks: [{ adapterId: "github", taskId: "1", number: "#1", title: "One", statusId: "todo", url: "https://example.test/1" }] }],
      omittedSessionIds: ["denied"],
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ sessionIds: ["s1", "denied"] })
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include", signal: undefined })
  })

  it("treats an unavailable Tasks route as an optional empty enhancement", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })))
    await expect(resolveRelatedTasks({ apiBaseUrl: "", sessionIds: ["s1"] })).resolves.toEqual({ matches: [], omittedSessionIds: ["s1"] })
  })

  it("rejects route errors without leaking response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret backend details", { status: 403 })))
    await expect(resolveRelatedTasks({ apiBaseUrl: "", sessionIds: ["denied"] })).rejects.toThrow("related task resolution failed (403)")
  })
})
