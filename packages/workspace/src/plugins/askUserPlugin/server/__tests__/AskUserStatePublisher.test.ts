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
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null, bySession: { s1: null } }))

    const cancelPending = runtime.ask({ sessionId: "s1", schema })
    const q2 = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    })
    await runtime.cancelQuestion(q2.questionId, "s1")
    await expect(cancelPending).resolves.toMatchObject({ status: "cancelled" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null, bySession: { s1: null } }))

    void runtime.ask({ sessionId: "s1", schema })
    const q3 = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    })
    await store.markAbandoned(q3.questionId)
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null, bySession: { s1: null } }))
  })
})

describe("ask-user UI open ack", () => {
  it("dispatches openSurface and accepts answers immediately after questions.opened ack", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store, uiBridge: ui, askUserOpenAckTimeoutMs: 1000 })
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    await vi.waitFor(() => expect(ui.commands).toEqual([expect.objectContaining({ kind: "openSurface" })]))
    const question = await store.getPending("s1")
    runtime.markOpened(question!.questionId)
    await runtime.submitAnswer(question!.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
  })

  it("does not miss questions.opened ack while openSurface dispatch is still resolving", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store, uiBridge: ui, askUserOpenAckTimeoutMs: 1000 })
    ui.postCommand = async (cmd) => {
      ui.commands.push(cmd)
      const question = await store.getPending("s1")
      runtime.markOpened(question!.questionId)
      return { seq: ui.commands.length, status: "ok" }
    }
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    await vi.waitFor(() => expect(ui.commands).toHaveLength(1))
    const question = await store.getPending("s1")
    await runtime.submitAnswer(question!.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
  })

  it("questions.opened route acknowledges rehydrated question", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    void runtime.ask({ sessionId: "s1", schema })
    const question = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    })
    const opened = vi.fn()
    const app = Fastify()
    app.register(questionsRoutes, { store, runtime, recordOpened: opened, getAuthContext: () => ({ sessionId: "s1", principalId: "anonymous" }) })
    const res = await app.inject({ method: "POST", url: "/api/v1/questions/commands", payload: { kind: "questions.opened", params: { questionId: question.questionId, sessionId: "s1" } } })
    expect(res.statusCode).toBe(200)
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ questionId: question.questionId }))
    await app.close()
  })

  it("keeps pending question alive when opened ack times out", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store, uiBridge: ui, askUserOpenAckTimeoutMs: 1 })
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

  it("returns abort without waiting for opened ack timeout", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store, uiBridge: ui, askUserOpenAckTimeoutMs: 60_000 })
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
