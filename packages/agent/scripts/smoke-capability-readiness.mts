#!/usr/bin/env tsx
import Fastify from 'fastify'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { ErrorCode } from '../src/shared/error-codes'
import type { AgentHarness } from '../src/shared/harness'
import type { AgentTool } from '../src/shared/tool'
import { mergeTools } from '../src/server/catalog/mergeTools'
import { registerAgentRoutes } from '../src/server/registerAgentRoutes'
import { resolveMode } from '@hachej/boring-bash/modes'

function log(name: string, fields: Record<string, unknown>): void {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`)
  console.log(`[readiness] ${name} ${pairs.join(' ')}`)
}

function makeHarness(): AgentHarness {
  return {
    id: 'capability-readiness-smoke-harness',
    placement: 'server',
    sessions: {
      async list() { return [] },
      async create() {
        const now = new Date().toISOString()
        return { id: 's1', title: 'Smoke', createdAt: now, updatedAt: now, turnCount: 0 }
      },
      async load() {
        const now = new Date().toISOString()
        return { id: 's1', title: 'Smoke', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
      },
      async delete() {},
    },
  }
}

async function main(): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-capability-readiness-smoke-'))
  let resolveProvision: (() => void) | undefined
  const provisioningPromise = new Promise<void>((resolve) => { resolveProvision = resolve })
  const app = Fastify({ logger: false })

  const startedAt = performance.now()
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    runtimeModeAdapter: resolveMode('direct'),
    getWorkspaceId: () => 'smoke-workspace',
    getWorkspaceRoot: () => workspaceRoot,
    provisionRuntime: async () => {
      log('runtime_dependencies_started', { at_ms: Math.round(performance.now() - startedAt) })
      await provisioningPromise
      return {
        changed: false,
        env: { BORING_AGENT_WORKSPACE_ROOT: workspaceRoot },
        pathEntries: [
          join(workspaceRoot, '.boring-agent', 'venv', 'bin'),
          join(workspaceRoot, '.boring-agent', 'sdk', 'uv', 'bin'),
        ],
        skillPaths: [],
      }
    },
    harnessFactory: async () => makeHarness(),
  })
  await app.ready()
  log('app_ready', { app_ready_ms: Math.round(performance.now() - startedAt) })

  // The chat API must answer while runtime provisioning is still pending —
  // the pi-chat sessions list exercises the agent binding without an LLM.
  const chatStartedAt = performance.now()
  const chat = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/pi-chat/sessions',
  })
  log('chat_response', {
    chat_response_ms: Math.round(performance.now() - chatStartedAt),
    status: chat.statusCode,
  })
  if (chat.statusCode !== 200) throw new Error(`pi-chat sessions blocked with status ${chat.statusCode}: ${chat.body}`)

  log('ready_status_pending', {
    runtime_preparing: true,
    note: 'ready-status SSE remains open until runtimeDependencies leaves preparing',
  })

  const runtimeTool: AgentTool = {
    name: 'macro_smoke',
    description: 'Smoke dependency-backed macro tool.',
    readinessRequirements: ['runtime:python'],
    parameters: { type: 'object', properties: {} },
    async execute() { return { content: [{ type: 'text', text: 'ok' }] } },
  }
  const [blockedTool] = mergeTools({
    standardTools: [runtimeTool],
    checkReadiness: () => ({ ready: false, state: 'preparing', workspaceId: 'smoke-workspace', retryable: true }),
  })
  const blocked = await blockedTool!.execute({}, { toolCallId: 'call-smoke', abortSignal: new AbortController().signal })
  const blockedCode = (blocked.details as { code?: string } | undefined)?.code
  log('dependency_tool_pre_ready', { code: blockedCode, retryable: (blocked.details as { retryable?: boolean } | undefined)?.retryable })
  if (blockedCode !== ErrorCode.enum.AGENT_RUNTIME_NOT_READY) throw new Error(`unexpected blocked code ${blockedCode}`)

  const runtimeStartedAt = performance.now()
  resolveProvision?.()
  const ready = await app.inject({ method: 'GET', url: '/api/v1/ready-status' })
  log('runtime_dependencies_ready', {
    wait_ms: Math.round(performance.now() - runtimeStartedAt),
    runtime_ready: ready.body.includes('"runtimeDependencies":{"state":"ready"'),
  })
  if (!ready.body.includes('"runtimeDependencies":{"state":"ready"')) {
    throw new Error(`expected runtimeDependencies ready; got ${ready.body}`)
  }

  app.server.closeAllConnections?.()
  await app.close()
  log('app_closed', {})
  await rm(workspaceRoot, { recursive: true, force: true })
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
