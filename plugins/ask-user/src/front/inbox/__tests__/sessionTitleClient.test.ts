import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useInboxSessionTitles } from "../sessionTitleClient"

afterEach(() => vi.unstubAllGlobals())

describe("useInboxSessionTitles", () => {
  it("resolves bounded authorized session names without exposing missing ids as labels", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/denied/")
      ? Response.json({ error: { code: "AGENT_SESSION_NOT_FOUND" } }, { status: 404 })
      : Response.json({ summary: { title: "Release planning" } }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useInboxSessionTitles({
      agentTypeId: "alpha",
      apiBaseUrl: "",
      headers: { authorization: "Bearer test" },
      sessionIds: ["s1", "denied", "s1"],
    }))

    await waitFor(() => expect(result.current.get("s1")).toBe("Release planning"))
    expect(result.current.has("denied")).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/agents/alpha/sessions/s1/state", expect.objectContaining({ method: "GET" }))
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/agents/alpha/sessions/denied/state", expect.objectContaining({ method: "GET" }))
  })
})
