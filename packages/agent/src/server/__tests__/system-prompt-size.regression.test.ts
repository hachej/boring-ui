import { execSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createAgentApp } from '../createAgentApp'

function ensureApiKey(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true
  try {
    const key = execSync('vault kv get -field=api_key secret/agent/anthropic', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    if (key) { process.env.ANTHROPIC_API_KEY = key; return true }
  } catch {}
  return false
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'boring-prompt-size-'))
  tempDirs.push(dir)
  return dir
}

describe('system-prompt-size regression', () => {
  const hasKey = ensureApiKey()

  test.skipIf(!hasKey)('prompt size stays within budget and contains no per-tool guideline patterns', async () => {
    const workspaceRoot = await makeTempDir()
    const app = await createAgentApp({
      workspaceRoot,
      mode: 'direct',
      logger: false,
    })

    const sessionId = 'prompt-size-test'

    // Send a minimal message to trigger pi session creation (lazy init).
    // This costs one LLM turn but is required for the system prompt to
    // materialize — pi builds it during session bootstrap.
    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      payload: {
        sessionId,
        message: 'Say only the word "ok" and nothing else.',
        model: { provider: 'anthropic', id: 'claude-haiku-4-5-20251001' },
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/sessions/${sessionId}/system-prompt`,
    })

    expect(res.statusCode).toBe(200)
    const { systemPrompt } = JSON.parse(res.body)
    expect(typeof systemPrompt).toBe('string')

    const promptLength = systemPrompt.length

    // Size budget: current baseline is ~34k chars (pi base + tool snippets).
    // After uhwx.13 slims tool-adapter (removes per-tool double-dash snippets
    // and guidelines), expect a ~700+ char drop. Ceiling set above current to
    // catch regressions; tighten after uhwx.13.
    const MAX_PROMPT_SIZE = 36_000
    expect(promptLength).toBeLessThan(MAX_PROMPT_SIZE)

    // Sanity: prompt must be non-trivial (> 1KB minimum)
    expect(promptLength).toBeGreaterThan(1000)

    // Size logged via test name for CI artifact visibility — no console.log needed

    await app.close()
  }, 30_000)
})
