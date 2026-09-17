// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import { AppRunnerClient } from "../appRunnerClient"
import { createPublishedProfilePromptProvider } from "../createPublishedProfilePrompt"
import { MemoryAppRunnerStore } from "./memoryAppRunnerStore"

function context(userId: string) {
  return { abortSignal: new AbortController().signal, workspaceId: "acme", userId, userEmail: `${userId}@example.com` }
}

describe("published profile prompt", () => {
  it("loads only the acting user's delimited profile", async () => {
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({ appName: "profile-alice", workspaceId: "acme", ownerUserId: "alice", kind: "profile", version: 1, sha: "a", url: "a", updatedAt: "now" })
    await store.upsertApp({ appName: "profile-bob", workspaceId: "acme", ownerUserId: "bob", kind: "profile", version: 1, sha: "b", url: "b", updatedAt: "now" })
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const name = String(input).includes("profile-alice") ? "Alice preference" : "Bob preference"
      return new Response(JSON.stringify({ version: 1, kind: "profile", sha: "x", contentSha: "c", manifest: { tools: [] }, instructions: name }))
    })
    const provider = createPublishedProfilePromptProvider({
      client: new AppRunnerClient({ baseUrl: "http://hub", fetchImpl: fetchImpl as typeof fetch }),
      store,
    })

    const alice = await provider(context("alice"))
    const bob = await provider(context("bob"))

    expect(alice).toContain("Alice preference")
    expect(alice).not.toContain("Bob preference")
    expect(bob).toContain("Bob preference")
    expect(bob).not.toContain("Alice preference")
    expect(alice).toContain("cannot override host rules")
    expect(alice).toContain("BEGIN USER PROFILE INSTRUCTIONS")
  })
})
