import { vi } from "vitest"

vi.mock("@boring/agent/server", () => ({}))

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FileAskUserStore } from "../AskUserStore"
import { AskUserRuntime } from "../AskUserRuntime"
import { createAskUserPiExtensionFactory, type AskUserPiToolDefinition } from "../createAskUserPiExtensionFactory"
import { createAskUserServerPlugin } from "../askUserServerPlugin"

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer" }] }

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ask-user-plugin-"))
  const store = new FileAskUserStore(join(dir, "questions.json"))
  const runtime = new AskUserRuntime({ store })
  return { store, runtime }
}

function register(factory: ReturnType<typeof createAskUserPiExtensionFactory>): AskUserPiToolDefinition {
  const registerTool = vi.fn()
  factory({ registerTool })
  expect(registerTool).toHaveBeenCalledOnce()
  return registerTool.mock.calls[0]![0]
}

describe("ask-user Pi extension", () => {
  it("registers one ask_user tool and rejects invalid input immediately", async () => {
    const { runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
    expect(tool.name).toBe("ask_user")
    await expect(tool.execute("call", {}, undefined)).resolves.toMatchObject({ isError: true })
  })

  it("returns cancelled tool results as tool errors", async () => {
    const { runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
    await expect(tool.execute("call", { title: "Need input", schema }, AbortSignal.timeout(1))).resolves.toMatchObject({ isError: true })
  })

  it("accepts JSON-schema style required arrays from model tool calls", async () => {
    const { store, runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
    const pendingResult = tool.execute("call", {
      title: "Project details",
      required: ["title"],
      schema: {
        wireVersion: 1,
        required: ["project"],
        fields: [
          { type: "text", name: "project", label: "Project" },
          { type: "checkbox", name: "confirmed", label: "Confirmed" },
        ],
      },
    }, undefined)
    let pending = await store.getPending("s1")
    await vi.waitFor(async () => {
      pending = await store.getPending("s1")
      expect(pending?.schema?.fields[0]).toMatchObject({ name: "project", required: true })
    })
    await runtime.submitAnswer(pending!.questionId, "s1", { project: "demo", confirmed: true })
    await expect(pendingResult).resolves.toMatchObject({ details: { status: "answered" } })
  })

  it("accepts JSON-schema properties from model tool calls", async () => {
    const { store, runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
    const pendingResult = tool.execute("call", {
      title: "Project details",
      schema: {
        type: "object",
        required: ["project", "priority"],
        properties: {
          project: { type: "string", title: "Project" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          confirmed: { type: "boolean", title: "Confirmed" },
        },
      },
    }, undefined)
    let pending = await store.getPending("s1")
    await vi.waitFor(async () => {
      pending = await store.getPending("s1")
      expect(pending?.schema?.fields).toEqual([
        expect.objectContaining({ name: "project", type: "text", required: true }),
        expect.objectContaining({ name: "priority", type: "select", required: true }),
        expect.objectContaining({ name: "confirmed", type: "checkbox" }),
      ])
    })
    await runtime.submitAnswer(pending!.questionId, "s1", { project: "demo", priority: "medium", confirmed: true })
    await expect(pendingResult).resolves.toMatchObject({ details: { status: "answered" } })
  })

  it("requires schema for non-obvious multi-field requests instead of making a fake A/B form", async () => {
    const { store, runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
    const result = await tool.execute("call", { title: "Details needed", context: "Need name, priority, and notes." }, undefined)
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]?.text).toContain("schema")
    await expect(store.getPending("s1")).resolves.toBeNull()
  })

  it("keeps simple A/B fallback for obvious binary choices", async () => {
    const { store, runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
    const pendingResult = tool.execute("call", { title: "Choose A or B", context: "Please pick either A or B.", timeoutMs: 60_000 }, undefined)
    let pending = await store.getPending("s1")
    await vi.waitFor(async () => {
      pending = await store.getPending("s1")
      expect(pending?.schema?.fields).toHaveLength(1)
    })
    await runtime.submitAnswer(pending!.questionId, "s1", { choice: "A" })
    await expect(pendingResult).resolves.toMatchObject({ details: { status: "answered" } })
  })

  it("returns thrown runtime failures as tool errors", async () => {
    const { runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: () => { throw new Error("session missing") } }))
    await expect(tool.execute("call", { title: "Need input", schema }, undefined)).resolves.toMatchObject({ isError: true })
  })

  it("valid input creates pending question and waits for runtime answer", async () => {
    const { store, runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
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
  it("exports routes and extensionFactories without @boring/agent ask-user APIs", async () => {
    const { store, runtime } = await fixture()
    const plugin = createAskUserServerPlugin({ store, runtime, sessionId: "s1" })
    expect(plugin.id).toBe("ask-user")
    expect(plugin.routes).toEqual(expect.any(Function))
    expect(plugin.extensionFactories).toHaveLength(1)
  })
})
