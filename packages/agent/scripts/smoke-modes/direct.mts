#!/usr/bin/env tsx
/**
 * Smoke test for direct mode — exercises all pi-built tools end-to-end.
 *
 * Requires ANTHROPIC_API_KEY in env (or Vault).
 * Creates a temp workspace, boots createAgentApp({ mode: 'direct' }),
 * sends one prompt per tool, asserts the expected tool fires and output
 * contains a substring.
 *
 * Exit 0 = all pass. Exit 1 = at least one failure.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentApp } from '../../src/server/createAgentApp'

const MODE = 'direct' as const

interface ToolSmoke {
  name: string
  prompt: string
  expectTool: string
  expectOutputContains?: string
}

const TOOL_SMOKES: ToolSmoke[] = [
  {
    name: 'bash',
    prompt: 'Run `echo hello-smoke-test` in bash and show me the output. Use only the bash tool, nothing else.',
    expectTool: 'bash',
    expectOutputContains: 'hello-smoke-test',
  },
  {
    name: 'read',
    prompt: 'Read the file called smoke-target.txt and show me its contents. Use only the read tool.',
    expectTool: 'read',
  },
  {
    name: 'write',
    prompt: 'Write the text "written-by-smoke" to a new file called smoke-output.txt. Use only the write tool.',
    expectTool: 'write',
  },
  {
    name: 'edit',
    prompt: 'In smoke-target.txt, replace the word "original" with "edited". Use only the edit tool.',
    expectTool: 'edit',
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

function logJson(data: Record<string, unknown>) {
  const ts = new Date().toISOString()
  console.log(JSON.stringify({ timestamp: ts, mode: MODE, ...data }))
}

interface ToolCall {
  tool: string
  params: Record<string, unknown>
}

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
    try {
      chunk = JSON.parse(payload)
    } catch {
      continue
    }
    if (chunk.type === 'tool-input-available') {
      const toolName = chunk.toolName as string
      const input = chunk.input as Record<string, unknown> | undefined
      toolCalls.push({ tool: toolName, params: input ?? {} })
    } else if (chunk.type === 'text-delta') {
      if (typeof chunk.delta === 'string') textParts.push(chunk.delta)
    } else if (chunk.type === 'tool-output-available') {
      toolOutputs.push({
        toolCallId: chunk.toolCallId as string,
        output: chunk.output,
      })
    }
  }

  return { toolCalls, text: textParts.join(''), toolOutputs }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      const { execSync } = await import('node:child_process')
      const key = execSync('vault kv get -field=api_key secret/agent/anthropic', {
        encoding: 'utf8',
      }).trim()
      if (key) process.env.ANTHROPIC_API_KEY = key
    } catch {}
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set and vault unavailable. Skipping.')
    process.exit(0)
  }

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'smoke-direct-'))
  log('setup', `workspace: ${workspaceRoot}`)

  await writeFile(join(workspaceRoot, 'smoke-target.txt'), 'original content for smoke test\n')
  await mkdir(join(workspaceRoot, 'subdir'), { recursive: true })
  await writeFile(join(workspaceRoot, 'subdir', 'nested.txt'), 'nested smoke file\n')

  const app = await createAgentApp({
    workspaceRoot,
    mode: MODE,
    logger: false,
  })

  log('setup', 'agent app created')

  const results: Array<{ name: string; ok: boolean; reason?: string }> = []
  let sessionCounter = 0

  for (const smoke of TOOL_SMOKES) {
    sessionCounter++
    const sessionId = `smoke-${MODE}-${sessionCounter}`
    log(smoke.name, `sending prompt: "${smoke.prompt.slice(0, 60)}..."`)
    logJson({ step: 'send', tool: smoke.name, prompt: smoke.prompt })

    try {
      await app.inject({ method: 'POST', url: '/api/v1/agent/sessions', payload: { id: sessionId } })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/chat',
        payload: {
          sessionId,
          message: smoke.prompt,
          model: { provider: 'anthropic', id: 'claude-sonnet-4-20250514' },
        },
      })

      if (res.statusCode !== 200) {
        results.push({ name: smoke.name, ok: false, reason: `HTTP ${res.statusCode}: ${res.body.slice(0, 200)}` })
        logJson({ step: 'fail', tool: smoke.name, status: 'http_error', code: res.statusCode })
        continue
      }

      const parsed = parseSseStream(res.body)
      logJson({ step: 'received', tool: smoke.name, toolCalls: parsed.toolCalls.map(t => t.tool), textLen: parsed.text.length })

      const matchingCall = parsed.toolCalls.find(tc => tc.tool === smoke.expectTool)
      if (!matchingCall) {
        results.push({
          name: smoke.name,
          ok: false,
          reason: `expected tool "${smoke.expectTool}" not called. Got: [${parsed.toolCalls.map(t => t.tool).join(', ')}]`,
        })
        logJson({ step: 'fail', tool: smoke.name, status: 'wrong_tool' })
        continue
      }

      if (smoke.expectOutputContains) {
        const outputStr = JSON.stringify(parsed.toolOutputs)
        if (!outputStr.includes(smoke.expectOutputContains)) {
          results.push({
            name: smoke.name,
            ok: false,
            reason: `output missing "${smoke.expectOutputContains}". Got: ${outputStr.slice(0, 200)}`,
          })
          logJson({ step: 'fail', tool: smoke.name, status: 'missing_output' })
          continue
        }
      }

      results.push({ name: smoke.name, ok: true })
      log(smoke.name, `PASS`)
      logJson({ step: 'pass', tool: smoke.name })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ name: smoke.name, ok: false, reason: msg })
      logJson({ step: 'error', tool: smoke.name, error: msg })
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

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
