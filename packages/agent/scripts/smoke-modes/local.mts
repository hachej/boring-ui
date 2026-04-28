#!/usr/bin/env tsx
/**
 * Smoke test for local (bwrap) mode.
 * Skip if bwrap binary not found.
 * Requires ANTHROPIC_API_KEY.
 */

import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentApp } from '../../src/server/createAgentApp'

const MODE = 'local' as const

// Gate on bwrap availability
try {
  execSync('which bwrap', { stdio: 'ignore' })
} catch {
  console.log('[smoke-local] bwrap not found — skipping')
  process.exit(0)
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
    prompt: 'Run `echo hello-smoke-local` in bash and show me the output. Use only the bash tool.',
    expectTool: 'bash',
    expectOutputContains: 'hello-smoke-local',
  },
  {
    name: 'read',
    prompt: 'Read the file called smoke-target.txt and show me its contents. Use only the read tool.',
    expectTool: 'read',
  },
  {
    name: 'write',
    prompt: 'Write "written-by-smoke-local" to a new file called smoke-output.txt. Use only the write tool.',
    expectTool: 'write',
  },
  {
    name: 'find',
    prompt: 'Find all .txt files in this directory. Use only the find tool.',
    expectTool: 'find',
  },
  {
    name: 'grep',
    prompt: 'Search for the string "smoke" in all files. Use only the grep tool.',
    expectTool: 'grep',
  },
]

function log(step: string, msg: string) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [smoke-${MODE}] ${step}: ${msg}`)
}

interface ToolCall { tool: string; params: Record<string, unknown> }
interface ParsedStream {
  toolCalls: ToolCall[]
  text: string
  toolOutputs: Array<{ toolCallId: string; output: unknown }>
}

function parseSseStream(body: string): ParsedStream {
  const toolCalls: ToolCall[] = []
  const textParts: string[] = []
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
    } else if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
      textParts.push(chunk.delta)
    } else if (chunk.type === 'tool-output-available') {
      toolOutputs.push({ toolCallId: chunk.toolCallId as string, output: chunk.output })
    }
  }
  return { toolCalls, text: textParts.join(''), toolOutputs }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      const key = execSync('vault kv get -field=api_key secret/agent/anthropic', { encoding: 'utf8' }).trim()
      if (key) process.env.ANTHROPIC_API_KEY = key
    } catch {}
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set. Skipping.')
    process.exit(0)
  }

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'smoke-local-'))
  log('setup', `workspace: ${workspaceRoot}`)
  await writeFile(join(workspaceRoot, 'smoke-target.txt'), 'original content for local smoke test\n')
  await mkdir(join(workspaceRoot, 'subdir'), { recursive: true })
  await writeFile(join(workspaceRoot, 'subdir', 'nested.txt'), 'nested smoke file\n')

  const app = await createAgentApp({ workspaceRoot, mode: MODE, logger: false })
  log('setup', 'agent app created (local/bwrap mode)')

  const results: Array<{ name: string; ok: boolean; reason?: string }> = []
  let sessionCounter = 0

  for (const smoke of TOOL_SMOKES) {
    sessionCounter++
    const sessionId = `smoke-${MODE}-${sessionCounter}`
    log(smoke.name, `sending prompt`)

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
        results.push({ name: smoke.name, ok: false, reason: `expected tool "${smoke.expectTool}" not called. Got: [${parsed.toolCalls.map(t => t.tool)}]` })
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
