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
  it("publishes pending slot on create, patch, finalize, answer, cancel, and abandon", async () => {
    const store = await makeStore()
    const ui = bridge()
    const publisher = new AskUserStatePublisher(store, ui)
    publisher.start()
    const runtime = new AskUserRuntime({ store })
    const { question } = await runtime.beginAskUserStream({ sessionId: "s1", title: "T" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({ question: { status: "draft" } }))
    await store.applyPatch(question.questionId, { patchId: "p1", type: "add_field", field: schema.fields[0] }, 0)
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({ question: { draftVersion: 1 } }))
    await store.finalize(question.questionId, undefined, 1)
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({ question: { status: "ready" } }))
    await runtime.submitAnswer(question.questionId, "s1", { answer: "ok" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null }))

    const { question: q2 } = await runtime.beginAskUserStream({ sessionId: "s1" })
    await runtime.cancelQuestion(q2.questionId, "s1")
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null }))

    const { question: q3 } = await runtime.beginAskUserStream({ sessionId: "s1" })
    await store.markAbandoned(q3.questionId)
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ question: null }))
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

  it("questions.opened route acknowledges rehydrated question", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const { question } = await runtime.beginAskUserStream({ sessionId: "s1" })
    const opened = vi.fn()
    const app = Fastify()
    app.register(questionsRoutes, { store, runtime, recordOpened: opened, getAuthContext: () => ({ sessionId: "s1", principalId: "anonymous" }) })
    const res = await app.inject({ method: "POST", url: "/api/v1/questions/commands", payload: { kind: "questions.opened", params: { questionId: question.questionId, sessionId: "s1" } } })
    expect(res.statusCode).toBe(200)
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ questionId: question.questionId }))
    await app.close()
  })

  it("cancels with ui_unavailable when opened ack times out", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store, uiBridge: ui, askUserOpenAckTimeoutMs: 1 })
    await expect(runtime.ask({ sessionId: "s1", title: "T", schema })).resolves.toMatchObject({ status: "cancelled", reason: "ui_unavailable" })
    await expect(store.getPending("s1")).resolves.toBeNull()
  })

  it("cancels with ui_unavailable when openSurface dispatch fails", async () => {
    const store = await makeStore()
    const ui = bridge()
    ui.postCommand = async () => { throw new Error("disconnected") }
    const runtime = new AskUserRuntime({ store, uiBridge: ui })
    await expect(runtime.ask({ sessionId: "s1", title: "T", schema })).resolves.toMatchObject({ status: "cancelled", reason: "ui_unavailable" })
    await expect(store.getPending("s1")).resolves.toBeNull()
  })
})
