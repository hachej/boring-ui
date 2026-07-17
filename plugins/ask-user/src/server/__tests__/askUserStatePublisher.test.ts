// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import type { AskUserStore } from "../askUserStore"
import { AskUserRuntime } from "../askUserRuntime"
import { AskUserStatePublisher } from "../askUserStatePublisher"
import { MemoryAskUserStore } from "./testAskUserStore"
import type { UiBridge, UiCommand, UiState } from "@hachej/boring-workspace/server"

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
  return new MemoryAskUserStore()
}

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer" }] }

async function waitForPending(store: AskUserStore, sessionId: string) {
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    const pending = await store.getPending(sessionId)
    if (pending) return pending
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for pending question for ${sessionId}`)
}

async function waitForRuntimeWaiter(runtime: AskUserRuntime, questionId: string) {
  await vi.waitFor(() => {
    expect(runtime.coordinator.hasWaiter(questionId)).toBe(true)
  }, { timeout: 30_000 })
}

describe("AskUserStatePublisher", () => {
  it("clears preserved legacy full-question UI state when the store has no pending question", async () => {
    const store = await makeStore()
    const ui = bridge()
    await ui.setState({
      [ASK_USER_UI_STATE_SLOTS.PENDING]: {
        question: {
          questionId: "q1",
          sessionId: "s1",
          status: "ready",
          answerToken: "secret-token",
          schema,
          title: "Legacy",
        },
      },
    })

    const publisher = new AskUserStatePublisher(store, ui)
    publisher.start()

    await vi.waitFor(async () => {
      const slot = (await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]
      expect(slot).toEqual({ hint: null, hintsBySession: {} })
      expect(JSON.stringify(slot)).not.toContain("secret-token")
    })
  })

  it("does not carry forward stale hints from existing UI state", async () => {
    const store = await makeStore()
    const ui = bridge()
    await ui.setState({
      [ASK_USER_UI_STATE_SLOTS.PENDING]: {
        hint: { questionId: "stale-q", sessionId: "stale-session", status: "ready" },
        hintsBySession: { "stale-session": { questionId: "stale-q", sessionId: "stale-session", status: "ready" } },
      },
    })
    const publisher = new AskUserStatePublisher(store, ui)
    publisher.start()
    const runtime = new AskUserRuntime({ store })
    const pending = runtime.ask({ sessionId: "s1", title: "S1", schema })
    const q1 = await waitForPending(store, "s1")
    await vi.waitFor(async () => {
      const slot = (await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]
      expect(slot).toEqual({
        hint: { questionId: q1.questionId, sessionId: "s1", status: "ready" },
        hintsBySession: { s1: { questionId: q1.questionId, sessionId: "s1", status: "ready" } },
      })
    })
    await waitForRuntimeWaiter(runtime, q1.questionId)
    await runtime.cancelQuestion(q1.questionId, "s1")
    await expect(pending).resolves.toMatchObject({ status: "cancelled" })
  }, 30_000)

  it("seeds pending hints from store on start and keeps untouched sessions after another session resolves", async () => {
    const store = await makeStore()
    const ui = bridge()
    const runtime = new AskUserRuntime({ store })
    const s1 = runtime.ask({ sessionId: "s1", title: "S1", schema })
    const s2 = runtime.ask({ sessionId: "s2", title: "S2", schema })
    const q1 = await waitForPending(store, "s1")
    const q2 = await waitForPending(store, "s2")

    const publisher = new AskUserStatePublisher(store, ui)
    publisher.start()

    await vi.waitFor(async () => {
      expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({
        hintsBySession: {
          s1: { questionId: q1.questionId, sessionId: "s1", status: "ready" },
          s2: { questionId: q2.questionId, sessionId: "s2", status: "ready" },
        },
      })
    })
    await waitForRuntimeWaiter(runtime, q1.questionId)
    await waitForRuntimeWaiter(runtime, q2.questionId)
    await runtime.submitAnswer(q2.questionId, "s2", { answer: "ok" })
    await expect(s2).resolves.toMatchObject({ status: "answered" })
    await vi.waitFor(async () => {
      expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({
        hint: { questionId: q1.questionId, sessionId: "s1", status: "ready" },
        hintsBySession: { s1: { questionId: q1.questionId, sessionId: "s1", status: "ready" } },
      })
    })
    await runtime.cancelQuestion(q1.questionId, "s1")
    await expect(s1).resolves.toMatchObject({ status: "cancelled" })
  }, 30_000)

  it("publishes independent hints for multiple pending sessions", async () => {
    const store = await makeStore()
    const ui = bridge()
    const publisher = new AskUserStatePublisher(store, ui)
    publisher.start()
    const runtime = new AskUserRuntime({ store })
    const s1 = runtime.ask({ sessionId: "s1", title: "S1", schema })
    const s2 = runtime.ask({ sessionId: "s2", title: "S2", schema })
    const q1 = await waitForPending(store, "s1")
    const q2 = await waitForPending(store, "s2")
    await vi.waitFor(async () => {
      const slot = (await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]
      expect(slot).toMatchObject({
        hintsBySession: {
          s1: { questionId: q1.questionId, sessionId: "s1", status: "ready" },
          s2: { questionId: q2.questionId, sessionId: "s2", status: "ready" },
        },
      })
      expect(JSON.stringify(slot)).not.toContain("answerToken")
    })
    await waitForRuntimeWaiter(runtime, q1.questionId)
    await waitForRuntimeWaiter(runtime, q2.questionId)
    await runtime.submitAnswer(q1.questionId, "s1", { answer: "ok" })
    await expect(s1).resolves.toMatchObject({ status: "answered" })
    await vi.waitFor(async () => {
      const slot = (await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]
      expect(slot).toEqual({
        hint: { questionId: q2.questionId, sessionId: "s2", status: "ready" },
        hintsBySession: { s2: { questionId: q2.questionId, sessionId: "s2", status: "ready" } },
      })
    })
    await runtime.cancelQuestion(q2.questionId, "s2")
    await expect(s2).resolves.toMatchObject({ status: "cancelled" })
  }, 30_000)

  it("publishes pending slot on create, answer, cancel, and abandon", async () => {
    const store = await makeStore()
    const ui = bridge()
    const publisher = new AskUserStatePublisher(store, ui)
    publisher.start()
    const runtime = new AskUserRuntime({ store })
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await vi.waitFor(async () => {
      const slot = (await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]
      expect(slot).toMatchObject({ hint: { status: "ready" } })
      expect(JSON.stringify(slot)).not.toContain("answerToken")
      return (slot as { hint: { questionId: string } }).hint
    })
    await waitForRuntimeWaiter(runtime, question.questionId)
    await runtime.submitAnswer(question.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ hint: null, hintsBySession: {} }))

    const cancelPending = runtime.ask({ sessionId: "s1", schema })
    const q2 = await waitForPending(store, "s1")
    await waitForRuntimeWaiter(runtime, q2.questionId)
    await runtime.cancelQuestion(q2.questionId, "s1")
    await expect(cancelPending).resolves.toMatchObject({ status: "cancelled" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ hint: null, hintsBySession: {} }))

    const abandonedController = new AbortController()
    const abandonedPending = runtime.ask({ sessionId: "s1", schema }, abandonedController.signal)
    const q3 = await waitForPending(store, "s1")
    await store.markAbandoned(q3.questionId)
    abandonedController.abort()
    await expect(abandonedPending).resolves.toMatchObject({ status: "cancelled" })
    await vi.waitFor(async () => expect((await ui.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toEqual({ hint: null, hintsBySession: {} }))
  }, 30_000)
})

describe("ask-user pending lifecycle", () => {
  it("keeps a pending question alive until it is answered", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await waitForPending(store, "s1")
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(store.getPending("s1")).resolves.not.toBeNull()
    await waitForRuntimeWaiter(runtime, question!.questionId)
    await runtime.submitAnswer(question!.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
  }, 30_000)

  it("returns abort while the question is pending", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const controller = new AbortController()
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema }, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(pending).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
  })

  it("keeps a pending question alive before the runtime waiter is registered", async () => {
    const store = await makeStore()
    const runtime = new AskUserRuntime({ store })
    const pending = runtime.ask({ sessionId: "s1", title: "T", schema })
    const question = await waitForPending(store, "s1")
    await waitForRuntimeWaiter(runtime, question!.questionId)
    await runtime.submitAnswer(question!.questionId, "s1", { answer: "ok" })
    await expect(pending).resolves.toMatchObject({ status: "answered" })
  }, 30_000)
})
