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

function parseToolCalls(body: string): { calls: ToolCall[]; text: string } {
  const calls: ToolCall[] = []
  const textParts: string[] = []
  for (const line of body.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) continue
    const payload = trimmed.slice("data:".length).trim()
    if (!payload || payload === "[DONE]") continue
    let chunk: Record<string, unknown>
    try {
      chunk = JSON.parse(payload)
    } catch {
      continue
    }
    if (chunk.type === "tool-input-available") {
      const toolName = chunk.toolName
      const input = chunk.input
      if (typeof toolName !== "string") continue
      calls.push({
        tool: toolName,
        params:
          input && typeof input === "object" && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {},
      })
    } else if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
      textParts.push(chunk.delta)
    }
  }
  return { calls, text: textParts.join("") }
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

async function sendTurn(
  app: FastifyInstance,
  sessionId: string,
  message: string,
): Promise<{ calls: ToolCall[]; text: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/agent/chat",
    payload: { sessionId, message },
  })
  if (res.statusCode !== 200) {
    throw new Error(`POST /chat returned ${res.statusCode}: ${res.body}`)
  }
  return parseToolCalls(res.body)
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
      await app.inject({
        method: "POST",
        url: "/api/v1/agent/sessions",
        payload: { id: sessionId },
      })

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
      await app.inject({
        method: "POST",
        url: "/api/v1/agent/sessions",
        payload: { id: sessionId },
      })

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
