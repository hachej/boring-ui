import Fastify from "fastify"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ASK_USER_COMMAND_KINDS, ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import { FileAskUserStore } from "../AskUserStore"
import { AskUserRuntime } from "../AskUserRuntime"
import { AskUserStatePublisher } from "../AskUserStatePublisher"
import { createAskUserTool } from "../createAskUserTool"
import { questionsRoutes } from "../questionsRoutes"
import type { UiBridge, UiCommand, UiState } from "@hachej/boring-workspace/server"

function createBridge(): UiBridge & { commands: UiCommand[] } {
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
  const dir = await mkdtemp(join(tmpdir(), "ask-user-workflow-"))
  return new FileAskUserStore(join(dir, "questions.json"))
}

describe("ask-user full workflow", () => {
  it("runs tool -> pending state -> submit route -> tool result", async () => {
    const store = await makeStore()
    const bridge = createBridge()
    const runtime = new AskUserRuntime({ store, uiBridge: bridge, ownerPrincipalId: "p1" })
    new AskUserStatePublisher(store, bridge).start()

    const app = Fastify()
    app.register(questionsRoutes, {
      store,
      runtime,
      getAuthContext: () => ({ sessionId: "s1", principalId: "p1" }),
    })

    const tool = createAskUserTool({ runtime, sessionId: "s1" })
    const toolResult = tool.execute("call-1", {
      title: "Pick a deployment region",
      context: "We need a region before continuing.",
      schema: {
        wireVersion: 1,
        fields: [
          { type: "select", name: "region", label: "Region", required: true, options: [{ value: "iad", label: "IAD" }, { value: "sfo", label: "SFO" }] },
          { type: "checkbox", name: "confirm", label: "Confirm selection" },
        ],
      },
    })

    await vi.waitFor(async () => {
      expect(await store.getPending("s1")).toMatchObject({ status: "ready", title: "Pick a deployment region" })
    })
    const pending = (await store.getPending("s1"))!

    await vi.waitFor(() => {
      expect(bridge.commands).toEqual([
        { kind: "openSurface", params: { kind: "questions", target: pending.questionId, meta: { question: expect.objectContaining({ questionId: pending.questionId, status: "ready" }) } } },
      ])
    })
    await vi.waitFor(async () => {
      expect((await bridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({ question: { questionId: pending.questionId, status: "ready" } })
    })


    const submit = await app.inject({
      method: "POST",
      url: "/api/v1/questions/commands",
      payload: {
        kind: ASK_USER_COMMAND_KINDS.SUBMIT,
        params: {
          questionId: pending.questionId,
          sessionId: "s1",
          answerToken: pending.answerToken,
          values: { region: "iad", confirm: true },
        },
      },
    })
    expect(submit.statusCode).toBe(200)
    await expect(toolResult).resolves.toMatchObject({
      details: { status: "answered", answer: { values: { region: "iad", confirm: true } } },
    })
    await vi.waitFor(async () => expect((await bridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({ question: null }))
    await expect(store.getTranscriptEventsForQuestion(pending.questionId)).resolves.toEqual([
      expect.objectContaining({ type: "created" }),
      expect.objectContaining({ type: "ready" }),
      expect.objectContaining({ type: "answered" }),
    ])
    await app.close()
  })
})
