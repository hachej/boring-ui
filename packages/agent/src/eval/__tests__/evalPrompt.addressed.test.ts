import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { evalAgentPrompt } from "../evalPrompt"

const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("evalAgentPrompt addressed state", () => {
  it("scopes Agent routes by header, polls the addressed envelope, and captures its inner state", async () => {
    const app = Fastify({ logger: false })
    apps.push(app)
    let statePolls = 0

    app.addHook("onRequest", async (request) => {
      expect(request.headers["x-boring-workspace-id"]).toBe("workspace-alpha")
      expect(request.url).not.toContain("workspaceId=")
    })
    app.post("/api/v1/agents/alpha/sessions", async (_request, reply) => {
      return reply.code(201).send({ sessionId: "eval-session" })
    })
    app.post("/api/v1/agents/alpha/sessions/eval-session/prompt", async (_request, reply) => {
      return reply.code(202).send({ accepted: true, cursor: 1, clientNonce: "nonce" })
    })
    app.get("/api/v1/agents/alpha/sessions/eval-session/state", async () => {
      statePolls += 1
      const status = statePolls === 1 ? "streaming" : "idle"
      return {
        ref: { agentTypeId: "alpha", sessionId: "eval-session" },
        seq: statePolls,
        summary: { ref: { agentTypeId: "alpha", sessionId: "eval-session" }, status },
        state: {
          protocolVersion: 1,
          sessionId: "eval-session",
          seq: statePolls,
          status,
          messages: status === "idle" ? [{
            id: "assistant-1",
            role: "assistant",
            parts: [
              { type: "tool-call", toolName: "bash", input: { command: "pwd" } },
              { type: "text", text: "done" },
            ],
          }] : [],
        },
      }
    })
    app.delete("/api/v1/agents/alpha/sessions/eval-session", async () => ({ deleted: true }))

    const result = await evalAgentPrompt({
      app,
      agentTypeId: "alpha",
      headers: { "x-boring-workspace-id": "workspace-alpha" },
      prompt: "run pwd",
      expect: { tool: "bash", params: { command: "pwd" } },
      timeoutMs: 2_000,
    })

    expect(statePolls).toBe(2)
    expect(result).toMatchObject({ ok: true, text: "done", actual: [{ tool: "bash", params: { command: "pwd" } }] })
  })
})
