import { vi } from "vitest"

vi.mock("@boring/agent/server", () => ({}))

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FileAskUserStore } from "../AskUserStore"
import { AskUserRuntime } from "../AskUserRuntime"
import { createAskUserTool } from "../createAskUserTool"
import { createAskUserServerPlugin } from "../askUserServerPlugin"

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer" }] }

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ask-user-plugin-"))
  const store = new FileAskUserStore(join(dir, "questions.json"))
  const runtime = new AskUserRuntime({ store })
  return { store, runtime }
}

describe("ask-user Pi tool", () => {
  it("registers one ask_user tool and rejects invalid input immediately", async () => {
    const { runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    expect(tool.name).toBe("ask_user")
    await expect(tool.execute("call", {}, undefined)).resolves.toMatchObject({ isError: true })
  })

  it("returns cancelled tool results as tool errors", async () => {
    const { runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    await expect(tool.execute("call", { title: "Need input", schema }, AbortSignal.timeout(1))).resolves.toMatchObject({ isError: true })
  })

  it("requires schema for non-obvious multi-field requests instead of making a fake A/B form", async () => {
    const { store, runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    const result = await tool.execute("call", { title: "Details needed", context: "Need name, priority, and notes." }, undefined)
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]?.text).toContain("schema")
    await expect(store.getPending("s1")).resolves.toBeNull()
  })

  it("returns thrown runtime failures as tool errors", async () => {
    const { runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: () => { throw new Error("session missing") } })
    await expect(tool.execute("call", { title: "Need input", schema }, undefined)).resolves.toMatchObject({ isError: true })
  })

  it("uses tool execution session id when the harness provides one", async () => {
    const { store, runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "fallback" })
    const pendingResult = tool.execute("call", { title: "Need input", schema, timeoutMs: 60_000 }, undefined, "chat-session")
    let pending = await store.getPending("chat-session")
    await vi.waitFor(async () => {
      pending = await store.getPending("chat-session")
      expect(pending).toMatchObject({ status: "ready", title: "Need input" })
    })
    await runtime.submitAnswer(pending!.questionId, "chat-session", { answer: "ok" })
    await expect(pendingResult).resolves.toMatchObject({ details: { status: "answered" } })
    await expect(store.getPending("fallback")).resolves.toBeNull()
  })

  it("valid input creates pending question and waits for runtime answer", async () => {
    const { store, runtime } = await fixture()
    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    const pendingResult = tool.execute("call", { title: "Need input", schema, timeoutMs: 60_000 }, undefined)
    let pending = await store.getPending("s1")
    await vi.waitFor(async () => {
      pending = await store.getPending("s1")
      expect(pending).toMatchObject({ status: "ready", title: "Need input" })
    })
    await vi.waitFor(async () => {
      await runtime.submitAnswer(pending!.questionId, "s1", { answer: "ok" })
      await expect(pendingResult).resolves.toMatchObject({ details: { status: "answered" } })
    })
  })
})

describe("createAskUserServerPlugin", () => {
  it("exports routes and agent tool without @hachej/boring-agent ask-user APIs", async () => {
    const { store, runtime } = await fixture()
    const plugin = createAskUserServerPlugin({ store, runtime, sessionId: "s1" })
    expect(plugin.id).toBe("ask-user")
    expect(plugin.routes).toEqual(expect.any(Function))
    expect(plugin.agentTools).toHaveLength(1)
  })
})
