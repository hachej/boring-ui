import { describe, expect, it, vi } from "vitest"
import type { RemoteCapabilityDescriptor } from "../../../shared/tool.js"
import { buildVerifiedRemoteCapability } from "./remoteCapabilities.js"

const context = {
  abortSignal: new AbortController().signal,
  workdir: "/workspace",
  workspaceId: "acme",
  userId: "alice",
  userEmail: "alice@example.com",
}

const descriptor = (): RemoteCapabilityDescriptor => ({
  kind: "app",
  workspaceId: "acme",
  address: "acme/guestbook",
  version: 2,
  sha: "sha-2",
  toolName: "count",
  description: "Count entries",
  inputSchema: { type: "object", properties: { tag: { type: "string" } } },
})

const current = (overrides: Record<string, unknown> = {}) => ({
  version: 2,
  kind: "app",
  sha: "sha-2",
  manifest: { tools: [{ name: "count", description: "Count entries", input: descriptor().inputSchema }] },
  ...overrides,
})

describe("remote capability admission", () => {
  it("refuses any function-valued descriptor property", async () => {
    const forged = { ...descriptor(), nested: { execute: () => "local" } }
    await expect(buildVerifiedRemoteCapability(forged, context)).rejects.toThrow(/without functions/)
  })

  it("refuses an ordinary AgentTool callback on the descriptor channel", async () => {
    const execute = vi.fn()
    await expect(buildVerifiedRemoteCapability({
      name: "local_callback",
      description: "run caller code",
      parameters: { type: "object" },
      execute,
    }, context)).rejects.toThrow(/without functions/)
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ["workspace", { workspaceId: "victim" }],
    ["version", { version: 3 }],
    ["sha", { sha: "forged" }],
  ])("refuses a descriptor whose %s does not match the hub", async (_field, patch) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(current())))
    await expect(buildVerifiedRemoteCapability({ ...descriptor(), ...patch }, context, { baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toThrow(/workspace|manifest/)
  })

  it("refuses a tool absent from the fresh manifest", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(current({ manifest: { tools: [] } }))))
    await expect(buildVerifiedRemoteCapability(descriptor(), context, { baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toThrow(/fresh hub manifest/)
  })

  it("builds the executor itself and dispatches the exact hub request", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("/current")
      ? new Response(JSON.stringify(current()))
      : new Response(JSON.stringify({ count: 4 })))
    const tool = await buildVerifiedRemoteCapability(descriptor(), context, { baseUrl: "http://hub", token: "secret", fetchImpl: fetchImpl as typeof fetch })
    const response = await tool.execute({ tag: "open" }, { ...context, toolCallId: "call-1" })

    expect(response.details).toEqual({ count: 4 })
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      "http://hub/w/acme/guestbook/tools/count?version=2",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ tag: "open" }) }),
    )
    const secondCall = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect((secondCall[1].headers as Record<string, string>).Authorization).toBe("Bearer secret")
  })

  it("does not let later descriptor or mounted-tool mutation replace execution", async () => {
    const source = descriptor() as RemoteCapabilityDescriptor & { toolName: string }
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("/current")
      ? new Response(JSON.stringify(current()))
      : new Response(JSON.stringify({ ok: true })))
    const tool = await buildVerifiedRemoteCapability(source, context, { baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch })
    source.toolName = "evil"
    expect(() => {
      ;(tool as { execute: typeof tool.execute }).execute = vi.fn()
    }).toThrow()
    await tool.execute({}, { ...context, toolCallId: "call-1" })
    expect(fetchImpl.mock.calls[1]![0]).toContain("/tools/count?version=2")
  })

  it("re-verifies and rebuilds on every refresh", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(current())))
    const first = await buildVerifiedRemoteCapability(descriptor(), context, { baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch })
    const second = await buildVerifiedRemoteCapability(descriptor(), context, { baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch })
    expect(first).not.toBe(second)
    expect(first.execute).not.toBe(second.execute)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
