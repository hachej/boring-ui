import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import {
  createHumanInputBridgeHandlers,
  createWorkspaceBridgeRegistry,
  HUMAN_INPUT_OPS,
  InMemoryPendingQuestionStore,
  PendingQuestionRuntime,
  type WorkspaceBridgeCallContext,
} from "@hachej/boring-workspace/server"
import { createAskUserPiExtensionFactory } from "../../agent"
import { askUserPlugin } from "../index"

const schema = {
  wireVersion: 1 as const,
  fields: [{ type: "text" as const, name: "answer", label: "Answer", required: true }],
}

function runtimeContext(emitUiEffect: WorkspaceBridgeCallContext["emitUiEffect"]): WorkspaceBridgeCallContext {
  return {
    callerClass: "runtime",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    tokenId: "runtime-token-redacted",
    capabilities: ["human-input:request"],
    actor: { actorKind: "agent", performedBy: { id: "agent-1", label: "agent" }, onBehalfOf: { id: "human-1", label: "human" } },
    emitUiEffect,
  }
}

function browserContext(extraCaps: string[] = []): WorkspaceBridgeCallContext {
  return {
    callerClass: "browser",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    capabilities: extraCaps,
    actor: { actorKind: "human", performedBy: { id: "human-1", label: "human" } },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("ask-user front + Pi extension + human-input bridge e2e", () => {
  it("opens Questions, answers through WorkspaceBridge, and resolves ask_user without old routes", async () => {
    const redactedLogs: string[] = []
    const oldRouteHits: string[] = []
    const store = new InMemoryPendingQuestionStore()
    const pendingRuntime = new PendingQuestionRuntime(store)
    const registry = createWorkspaceBridgeRegistry()
    for (const entry of createHumanInputBridgeHandlers({ runtime: pendingRuntime, store })) registry.registerHandler(entry.definition, entry.handler)

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/questions/commands")) {
        oldRouteHits.push(String(url))
        return Response.json({ ok: false }, { status: 500 })
      }
      const body = JSON.parse(String(init?.body ?? "{}"))
      redactedLogs.push(`bridge browser ${body.op} payload=[REDACTED]`)
      const response = await registry.call(body, browserContext(["human-input:pending", "human-input:answer", "human-input:cancel"]))
      return Response.json(response, { status: response.ok ? 200 : 400 })
    }))

    const tools: Array<{ name: string; execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> }> = []
    createAskUserPiExtensionFactory({
      sessionId: "session-1",
      logger: { debug: (message, meta) => redactedLogs.push(`${message} ${JSON.stringify(meta)}`), warn: vi.fn(), error: vi.fn() },
      callHumanInputRequest: async (input, signal) => {
        redactedLogs.push(`bridge runtime ${HUMAN_INPUT_OPS.request} payload=[REDACTED]`)
        const emitUiEffect: WorkspaceBridgeCallContext["emitUiEffect"] = async (effect) => {
          redactedLogs.push(`ui effect ${JSON.stringify({ kind: effect.kind, surface: (effect as any).params?.kind })}`)
          return { seq: 1, status: "ok" }
        }
        return await registry.call({ op: HUMAN_INPUT_OPS.request, requestId: input.requestId, input }, { ...runtimeContext(emitUiEffect), signal })
      },
    })({ registerTool: (tool) => { redactedLogs.push(`extension registration ${tool.name}`); tools.push(tool) } })

    const tool = tools.find((candidate) => candidate.name === "ask_user")!
    expect(tool).toBeTruthy()
    redactedLogs.push("tool call ask_user")
    const resultPromise = tool.execute("tool-call-1", { title: "Need input", context: "Do not log the answer", schema })
    await waitFor(async () => expect(await store.getPending("session-1")).toBeTruthy())
    redactedLogs.push("pending question observed")

    const captured = captureFrontPlugin(askUserPlugin)
    const Provider = captured.registrations.providers[0]!.component as any
    const Panel = captured.registrations.panels[0]!.component as any
    render(<Provider apiBaseUrl="" activeSessionId="session-1"><Panel params={{}} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    expect(await screen.findByText("Questions")).toBeInTheDocument()
    expect(await screen.findByText("Need input")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: /answer/i }), { target: { value: "secret answer" } })
    redactedLogs.push("browser answer [REDACTED]")
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }))

    await expect(resultPromise).resolves.toMatchObject({ details: { status: "answered", answer: { values: { answer: "secret answer" } } } })
    redactedLogs.push("waiter resolution answered")

    expect(oldRouteHits).toEqual([])
    expect(JSON.stringify(redactedLogs)).toContain("extension registration ask_user")
    expect(JSON.stringify(redactedLogs)).toContain("tool call ask_user")
    expect(JSON.stringify(redactedLogs)).toContain("human-input.v1.request")
    expect(JSON.stringify(redactedLogs)).toContain("ui effect")
    expect(JSON.stringify(redactedLogs)).toContain("pending question observed")
    expect(JSON.stringify(redactedLogs)).toContain("browser answer [REDACTED]")
    expect(JSON.stringify(redactedLogs)).toContain("waiter resolution answered")
    expect(JSON.stringify(redactedLogs)).not.toContain("secret answer")
    expect(JSON.stringify(redactedLogs)).not.toContain("runtime-token-redacted")
  })
})
