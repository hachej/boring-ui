import { afterEach, describe, expect, it, vi } from "vitest"
import { requestAgentLabel } from "./data"

afterEach(() => vi.unstubAllGlobals())

describe("GitHub PR tracker Agent selection", () => {
  it("uses the provider-selected non-default Agent for create and prompt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ agentTypeId: "beta", sessionId: "shared" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ accepted: true, cursor: 1, clientNonce: "nonce" }))
    vi.stubGlobal("fetch", fetchMock)

    await requestAgentLabel("beta", 1029, ["ready"], [])

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/agents/beta/sessions",
      "/api/v1/agents/beta/sessions/shared/prompt",
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ requestId: expect.any(String) })
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({ requestId: expect.any(String), clientNonce: expect.any(String) })
  })
})
