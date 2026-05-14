import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import { FileAskUserStore } from "../AskUserStore"
import { AskUserRuntime } from "../AskUserRuntime"
import { AskUserStatePublisher } from "../AskUserStatePublisher"
import { questionsRoutes } from "../questionsRoutes"
import Fastify from "fastify"
import type { UiBridge, UiCommand, UiState } from "../../../../shared/ui-bridge"

function bridge(): UiBridge & { commands: UiCommand[] } {
  let state: UiState | null = null
  const commands: UiCommand[] = []
  return {
    commands,
    async getState() { return state },
    async setState(next) { state = next },
    async postCommand(cmd) { commands.push(cmd); return { seq: commands.length, status: "ok" } },
    subscribeCommands() { return () => undefined },
  }
}

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "ask-user-state-"))
  return new FileAskUserStore(join(dir, "questions.json"))
}

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer" }] }

describe("AskUserStatePublisher", () => {
  it("publishes pending slot on create, answer, cancel, and abandon", async () => {
    const store = await makeStore()
    const ui = bridge()
    const publisher = new AskUserStatePublisher(store, ui)
    publisher.start()
    const runtime = new AskUserRuntime({ store })
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await vi.waitFor(async () => {
      const slot = (await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]
      expect(slot).toMatchObject({ question: { status: "ready" } })
      return (slot as { question: { questionId: string } }).question
    })
    await runtime.submitAnswer(question.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null }))

    const cancelPending = runtime.ask({ sessionId: "s1", schema })
    const q2 = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    })
    await runtime.cancelQuestion(q2.questionId, "s1")
    await expect(cancelPending).resolves.toMatchObject({ status: "cancelled" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null }))

    const abandonedController = new AbortController()
    const abandonedPending = runtime.ask({ sessionId: "s1", schema }, abandonedController.signal)
    const q3 = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    })
    await store.markAbandoned(q3.questionId)
    abandonedController.abort()
    await expect(abandonedPending).resolves.toMatchObject({ status: "cancelled" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null }))
  })
})

describe("ask-user UI open", () => {
  it("keeps pending question alive when openSurface is not acknowledged", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store, uiBridge: ui })
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    let question = await store.getPending("s1")
    await vi.waitFor(async () => {
      question = await store.getPending("s1")
      expect(question).not.toBeNull()
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(store.getPending("s1")).resolves.not.toBeNull()
    await runtime.submitAnswer(question!.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
  })

  it("returns abort without waiting for openSurface acknowledgement", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store, uiBridge: ui })
    const controller = new AbortController()
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema }, controller.signal)
    await vi.waitFor(async () => expect(await store.getPending("s1")).not.toBeNull())
    controller.abort()
    await expect(pending).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })

  it("keeps pending question alive when openSurface dispatch fails", async () => {
    const store = await makeStore()
    const ui = bridge()
    ui.postCommand = async () => { throw new Error("disconnected") }
    const runtime = new AskUserRuntime({ store, uiBridge: ui })
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    let question = await store.getPending("s1")
    await vi.waitFor(async () => {
      question = await store.getPending("s1")
      expect(question).not.toBeNull()
    })
    await runtime.submitAnswer(question!.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
  })
})
