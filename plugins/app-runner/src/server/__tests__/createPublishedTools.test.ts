// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import { AppRunnerClient } from "../appRunnerClient"
import { createPublishedToolsProvider } from "../createPublishedTools"
import { MemoryAppRunnerStore } from "./memoryAppRunnerStore"

const context: ToolExecContext = {
  abortSignal: new AbortController().signal,
  toolCallId: "call-1",
  workspaceId: "acme",
  userId: "alice",
  userEmail: "alice@example.com",
}

function current(version: number, tools: Array<{ name: string; description: string; input: Record<string, unknown>; route: string }>) {
  return { version, kind: "app", sha: `sha-${version}`, contentSha: `content-${version}`, manifest: { tools } }
}

async function seededStore() {
  const store = new MemoryAppRunnerStore()
  await store.upsertApp({ appName: "guestbook", workspaceId: "acme", kind: "app", version: 1, sha: "sha-1", url: "url", updatedAt: "now", toolManifest: { tools: [] } })
  return store
}

describe("published manifest native tools", () => {
  it("maps manifest schema to a named native tool and executes remotely with acting identity", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/current")
      ? new Response(JSON.stringify(current(1, [{ name: "count_entries", description: "Count entries", input: { type: "object", properties: {} }, route: "/api/count" }])))
      : new Response(JSON.stringify({ count: 3 })))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", token: "tok", fetchImpl: fetchImpl as typeof fetch }), store: await seededStore() })

    const tools = await provider(context)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: "app_guestbook_count_entries", description: "Count entries", parameters: { type: "object" } })
    const result = await tools[0]!.execute({}, context)
    expect(result.details).toEqual({ count: 3 })
    const [, init] = fetchImpl.mock.calls[1]!
    expect(JSON.parse((init!.headers as Record<string, string>)["X-Boring-User"]!)).toMatchObject({ id: "alice", email: "alice@example.com" })
  })

  it("refreshes the tool set when current reports a newly published version", async () => {
    let version = 1
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(current(version, version === 1
      ? [{ name: "count", description: "Count", input: {}, route: "/count" }]
      : [{ name: "pin_entry", description: "Pin", input: { type: "object" }, route: "/pin" }]))))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", token: "tok", fetchImpl: fetchImpl as typeof fetch }), store: await seededStore() })

    expect((await provider(context)).map((tool) => tool.name)).toEqual(["app_guestbook_count"])
    version = 2
    expect((await provider(context)).map((tool) => tool.name)).toEqual(["app_guestbook_pin_entry"])
  })

  it("mounts only the acting user's profile tools", async () => {
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({ appName: "profile-alice", workspaceId: "acme", ownerUserId: "alice", kind: "profile", version: 1, sha: "a", url: "a", updatedAt: "now" })
    await store.upsertApp({ appName: "profile-bob", workspaceId: "acme", ownerUserId: "bob", kind: "profile", version: 1, sha: "b", url: "b", updatedAt: "now" })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      version: 1, kind: "profile", sha: "a", contentSha: "c",
      manifest: { tools: [{ name: "remember", description: "Remember", input: {}, route: "/remember" }] },
    })))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }), store })

    expect((await provider(context)).map((tool) => tool.name)).toEqual(["profile_remember"])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("never mounts or executes a victim workspace record in an attacker context", async () => {
    const store = await seededStore()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(current(1, [{ name: "count", description: "Count", input: {}, route: "/count" }]))))
    const provider = createPublishedToolsProvider({
      client: new AppRunnerClient({ baseUrl: "http://hub", token: "tok", fetchImpl: fetchImpl as typeof fetch }),
      store,
    })

    const tools = await provider({ ...context, workspaceId: "attacker" })

    expect(tools).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("does not mount an unpublished on-disk tools.json edit", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(current(1, [])))) as unknown as typeof fetch
    const provider = createPublishedToolsProvider({
      client: new AppRunnerClient({ baseUrl: "http://hub", token: "tok", fetchImpl }),
      store: await seededStore(),
    })
    // The provider has no filesystem input by design: only GET /current is authoritative.
    expect(await provider(context)).toEqual([])
  })
})
