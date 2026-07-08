#!/usr/bin/env tsx
import Fastify from 'fastify'
import { Sandbox } from '@vercel/sandbox'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHarness } from '../src/shared/harness'
import type { AgentTool } from '../src/shared/tool'
import { ErrorCode } from '../src/shared/error-codes'
import { registerAgentRoutes } from '../src/server/registerAgentRoutes'
import { FileHandleStore } from '@hachej/boring-sandbox/providers'
import { provisionWorkspaceRuntime } from '../src/server/workspace/provisioning'
import { resolveMode } from '@hachej/boring-bash/modes'

const SAFE_TIMEOUT_MS = 10 * 60_000

function nowMs(startedAt: number): number {
  return Date.now() - startedAt
}

function log(name: string, fields: Record<string, unknown>): void {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`)
  console.log(`[readiness] ${name} ${pairs.join(' ')}`)
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function createSmokePythonPackage(root: string): Promise<string> {
  const packageRoot = join(root, 'bm-smoke-sdk')
  const moduleRoot = join(packageRoot, 'readiness_smoke')
  await mkdir(moduleRoot, { recursive: true })
  await writeFile(join(packageRoot, 'pyproject.toml'), `
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "boring-agent-readiness-smoke"
version = "0.0.0"
requires-python = ">=3.9"
dependencies = ["pandas"]

[project.scripts]
bm = "readiness_smoke.cli:main"

[tool.setuptools.packages.find]
where = ["."]
`.trimStart())
  await writeFile(join(moduleRoot, '__init__.py'), '')
  await writeFile(join(moduleRoot, 'cli.py'), `
def main():
    import pandas
    print(f"bm readiness smoke ok pandas={pandas.__version__}")
    return 0
`.trimStart())
  return packageRoot
}

function makeHarness(onTools: (tools: AgentTool[]) => void): (opts: { tools: AgentTool[] }) => Promise<AgentHarness> {
  return async ({ tools }) => {
    onTools(tools)
    return {
      id: 'vercel-capability-readiness-smoke-harness',
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
}

async function readFirstChunkMs(response: Response, startedAt: number): Promise<number> {
  if (!response.body) return nowMs(startedAt)
  const reader = response.body.getReader()
  try {
    const first = await reader.read()
    if (first.done) return nowMs(startedAt)
    return nowMs(startedAt)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function parseStatusEvents(buffer: string): Array<Record<string, any>> {
  return buffer
    .split('\n\n')
    .map((block) => block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'))
    .filter(Boolean)
    .map((data) => {
      try { return JSON.parse(data) as Record<string, any> } catch { return null }
    })
    .filter((event): event is Record<string, any> => Boolean(event))
}

async function watchReadyStatus(url: string, startedAt: number): Promise<{ workspaceReadyMs?: number; runtimeReadyMs?: number }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`ready-status failed with ${response.status}`)
  if (!response.body) throw new Error('ready-status response had no body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let workspaceReadyMs: number | undefined
  let runtimeReadyMs: number | undefined
  try {
    while (runtimeReadyMs === undefined) {
      const { done, value } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: !done })
      if (done) buffer += decoder.decode()
      for (const event of parseStatusEvents(buffer)) {
        const workspaceState = event.capabilities?.workspace?.state
        const runtimeState = event.capabilities?.runtimeDependencies?.state
        if (workspaceReadyMs === undefined && workspaceState === 'ready') {
          workspaceReadyMs = nowMs(startedAt)
          log('workspace_ready', { workspace_ready_ms: workspaceReadyMs })
        }
        if (runtimeState === 'ready') {
          runtimeReadyMs = nowMs(startedAt)
          log('runtime_dependencies_ready', { runtime_dependencies_ready_ms: runtimeReadyMs })
          break
        }
        if (runtimeState === 'failed' || event.state === 'degraded') {
          throw new Error(`runtimeDependencies failed: ${JSON.stringify(event)}`)
        }
      }
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return { workspaceReadyMs, runtimeReadyMs }
}

async function cleanupSandboxes(store: FileHandleStore): Promise<void> {
  const token = process.env.VERCEL_TOKEN ?? process.env.VERCEL_ACCESS_TOKEN ?? process.env.VERCEL_OIDC_TOKEN
  if (!token) return
  const records = await store.list().catch(() => [])
  await Promise.all(records.map(async (record) => {
    try {
      const sandbox = await Sandbox.get({
        token,
        teamId: process.env.VERCEL_TEAM_ID!,
        projectId: process.env.VERCEL_PROJECT_ID!,
        name: record.sandboxId,
        resume: true,
      } as Parameters<typeof Sandbox.get>[0] & { name?: string })
      await sandbox.delete()
    } catch (error) {
      console.warn(`[readiness] cleanup_warning sandboxId=${record.sandboxId} message=${error instanceof Error ? error.message : String(error)}`)
    }
  }))
}

async function main(): Promise<void> {
  if (process.env.RUN_VERCEL_CAPABILITY_READINESS_SMOKE !== '1') {
    console.error('Skipping real Vercel capability readiness smoke. Set RUN_VERCEL_CAPABILITY_READINESS_SMOKE=1 to run.')
    return
  }
  const token = process.env.VERCEL_TOKEN ?? process.env.VERCEL_ACCESS_TOKEN ?? process.env.VERCEL_OIDC_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN, VERCEL_ACCESS_TOKEN, or VERCEL_OIDC_TOKEN is required')
  requireEnv('VERCEL_TEAM_ID')
  requireEnv('VERCEL_PROJECT_ID')

  const startedAt = Date.now()
  const tempDir = await mkdtemp(join(tmpdir(), 'boring-vercel-capability-readiness-'))
  const store = new FileHandleStore({ storePath: join(tempDir, 'sandboxes.json') })
  const workspaceId = `readiness-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const app = Fastify({ logger: false })
  let capturedTools: AgentTool[] = []
  let provisioningStartedMs: number | undefined

  const abort = AbortSignal.timeout(SAFE_TIMEOUT_MS)
  abort.addEventListener('abort', () => {
    log('timeout', { timeout_ms: SAFE_TIMEOUT_MS })
  }, { once: true })

  try {
    const packageRoot = await createSmokePythonPackage(tempDir)
    await app.register(registerAgentRoutes, {
      sandboxHandleStore: store,
      runtimeModeAdapter: resolveMode('vercel-sandbox', { sandboxHandleStore: store }),
      getWorkspaceId: () => workspaceId,
      getWorkspaceRoot: () => tempDir,
      harnessFactory: makeHarness((tools) => { capturedTools = tools }),
      provisionRuntime: async ({ provisioningAdapter, runtimeLayout }) => {
        if (!provisioningAdapter) throw new Error('missing Vercel provisioning adapter')
        provisioningStartedMs = nowMs(startedAt)
        log('runtime_dependencies_started', { runtime_dependencies_started_ms: provisioningStartedMs })
        return await provisionWorkspaceRuntime({
          adapter: provisioningAdapter,
          runtimeLayout,
          plugins: [{
            id: 'vercel-readiness-smoke',
            provisioning: {
              python: [{
                id: 'bm-smoke-sdk',
                packageName: 'boring-agent-readiness-smoke',
                projectFile: join(packageRoot, 'pyproject.toml'),
                expectedBins: ['bm'],
              }],
            },
          }],
        })
      },
    })
    await app.ready()

    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    log('server_ready', { server_ready_ms: nowMs(startedAt), workspaceId })

    const readyPromise = watchReadyStatus(`${address}/api/v1/ready-status`, startedAt)
    const chatStartedAt = Date.now()
    // The agent API must answer while runtime dependencies are still
    // preparing — the pi-chat sessions list exercises the binding without an
    // LLM turn.
    const chat = await fetch(`${address}/api/v1/agent/pi-chat/sessions`, { signal: abort })
    if (!chat.ok) throw new Error(`pi-chat sessions failed with ${chat.status}: ${await chat.text()}`)
    const chatFirstByteMs = await readFirstChunkMs(chat, chatStartedAt)
    log('chat_first_byte', { chat_first_byte_ms: chatFirstByteMs })

    const bash = capturedTools.find((tool) => tool.name === 'bash')
    if (!bash) throw new Error('bash tool was not registered')
    const preReady = await bash.execute(
      { command: 'bm --help' },
      { toolCallId: 'vercel-readiness-pre-ready', abortSignal: new AbortController().signal },
    )
    const preReadyCode = (preReady.details as { code?: unknown } | undefined)?.code
    log('dependency_tool_pre_ready', { dependency_tool_pre_ready_code: preReadyCode })
    if (preReadyCode !== ErrorCode.enum.AGENT_RUNTIME_NOT_READY) {
      throw new Error(`expected AGENT_RUNTIME_NOT_READY before runtime ready; got ${String(preReadyCode)}`)
    }

    const ready = await readyPromise
    if (ready.runtimeReadyMs === undefined) throw new Error('runtimeDependencies did not become ready')

    const postReady = await bash.execute(
      { command: 'bm' },
      { toolCallId: 'vercel-readiness-post-ready', abortSignal: new AbortController().signal },
    )
    const postReadyText = postReady.content.map((part) => part.text).join('\n')
    const postReadyOk = !postReady.isError && /bm readiness smoke ok pandas=/.test(postReadyText)
    log('dependency_tool_post_ready', { dependency_tool_post_ready: postReadyOk ? 'ok' : 'failed' })
    if (!postReadyOk) throw new Error(`bm smoke failed after runtime ready: ${postReadyText}`)
  } finally {
    await app.close().catch(() => undefined)
    await cleanupSandboxes(store)
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
