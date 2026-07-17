import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ASK_USER_BRIDGE_CAPABILITIES, ASK_USER_BRIDGE_OPS } from "../../shared/bridge"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import { FileAskUserStore } from "../askUserStore"
import { AskUserRuntime } from "../askUserRuntime"
import { AskUserStatePublisher } from "../askUserStatePublisher"
import { createAskUserTool } from "../createAskUserTool"
import { createAskUserBridgeHandlers } from "../askUserBridgeHandlers"
import { createWorkspaceBridgeRegistry, type UiBridge, type UiCommand, type UiState, type WorkspaceBridgeCallContext } from "@hachej/boring-workspace/server"

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
  it("runs tool -> pending state -> ask-user bridge answer -> tool result", async () => {
    const store = await makeStore()
    const bridge = createBridge()
    const runtime = new AskUserRuntime({ store, ownerPrincipalId: "p1" })
    new AskUserStatePublisher(store, bridge).start()

    const registry = createWorkspaceBridgeRegistry()
    for (const entry of createAskUserBridgeHandlers({ store, runtime })) {
      registry.registerHandler(entry.definition, entry.handler)
    }
    const browserContext: WorkspaceBridgeCallContext = {
      callerClass: "browser",
      workspaceId: "workspace-1",
      sessionId: "s1",
      capabilities: [ASK_USER_BRIDGE_CAPABILITIES.answer],
      actor: { actorKind: "human", performedBy: { id: "p1", label: "user:p1" } },
    }

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

    // A question is published to the Inbox/session attention state. The user
    // explicitly opens the legacy Questions pane only when they choose to.
    expect(bridge.commands).toEqual([])
    await vi.waitFor(async () => {
      const slot = (await bridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]
      expect(slot).toMatchObject({ hint: { questionId: pending.questionId, sessionId: "s1", status: "ready" } })
      expect(JSON.stringify(slot)).not.toContain("answerToken")
    })


    const submit = await registry.call({
      op: ASK_USER_BRIDGE_OPS.answer,
      input: {
        questionId: pending.questionId,
        sessionId: "s1",
        answerToken: pending.answerToken,
        values: { region: "iad", confirm: true },
      },
    }, browserContext)
    expect(submit).toMatchObject({ ok: true, output: { status: "answered" } })
    await expect(toolResult).resolves.toMatchObject({
      details: { status: "answered", answer: { values: { region: "iad", confirm: true } } },
    })
    await vi.waitFor(async () => expect((await bridge.getState())?.[ASK_USER_UI_STATE_SLOTS.PENDING]).toMatchObject({ hint: null }))
    await expect(store.getTranscriptEventsForQuestion(pending.questionId)).resolves.toEqual([
      expect.objectContaining({ type: "created" }),
      expect.objectContaining({ type: "ready" }),
      expect.objectContaining({ type: "answered" }),
    ])
  })
})
