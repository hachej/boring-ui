// @vitest-environment node

import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import { AppRunnerClient } from "../appRunnerClient"
import { createPublishedToolsProvider } from "../createPublishedTools"
import { profileAppName } from "../profileAddress"
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

const segment = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20)

describe("published manifest native tools", () => {
  it("maps manifest schema to a named native tool and executes remotely with acting identity", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/current")
      ? new Response(JSON.stringify(current(1, [{ name: "count_entries", description: "Count entries", input: { type: "object", properties: {} }, route: "/api/count" }])))
      : new Response(JSON.stringify({ count: 3 })))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", token: "tok", fetchImpl: fetchImpl as typeof fetch }), store: await seededStore() })

    const tools = await provider(context)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      name: `app_${segment("guestbook")}_${segment("count_entries")}`,
      description: "Count entries",
      parameters: { type: "object" },
      provenance: { kind: "app", address: "acme/guestbook", version: 1, sha: "sha-1" },
    })
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const result = await tools[0]!.execute({}, context)
    expect(result.details).toEqual({ count: 3 })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"published_tool_call"'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"sha":"sha-1"'))
    log.mockRestore()
    const [, init] = fetchImpl.mock.calls[1]!
    expect(JSON.parse((init!.headers as Record<string, string>)["X-Boring-User"]!)).toMatchObject({ id: "alice", email: "alice@example.com" })
  })

  it("refreshes the tool set when current reports a newly published version", async () => {
    let version = 1
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(current(version, version === 1
      ? [{ name: "count", description: "Count", input: {}, route: "/count" }]
      : [{ name: "pin_entry", description: "Pin", input: { type: "object" }, route: "/pin" }]))))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", token: "tok", fetchImpl: fetchImpl as typeof fetch }), store: await seededStore() })

    expect((await provider(context)).map((tool) => tool.name)).toEqual([`app_${segment("guestbook")}_${segment("count")}`])
    version = 2
    expect((await provider(context)).map((tool) => tool.name)).toEqual([`app_${segment("guestbook")}_${segment("pin_entry")}`])
  })

  it("mounts only the acting user's profile tools", async () => {
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({ appName: profileAppName("alice"), workspaceId: "acme", ownerUserId: "alice", kind: "profile", version: 1, sha: "a", url: "a", updatedAt: "now" })
    await store.upsertApp({ appName: profileAppName("bob"), workspaceId: "acme", ownerUserId: "bob", kind: "profile", version: 1, sha: "b", url: "b", updatedAt: "now" })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      version: 1, kind: "profile", sha: "a", contentSha: "c",
      manifest: { tools: [{ name: "remember", description: "Remember", input: {}, route: "/remember" }] },
    })))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }), store })

    expect((await provider(context)).map((tool) => tool.name)).toEqual([`profile_${segment("remember")}`])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("ignores stored kind and owner fields that disguise another user's profile", async () => {
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({
      appName: profileAppName("victim"), workspaceId: "acme", ownerUserId: "alice", kind: "app",
      version: 1, sha: "a", url: "a", updatedAt: "now",
    })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      version: 1, kind: "profile", sha: "a", contentSha: "c",
      manifest: { tools: [{ name: "steal", description: "Steal", input: {}, route: "/steal" }] },
    })))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }), store })

    expect(await provider(context)).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("re-checks the derived profile address when a discovered tool executes", async () => {
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({ appName: profileAppName("alice"), workspaceId: "acme", kind: "app", version: 1, sha: "a", url: "a", updatedAt: "now" })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      version: 1, kind: "profile", sha: "a", contentSha: "c",
      manifest: { tools: [{ name: "remember", description: "Remember", input: {}, route: "/remember" }] },
    })))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }), store })
    const tool = (await provider(context))[0]!

    const response = await tool.execute({}, { ...context, userId: "attacker" })
    expect(response.isError).toBe(true)
    expect(response.content[0]?.text).toContain("profile address does not match")
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

  it("surfaces and refreshes an atomic version mismatch when activation races dispatch", async () => {
    let currentCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/tools/count?version=1")) {
        return new Response(JSON.stringify({ error: "version_mismatch", expectedVersion: 1, currentVersion: 2 }), { status: 409 })
      }
      currentCalls += 1
      return new Response(JSON.stringify(current(currentCalls === 1 ? 1 : 2, [{ name: "count", description: "Count", input: {}, route: "/count" }])))
    })
    const store = await seededStore()
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }), store })
    const stale = (await provider(context))[0]!

    const response = await stale.execute({}, context)

    expect(response.isError).toBe(true)
    expect(response.content[0]?.text).toContain("Retry after the tool inventory refreshes")
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "http://hub/w/acme/guestbook/current",
      "http://hub/w/acme/guestbook/tools/count?version=1",
      "http://hub/w/acme/guestbook/current",
    ])
    expect((await store.listApps())[0]?.version).toBe(2)
  })

  it("escapes names injectively and rejects duplicate manifest entries", async () => {
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({ appName: "guest-book", workspaceId: "acme", kind: "app", version: 1, sha: "a", url: "a", updatedAt: "now" })
    await store.upsertApp({ appName: "guest", workspaceId: "acme", kind: "app", version: 1, sha: "b", url: "b", updatedAt: "now" })
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("guest-book")
      ? current(1, [{ name: "count", description: "Count", input: {}, route: "/count" }])
      : current(1, [{ name: "book_count", description: "Count", input: {}, route: "/count" }]))))
    const provider = createPublishedToolsProvider({ client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }), store })

    const names = (await provider(context)).map((tool) => tool.name)
    expect(new Set(names).size).toBe(2)

    const duplicateStore = new MemoryAppRunnerStore()
    await duplicateStore.upsertApp({ appName: "dupe", workspaceId: "acme", kind: "app", version: 1, sha: "d", url: "d", updatedAt: "now" })
    const duplicateProvider = createPublishedToolsProvider({
      client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: vi.fn(async () => new Response(JSON.stringify(current(1, [
        { name: "same", description: "A", input: {}, route: "/a" },
        { name: "same", description: "B", input: {}, route: "/b" },
      ])))) as typeof fetch }),
      store: duplicateStore,
    })
    await expect(duplicateProvider(context)).rejects.toThrow(/collision/)
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
