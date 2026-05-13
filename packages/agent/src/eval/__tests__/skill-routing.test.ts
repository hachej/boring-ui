/**
 * Eval: skill: <name> routing
 *
 * Verifies that the PI agent, when sent a message formatted as
 * `skill: <name>\n\n<args>`, actually invokes the named skill's behaviour
 * (i.e. makes the right tool calls) rather than treating it as free text.
 *
 * Gated on ANTHROPIC_API_KEY (or any valid LLM key) — skipped silently
 * without one, same pattern as canary.test.ts.
 */
import { describe, test, expect, beforeAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evalAgentPrompt } from "../evalPrompt"
import { EvalRegex } from "../types"
import { createAgentApp } from "../../server"
import type { FastifyInstance } from "fastify"

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY
const describeIf = HAS_KEY ? describe : describe.skip

const MACRO_DECK_SKILL = `---
name: macro-deck
description: Create and edit macro briefing decks in markdown. Use this whenever the user asks for a deck, slides, presentation, or briefing.
---

# macro-deck

When the task is to create or edit a deck:

1. Write a markdown file under \`deck/\` with a title encoded as \`## title: <title>\`
2. Split slides with \`---\`
3. Keep slides concise

## Example

\`\`\`md
## title: My deck

# Slide one

Content here.
\`\`\`
`

describeIf("eval: skill routing", () => {
  let app: FastifyInstance
  let workspaceRoot: string

  beforeAll(async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "agent-eval-skill-"))
    mkdirSync(join(workspaceRoot, ".agents", "skills", "macro-deck"), { recursive: true })
    mkdirSync(join(workspaceRoot, "deck"), { recursive: true })
    writeFileSync(
      join(workspaceRoot, ".agents", "skills", "macro-deck", "SKILL.md"),
      MACRO_DECK_SKILL,
    )

    app = await createAgentApp({
      workspaceRoot,
      mode: "direct",
      logger: false,
      pi: {
        additionalSkillPaths: [join(workspaceRoot, ".agents", "skills")],
      },
    })
    return async () => { await app.close() }
  }, 30_000)

  test(
    "skill: macro-deck triggers a write to deck/",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: "skill: macro-deck\n\ncreate a one-slide deck titled 'Test deck' with the text 'hello world'",
        expect: {
          tool: "write",
          params: { path: EvalRegex(/^deck\//) },
        },
        retries: 1,
        timeoutMs: 60_000,
      })
      expect(result.ok, result.reason ?? `actual calls: ${JSON.stringify(result.actual)}`).toBe(true)
    },
    120_000,
  )

  test(
    "plain text message without skill: prefix does not create a deck file",
    async () => {
      const result = await evalAgentPrompt({
        app,
        prompt: "what is 2 + 2?",
        expectNoToolCall: true,
        retries: 1,
        timeoutMs: 45_000,
      })
      expect(result.ok, result.reason ?? "").toBe(true)
    },
    90_000,
  )
})

if (!HAS_KEY) {
  console.warn(
    "[eval skill-routing] skipped: ANTHROPIC_API_KEY not set.",
  )
}
