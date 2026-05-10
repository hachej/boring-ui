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

  it("returns thrown runtime failures as tool errors", async () => {
    const { runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: () => { throw new Error("session missing") } }))
    await expect(tool.execute("call", { title: "Need input", schema }, undefined)).resolves.toMatchObject({ isError: true })
  })

  it("valid input creates pending question and waits for runtime answer", async () => {
    const { store, runtime } = await fixture()
    const tool = register(createAskUserPiExtensionFactory({ runtime, sessionId: "s1" }))
    const pendingResult = tool.execute("call", { title: "Need input", schema }, undefined)
    let pending = await store.getPending("s1")
    for (let i = 0; !pending && i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      pending = await store.getPending("s1")
    }
    expect(pending).toMatchObject({ status: "ready", title: "Need input" })
    for (let i = 0; !runtime.coordinator.hasWaiter(pending!.questionId) && i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await runtime.submitAnswer(pending!.questionId, "s1", { answer: "ok" })
    await expect(pendingResult).resolves.toMatchObject({ details: { status: "answered" } })
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
