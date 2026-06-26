/**
 * Live-LLM regression: open a file, simulate the user closing the tab, ask
 * the agent to open the same file again. The agent MUST call exec_ui
 * openFile a second time — it must not skip the call with a stale-memory
 * "already opened" reply.
 *
 * This tests two things together:
 *   1. The exec_ui description tells the agent to always open on request,
 *      regardless of conversation history.
 *   2. get_ui_state's openTabs reflects the *current* tab list, so when
 *      the agent does check, it sees the tab is gone.
 *
 * Gated on ANTHROPIC_API_KEY: skipped silently in dev / CI without secrets.
 * Mirrors the canary suite pattern in @hachej/boring-agent/eval.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import type { FastifyInstance } from "fastify"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY
const describeIf = HAS_KEY ? describe : describe.skip

interface ToolCall {
  tool: string
  params: Record<string, unknown>
}

async function setUiState(
  app: FastifyInstance,
  state: Record<string, unknown>,
): Promise<void> {
  const res = await app.inject({
    method: "PUT",
    url: "/api/v1/ui/state",
    payload: { state },
  })
  if (res.statusCode !== 204) {
    throw new Error(`PUT /ui/state returned ${res.statusCode}: ${res.body}`)
  }
}

async function readChatState(app: FastifyInstance, sessionId: string): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/state`,
  })
  if (res.statusCode !== 200) {
    throw new Error(`GET /pi-chat/state returned ${res.statusCode}: ${res.body}`)
  }
  return JSON.parse(res.body) as Record<string, unknown>
}

function captureTurn(messages: unknown[], fromIndex: number): { calls: ToolCall[]; text: string } {
  const calls: ToolCall[] = []
  const textParts: string[] = []
  for (const message of messages.slice(fromIndex)) {
    const parts = Array.isArray((message as { parts?: unknown[] })?.parts) ? (message as { parts: unknown[] }).parts : []
    for (const part of parts) {
      const rec = part as Record<string, unknown>
      if (rec.type === "text" && typeof rec.text === "string") textParts.push(rec.text)
      if (rec.type === "tool-call" && typeof rec.toolName === "string") {
        calls.push({
          tool: rec.toolName,
          params: rec.input && typeof rec.input === "object" && !Array.isArray(rec.input)
            ? (rec.input as Record<string, unknown>)
            : {},
        })
      }
    }
  }
  return { calls, text: textParts.join("") }
}

async function sendTurn(
  app: FastifyInstance,
  sessionId: string,
  message: string,
): Promise<{ calls: ToolCall[]; text: string }> {
  const before = await readChatState(app, sessionId)
  const beforeCount = Array.isArray(before.messages) ? before.messages.length : 0

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/prompt`,
    payload: { message, clientNonce: `turn-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  })
  if (res.statusCode !== 202 && res.statusCode !== 200) {
    throw new Error(`POST /pi-chat/prompt returned ${res.statusCode}: ${res.body}`)
  }

  // The prompt route is async (202) — poll until the turn settles.
  const deadline = Date.now() + 120_000
  for (;;) {
    const snapshot = await readChatState(app, sessionId)
    if (snapshot.status !== "streaming") {
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : []
      return captureTurn(messages, beforeCount)
    }
    if (Date.now() > deadline) throw new Error("pi-chat turn did not settle within 120s")
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

describeIf("exec_ui openFile — re-open after close (live LLM)", () => {
  let app: FastifyInstance
  let workspaceRoot: string

  beforeAll(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ws-reopen-"))
    await mkdir(join(workspaceRoot, "src"), { recursive: true })
    await writeFile(
      join(workspaceRoot, "src", "README.md"),
      "# nested readme\n\nUsed by the re-open regression test.\n",
    )
    app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })
  }, 30_000)

  afterAll(async () => {
    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  test(
    "agent re-calls exec_ui openFile after the tab is closed",
    async () => {
      const sessionId = `reopen-${Date.now()}`

      // Turn 1: empty workspace, ask to open the file.
      await setUiState(app, { workbenchOpen: true, openTabs: [], activeTab: null })
      const turn1 = await sendTurn(app, sessionId, "open src/README.md")
      const turn1OpenFile = turn1.calls.find(
        (c) =>
          c.tool === "exec_ui" &&
          (c.params as { kind?: string }).kind === "openFile",
      )
      expect(turn1OpenFile, `turn 1 calls: ${JSON.stringify(turn1.calls)}`).toBeDefined()

      // Simulate the frontend opening the tab, then the user closing it.
      await setUiState(app, {
        workbenchOpen: true,
        openTabs: [
          { id: "src/README.md", title: "README.md", params: { path: "src/README.md" } },
        ],
        activeTab: "src/README.md",
      })
      await setUiState(app, { workbenchOpen: true, openTabs: [], activeTab: null })

      // Turn 2: same session (so the agent has the prior open in history),
      // but UI state now shows no tabs. Agent must re-open, not say
      // "already opened".
      const turn2 = await sendTurn(app, sessionId, "open src/README.md")
      const turn2OpenFile = turn2.calls.find(
        (c) =>
          c.tool === "exec_ui" &&
          (c.params as { kind?: string }).kind === "openFile",
      )
      expect(
        turn2OpenFile,
        `turn 2 SHOULD have called exec_ui openFile again. Got calls: ${JSON.stringify(
          turn2.calls,
        )}\nText: ${turn2.text.slice(0, 300)}`,
      ).toBeDefined()
      expect(
        (turn2OpenFile?.params as { params?: { path?: string } } | undefined)
          ?.params?.path,
      ).toBe("src/README.md")
    },
    180_000,
  )

  test(
    "agent re-calls openFile even when get_ui_state shows the file already open",
    async () => {
      // The previous test exercises the "user closed it" case (state shows
      // empty tabs). This one exercises the "state drift" case: get_ui_state
      // says the file IS already open, but the user typed "open readme"
      // again — they want it focused, not a "Already done" reply. The agent
      // must call exec_ui regardless of what state says.
      const sessionId = `reopen-stateopen-${Date.now()}`

      // Pre-set state: README.md is already in openTabs and active.
      await setUiState(app, {
        workbenchOpen: true,
        openTabs: [
          { id: "src/README.md", title: "README.md", params: { path: "src/README.md" } },
        ],
        activeTab: "src/README.md",
      })

      const turn = await sendTurn(app, sessionId, "open src/README.md")
      const openFile = turn.calls.find(
        (c) =>
          c.tool === "exec_ui" &&
          (c.params as { kind?: string }).kind === "openFile",
      )
      expect(
        openFile,
        `agent must call openFile even when state says file is open. Got calls: ${JSON.stringify(
          turn.calls,
        )}\nText: ${turn.text.slice(0, 300)}`,
      ).toBeDefined()
      expect(
        (openFile?.params as { params?: { path?: string } } | undefined)
          ?.params?.path,
      ).toBe("src/README.md")
    },
    180_000,
  )
})

if (!HAS_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[reopen test] skipped: ANTHROPIC_API_KEY not set. Set it to run live LLM regression check.",
  )
}
