import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useInboxSessionTitles } from "../sessionTitleClient"

afterEach(() => vi.unstubAllGlobals())

describe("useInboxSessionTitles", () => {
  it("resolves bounded authorized session names without exposing missing ids as labels", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      summaries: [{ ref: { agentTypeId: "alpha", sessionId: "s1" }, title: "Release planning" }],
      omittedSessionIds: ["denied"],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useInboxSessionTitles({
      agentTypeId: "alpha",
      apiBaseUrl: "",
      headers: { authorization: "Bearer test" },
      sessionIds: ["s1", "denied", "s1"],
    }))

    await waitFor(() => expect(result.current.get("s1")).toBe("Release planning"))
    expect(result.current.has("denied")).toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/agents/alpha/sessions/summaries", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sessionIds: ["denied", "s1"] }),
    }))
  })
})
