import { afterEach, describe, expect, it, vi } from "vitest"
import { sendCcusageAgentChat } from "./agentChat"

afterEach(() => vi.unstubAllGlobals())

describe("sendCcusageAgentChat", () => {
  it("uses the provider-selected non-default Agent and header-only workspace scope", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ agentTypeId: "beta", sessionId: "shared" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ accepted: true, cursor: 1, clientNonce: "nonce" }))
    vi.stubGlobal("fetch", fetchMock)

    await sendCcusageAgentChat("beta", "refresh", "workspace-beta")

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/agents/beta/sessions",
      "/api/v1/agents/beta/sessions/shared/prompt",
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers).toMatchObject({ "x-boring-workspace-id": "workspace-beta" })
    }
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("workspaceId="))).toBe(true)
  })
})
