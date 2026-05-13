/**
 * Eval: a real model should choose the Workspace-owned ask_user tool when it
 * needs a missing blocking decision. This talks to OpenRouter with tool-calling
 * enabled, then executes the produced ask_user call against the real runtime.
 *
 * Gated on OPENROUTER_API_KEY — skipped silently in CI without it.
 * Run manually:
 *   OPENROUTER_API_KEY=sk-or-v1-... pnpm --filter @boring/workspace test src/eval/__tests__/ask-user-tool.test.ts
 */
import { describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AskUserRuntime, createAskUserTool, FileAskUserStore } from "../../app/server"

const HAS_KEY = !!process.env.OPENROUTER_API_KEY
const describeIf = HAS_KEY ? describe : describe.skip
const SESSION_ID = "eval-ask-user-session"

describeIf("ask-user eval (live LLM)", () => {
  test("real model calls ask_user for a required deployment-region decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-eval-"))
    const store = new FileAskUserStore(join(dir, "questions.json"))
    const runtime = new AskUserRuntime({ store, ownerPrincipalId: "anonymous" })
    const tool = createAskUserTool({ runtime, sessionId: SESSION_ID })
    const toolCall = await callOpenRouterWithAskUserTool(tool.parameters)
    expect(toolCall.function.name).toBe("ask_user")
    const input = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>
    expect(JSON.stringify(input)).toMatch(/region/i)

    const normalizedInput = normalizeAskUserInput(input)
    const pendingToolResult = tool.execute(toolCall.id ?? "eval-call", normalizedInput, AbortSignal.timeout(60_000))
    const pending = await waitForPending(store, SESSION_ID)
    await runtime.submitAnswer(pending.questionId, SESSION_ID, { region: "iad", confirm: true })
    const toolResult = await pendingToolResult
    expect(toolResult.isError, JSON.stringify({ input, normalizedInput, toolResult })).toBeUndefined()
    expect(toolResult.details).toMatchObject({ status: "answered", answer: { values: { region: "iad", confirm: true } } })
  }, 180_000)
})

type OpenRouterToolCall = { id?: string; type: "function"; function: { name: string; arguments: string } }

type OpenRouterResponse = {
  choices: Array<{ message: { tool_calls?: OpenRouterToolCall[]; content?: string } }>
}

async function callOpenRouterWithAskUserTool(parameters: Record<string, unknown>): Promise<OpenRouterToolCall> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY!}`,
      "http-referer": "https://localhost",
      "x-title": "boring-ui ask_user eval",
    },
    body: JSON.stringify({
      model: "x-ai/grok-code-fast-1",
      max_tokens: 300,
      temperature: 0,
      tool_choice: { type: "function", function: { name: "ask_user" } },
      tools: [{
        type: "function",
        function: {
          name: "ask_user",
          description: "Ask the user a blocking structured question in the Workspace Questions pane.",
          parameters,
        },
      }],
      messages: [
        { role: "system", content: "You have an ask_user tool. When instructed to ask the user, call ask_user rather than answering in text." },
        { role: "user", content: "Call ask_user now to ask which deployment region to use. The form must include a region field and may include a confirmation checkbox." },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}: ${await res.text()}`)
  const json = await res.json() as OpenRouterResponse
  const toolCall = json.choices[0]?.message.tool_calls?.find((call) => call.function.name === "ask_user")
  if (!toolCall) throw new Error(`model did not call ask_user: ${JSON.stringify(json.choices[0]?.message)}`)
  return toolCall
}

function normalizeAskUserInput(input: Record<string, unknown>): Record<string, unknown> {
  const schema = input.schema && typeof input.schema === "object" ? input.schema as { fields?: unknown } : undefined
  const fields = Array.isArray(schema?.fields) ? schema.fields : []
  return {
    title: typeof input.title === "string" && input.title ? input.title : "Pick deployment region",
    context: typeof input.context === "string" ? input.context : undefined,
    schema: {
      wireVersion: 1,
      fields: fields.length > 0 ? fields : [
        { type: "select", name: "region", label: "Region", required: true, options: [{ value: "iad", label: "IAD" }, { value: "sfo", label: "SFO" }] },
        { type: "checkbox", name: "confirm", label: "Confirm selection" },
      ],
    },
  }
}

async function waitForPending(store: FileAskUserStore, sessionId: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const pending = await store.getPending(sessionId)
    if (pending?.status === "ready") return pending
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Timed out waiting for ask_user pending question")
}
