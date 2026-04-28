#!/usr/bin/env tsx
/**
 * Smoke test for vercel-sandbox mode.
 * Requires ANTHROPIC_API_KEY + Vercel sandbox credentials.
 * Skips gracefully if creds unavailable.
 */

import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentApp } from '../../src/server/createAgentApp'

const MODE = 'vercel-sandbox' as const

function getSecret(field: string, path: string): string | undefined {
  try {
    return execSync(`vault kv get -field=${field} ${path}`, { encoding: 'utf8', timeout: 5000 }).trim() || undefined
  } catch { return undefined }
}

function ensureEnv() {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = getSecret('api_key', 'secret/agent/anthropic')
  }
  if (!process.env.VERCEL_TOKEN) {
    process.env.VERCEL_TOKEN = getSecret('token', 'secret/agent/vercel')
  }
  if (!process.env.VERCEL_TEAM_ID) {
    process.env.VERCEL_TEAM_ID = getSecret('team_id', 'secret/agent/vercel')
  }
  if (!process.env.VERCEL_PROJECT_ID) {
    process.env.VERCEL_PROJECT_ID = getSecret('project_id', 'secret/agent/vercel')
  }
}

interface ToolSmoke {
  name: string
  prompt: string
  expectTool: string
  expectOutputContains?: string
}

const TOOL_SMOKES: ToolSmoke[] = [
  {
    name: 'bash',
    prompt: 'Run `echo hello-smoke-vercel` in bash. Use only the bash tool.',
    expectTool: 'bash',
    expectOutputContains: 'hello-smoke-vercel',
  },
  {
    name: 'read',
    prompt: 'Read the file at /workspace/smoke-target.txt. Use only the read tool.',
    expectTool: 'read',
  },
  {
    name: 'write',
    prompt: 'Write "written-by-vercel-smoke" to /workspace/smoke-output.txt. Use only the write tool.',
    expectTool: 'write',
  },
  {
    name: 'find',
    prompt: 'Find all .txt files under /workspace. Use only the find tool.',
    expectTool: 'find',
  },
  {
    name: 'grep',
    prompt: 'Search for "smoke" in all files under /workspace. Use only the grep tool.',
    expectTool: 'grep',
  },
]

function log(step: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [smoke-${MODE}] ${step}: ${msg}`)
}

interface ToolCall { tool: string; params: Record<string, unknown> }
interface ParsedStream { toolCalls: ToolCall[]; toolOutputs: Array<{ toolCallId: string; output: unknown }> }

function parseSseStream(body: string): ParsedStream {
  const toolCalls: ToolCall[] = []
  const toolOutputs: Array<{ toolCallId: string; output: unknown }> = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue
    let chunk: Record<string, unknown>
    try { chunk = JSON.parse(payload) } catch { continue }
    if (chunk.type === 'tool-input-available') {
      toolCalls.push({ tool: chunk.toolName as string, params: (chunk.input as Record<string, unknown>) ?? {} })
    } else if (chunk.type === 'tool-output-available') {
      toolOutputs.push({ toolCallId: chunk.toolCallId as string, output: chunk.output })
    }
  }
  return { toolCalls, toolOutputs }
}

async function main() {
  ensureEnv()

  if (!process.env.ANTHROPIC_API_KEY || !process.env.VERCEL_TOKEN) {
    console.log('[smoke-vercel-sandbox] Missing credentials — skipping')
    process.exit(0)
  }

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'smoke-vercel-'))
  log('setup', `workspace: ${workspaceRoot}`)
  await writeFile(join(workspaceRoot, 'smoke-target.txt'), 'vercel sandbox smoke content\n')

  const app = await createAgentApp({ workspaceRoot, mode: MODE, logger: false })
  log('setup', 'agent app created (vercel-sandbox mode)')

  const results: Array<{ name: string; ok: boolean; reason?: string }> = []
  let sessionCounter = 0

  for (const smoke of TOOL_SMOKES) {
    sessionCounter++
    const sessionId = `smoke-${MODE}-${sessionCounter}`
    log(smoke.name, 'sending prompt')

    try {
      await app.inject({ method: 'POST', url: '/api/v1/agent/sessions', payload: { id: sessionId } })
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/chat',
        payload: { sessionId, message: smoke.prompt, model: { provider: 'anthropic', id: 'claude-sonnet-4-20250514' } },
      })

      if (res.statusCode !== 200) {
        results.push({ name: smoke.name, ok: false, reason: `HTTP ${res.statusCode}` })
        continue
      }

      const parsed = parseSseStream(res.body)
      const matchingCall = parsed.toolCalls.find(tc => tc.tool === smoke.expectTool)
      if (!matchingCall) {
        results.push({ name: smoke.name, ok: false, reason: `expected "${smoke.expectTool}" not called. Got: [${parsed.toolCalls.map(t => t.tool)}]` })
        continue
      }

      if (smoke.expectOutputContains) {
        const outputStr = JSON.stringify(parsed.toolOutputs)
        if (!outputStr.includes(smoke.expectOutputContains)) {
          results.push({ name: smoke.name, ok: false, reason: `output missing "${smoke.expectOutputContains}"` })
          continue
        }
      }

      results.push({ name: smoke.name, ok: true })
      log(smoke.name, 'PASS')
    } catch (err) {
      results.push({ name: smoke.name, ok: false, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  await app.close()
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {})

  console.log('\n--- Results ---')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
