/**
 * Eval: a real model should choose the Workspace-owned ask_user tool when it
 * needs a missing blocking decision. This talks to an OpenAI-compatible chat
 * completions API with tool-calling enabled, then executes the produced
 * ask_user call against the real runtime.
 *
 * Gated on OPENAI_API_KEY or OPENROUTER_API_KEY — skipped silently in CI without
 * either. OpenAI (incl. codex / gpt-5 models) is preferred when its key is set.
 * Run manually:
 *   OPENAI_API_KEY=sk-... pnpm --filter @hachej/boring-ask-user exec vitest run src/server/__tests__/ask-user-tool.eval.test.ts
 *   OPENAI_API_KEY=sk-... ASK_USER_EVAL_MODEL=gpt-5.1-codex pnpm --filter @hachej/boring-ask-user exec vitest run src/server/__tests__/ask-user-tool.eval.test.ts
 *   OPENROUTER_API_KEY=sk-or-v1-... ASK_USER_EVAL_MODEL=x-ai/grok-code-fast-1 pnpm --filter @hachej/boring-ask-user exec vitest run src/server/__tests__/ask-user-tool.eval.test.ts
 */
import { describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AskUserRuntime, createAskUserTool, FileAskUserStore } from "../index"

const HAS_OPENAI = !!process.env.OPENAI_API_KEY
const HAS_GEMINI = !!process.env.GEMINI_API_KEY
const HAS_OPENROUTER = !!process.env.OPENROUTER_API_KEY
const describeIf = (HAS_OPENAI || HAS_GEMINI || HAS_OPENROUTER) ? describe : describe.skip
const SESSION_ID = "eval-ask-user-session"

interface EvalProvider {
  label: string
  url: string
  apiKey: string
  model: string
  headers: Record<string, string>
  /** gpt-5 / codex / o-series take max_completion_tokens and only the default temperature. */
  reasoning: boolean
  /** Some OpenAI-compatible shims (Gemini) ignore a named-function force; "required" is honored. */
  toolChoice: unknown
  /** Output token budget; thinking models need headroom for reasoning + the call. */
  maxTokens?: number
}

const NAMED_TOOL_CHOICE = { type: "function", function: { name: "ask_user" } }

// Prefer OpenAI (incl. codex models) when its key is present, else OpenRouter.
// Override the model with ASK_USER_EVAL_MODEL.
function resolveEvalProvider(): EvalProvider {
  if (HAS_OPENAI) {
    const model = process.env.ASK_USER_EVAL_MODEL ?? "gpt-5.1-codex"
    return {
      label: `openai:${model}`,
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY!,
      model,
      headers: {},
      reasoning: /^(gpt-5|o[134])/.test(model) || model.includes("codex"),
      toolChoice: NAMED_TOOL_CHOICE,
    }
  }
  if (HAS_GEMINI) {
    // Gemini's OpenAI-compat shim honors tool_choice:"required" (not a named
    // force) and 2.5-flash needs budget headroom for its thinking pass.
    const model = process.env.ASK_USER_EVAL_MODEL ?? "gemini-2.5-flash"
    return {
      label: `gemini:${model}`,
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: process.env.GEMINI_API_KEY!,
      model,
      headers: {},
      reasoning: false,
      toolChoice: "required",
      maxTokens: 2048,
    }
  }
  const model = process.env.ASK_USER_EVAL_MODEL ?? "x-ai/grok-code-fast-1"
  return {
    label: `openrouter:${model}`,
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: process.env.OPENROUTER_API_KEY!,
    model,
    headers: { "http-referer": "https://localhost", "x-title": "boring-ui ask_user eval" },
    reasoning: false,
    toolChoice: NAMED_TOOL_CHOICE,
  }
}

describeIf("ask-user eval (live LLM)", () => {
  test("real model calls ask_user for a required deployment-region decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-user-eval-"))
    const store = new FileAskUserStore(join(dir, "questions.json"))
    const runtime = new AskUserRuntime({ store, ownerPrincipalId: "anonymous" })
    const tool = createAskUserTool({ runtime, sessionId: SESSION_ID })
    const toolCall = await callModelWithAskUserTool(tool.parameters)
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

async function callModelWithAskUserTool(parameters: Record<string, unknown>): Promise<OpenRouterToolCall> {
  const provider = resolveEvalProvider()
  const tokenKey = provider.reasoning ? "max_completion_tokens" : "max_tokens"
  const tokenBudget = { [tokenKey]: provider.maxTokens ?? (provider.reasoning ? 2000 : 300) }
  const temperature = provider.reasoning ? {} : { temperature: 0 }
  const res = await fetch(provider.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
      ...provider.headers,
    },
    body: JSON.stringify({
      model: provider.model,
      ...tokenBudget,
      ...temperature,
      tool_choice: provider.toolChoice,
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
  if (!res.ok) throw new Error(`${provider.label} returned ${res.status}: ${await res.text()}`)
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
