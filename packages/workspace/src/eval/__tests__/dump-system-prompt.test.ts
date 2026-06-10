/**
 * Diagnostic — dumps the assembled system prompt to stdout so we can verify
 * the bundled `boring-plugin-authoring` skill is being advertised under
 * `<available_skills>`. Skipped unless BORING_EVAL_DUMP_PROMPT=1.
 *
 *   BORING_EVAL_DUMP_PROMPT=1 pnpm --filter @hachej/boring-workspace test \
 *     src/eval/__tests__/dump-system-prompt.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { FastifyInstance } from "fastify"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"

const ENABLED = process.env.BORING_EVAL_DUMP_PROMPT === "1"
const describeIf = ENABLED ? describe : describe.skip
const WORKSPACE_PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../")

describeIf("system-prompt diagnostic", () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createWorkspaceAgentServer({
      workspaceRoot: WORKSPACE_PKG_ROOT,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
    })
  }, 30_000)
  afterAll(async () => {
    if (app) await app.close()
  })

  test("dumps the assembled system prompt for a dummy session", async () => {
    const sessionId = "diag-system-prompt"

    // Send a tiny message to materialise the pi session — getSystemPrompt
    // returns undefined until the harness has created it. The prompt route is
    // async (202); poll state until the turn settles.
    const prompted = await app.inject({
      method: "POST",
      url: `/api/v1/agent/pi-chat/${sessionId}/prompt`,
      payload: {
        message: "hello",
        clientNonce: "diag-system-prompt-1",
        model: { provider: "openrouter", id: "qwen/qwen3-coder-plus" },
      },
    })
    expect([200, 202]).toContain(prompted.statusCode)
    const deadline = Date.now() + 60_000
    for (;;) {
      const state = await app.inject({ method: "GET", url: `/api/v1/agent/pi-chat/${sessionId}/state` })
      if (state.statusCode === 200 && JSON.parse(state.body).status !== "streaming") break
      if (Date.now() > deadline) throw new Error("turn did not settle within 60s")
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agent/sessions/${sessionId}/system-prompt`,
    })
    expect(res.statusCode).toBe(200)
    const { systemPrompt } = res.json() as { systemPrompt: string }
    // eslint-disable-next-line no-console
    console.log("=== assembled system prompt ===")
    // eslint-disable-next-line no-console
    console.log(systemPrompt)
    // eslint-disable-next-line no-console
    console.log("=== /system prompt ===")
    // eslint-disable-next-line no-console
    console.log(`length: ${systemPrompt.length} chars`)
    // eslint-disable-next-line no-console
    console.log(`mentions boring-plugin-authoring: ${systemPrompt.includes("boring-plugin-authoring")}`)
    // eslint-disable-next-line no-console
    console.log(`mentions <available_skills>: ${systemPrompt.includes("<available_skills>") || systemPrompt.includes("available_skills")}`)
  }, 120_000)
})
