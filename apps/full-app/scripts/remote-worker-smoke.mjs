#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const token = process.env.BORING_WORKER_INTERNAL_TOKEN || `remote-smoke-${Date.now()}`
const ownsWorkspaceRoot = !process.env.BORING_WORKER_WORKSPACE_ROOT
const workspaceRoot = process.env.BORING_WORKER_WORKSPACE_ROOT || join(tmpdir(), `boring-remote-worker-smoke-${process.pid}`)
const workspaceId = process.env.REMOTE_WORKER_SMOKE_WORKSPACE_ID || randomUUID()

process.env.BORING_WORKER_INTERNAL_TOKEN = token
process.env.BORING_WORKER_WORKSPACE_ROOT = workspaceRoot
process.env.REMOTE_WORKER_SMOKE_PROCESS_SECRET = 'must-not-leak'

function log(event, fields = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

function fail(message) {
  throw new Error(message)
}

function expectedLimitValue(envName, fallback) {
  return String(Number.parseInt(process.env[envName] || fallback, 10))
}

function expectedFileSizeBlocks() {
  return String(Number.parseInt(process.env.BORING_WORKER_EXEC_FILE_SIZE_MIB || '64', 10) * 2048)
}

function expectedVirtualMemoryKb() {
  return String(Number.parseInt(process.env.BORING_WORKER_EXEC_VIRTUAL_MEMORY_MIB || '1024', 10) * 1024)
}

async function importBuiltModules() {
  try {
    const agent = await import('@hachej/boring-agent/server')
    const worker = await import('../dist/server/agent-worker.js')
    return { agent, worker }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(
      `remote-worker smoke requires built packages and full-app dist. Run ` +
      `"pnpm --filter full-app build" first. Import failed: ${message}`,
    )
  }
}

function createDummyHarnessFactory() {
  const sessions = {
    async list() { return [] },
    async create(_ctx, init = {}) {
      const now = new Date().toISOString()
      return { id: workspaceId, title: init.title ?? workspaceId, createdAt: now, updatedAt: now, turnCount: 0 }
    },
    async load(_ctx, sessionId) {
      const now = new Date().toISOString()
      return { id: sessionId, title: sessionId, createdAt: now, updatedAt: now, turnCount: 0 }
    },
    async delete() {},
  }
  return async () => ({ id: 'remote-worker-smoke', placement: 'server', sessions })
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(Number(process.env.REMOTE_WORKER_SMOKE_TIMEOUT_MS || 15000)),
  })
  const text = await response.text()
  let body = text
  try { body = text ? JSON.parse(text) : null } catch { /* keep text */ }
  if (!response.ok) {
    fail(`${init.method ?? 'GET'} ${url} failed ${response.status}: ${text}`)
  }
  return body
}

async function expectStatus(url, init, expectedStatus) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(Number(process.env.REMOTE_WORKER_SMOKE_TIMEOUT_MS || 15000)),
  })
  const text = await response.text().catch(() => '')
  if (response.status !== expectedStatus) {
    fail(`${init.method ?? 'GET'} ${url} expected ${expectedStatus}, got ${response.status}: ${text}`)
  }
}

async function runFsEventsSmoke(workerBaseUrl, headers) {
  const controller = new AbortController()
  const response = await fetch(`${workerBaseUrl}/internal/workspaces/${workspaceId}/fs/events`, {
    headers,
    signal: controller.signal,
  })
  if (!response.ok || !response.body) fail(`fs-events failed ${response.status}`)
  const reader = response.body.getReader()
  try {
    setTimeout(() => {
      void jsonFetch(`${workerBaseUrl}/internal/workspaces/${workspaceId}/fs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ op: 'writeFile', path: 'event.txt', data: 'event' }),
      })
    }, 200)

    const deadline = Date.now() + 5000
    let buffer = ''
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) fail('fs-events stream closed before event')
      buffer += new TextDecoder().decode(value)
      if (buffer.includes('event.txt')) return
    }
    fail(`fs-events timed out waiting for event; buffer=${buffer}`)
  } finally {
    await reader.cancel().catch(() => {})
    controller.abort()
  }
}

async function main() {
  log('remote_worker_smoke.start', { workspaceRoot, workspaceId })
  await rm(join(workspaceRoot, workspaceId), { recursive: true, force: true })

  const { agent, worker } = await importBuiltModules()
  const { createAgentApp, createRemoteWorkerModeAdapter } = agent
  const { createAgentWorkerApp } = worker

  const { app: workerApp } = await createAgentWorkerApp()
  await workerApp.listen({ host: '127.0.0.1', port: 0 })
  const workerAddress = workerApp.server.address()
  const workerBaseUrl = `http://127.0.0.1:${workerAddress.port}`

  const publicApp = await createAgentApp({
    logger: false,
    sessionId: workspaceId,
    workspaceRoot: join(tmpdir(), 'remote-worker-smoke-public-host-unused'),
    runtimeModeAdapter: createRemoteWorkerModeAdapter({ baseUrl: workerBaseUrl, token }),
    harnessFactory: createDummyHarnessFactory(),
  })
  await publicApp.listen({ host: '127.0.0.1', port: 0 })
  const publicAddress = publicApp.server.address()
  const publicBaseUrl = `http://127.0.0.1:${publicAddress.port}`
  const workerHeaders = { 'x-boring-internal-token': token }

  try {
    await expectStatus(`${workerBaseUrl}/health`, { method: 'GET' }, 200)
    await expectStatus(`${workerBaseUrl}/internal/health`, { method: 'GET' }, 401)
    await expectStatus(`${workerBaseUrl}/internal/health`, { method: 'GET', headers: workerHeaders }, 200)
    await expectStatus(`${workerBaseUrl}/internal/workspaces/default/exec`, {
      method: 'POST',
      headers: workerHeaders,
      body: JSON.stringify({ cmd: 'true' }),
    }, 400)

    await jsonFetch(`${publicBaseUrl}/api/v1/files`, {
      method: 'POST',
      body: JSON.stringify({ path: 'from-public.txt', content: 'public->worker' }),
    })

    const seenByWorker = await jsonFetch(`${workerBaseUrl}/internal/workspaces/${workspaceId}/exec`, {
      method: 'POST',
      headers: workerHeaders,
      body: JSON.stringify({ cmd: 'cat from-public.txt', timeoutMs: 10000 }),
    })
    const workerStdout = Buffer.from(seenByWorker.stdoutBase64, 'base64').toString('utf8')
    if (workerStdout !== 'public->worker') fail(`worker did not see public write: ${JSON.stringify(workerStdout)}`)

    const envProbe = await jsonFetch(`${workerBaseUrl}/internal/workspaces/${workspaceId}/exec`, {
      method: 'POST',
      headers: workerHeaders,
      body: JSON.stringify({
        cmd: 'test -z "$BORING_WORKER_INTERNAL_TOKEN" && test -z "$DATABASE_URL" && test -z "$REMOTE_WORKER_SMOKE_PROCESS_SECRET" && echo env-ok',
        env: {
          DATABASE_URL: 'postgres://must-not-leak',
          BORING_WORKER_INTERNAL_TOKEN: 'must-not-leak',
          REMOTE_WORKER_SMOKE_PROCESS_SECRET: 'must-not-leak',
        },
        timeoutMs: 10000,
      }),
    })
    const envStdout = Buffer.from(envProbe.stdoutBase64, 'base64').toString('utf8').trim()
    if (envProbe.exitCode !== 0 || envStdout !== 'env-ok') fail(`worker env leaked into bwrap: ${JSON.stringify(envProbe)}`)

    const limitProbe = await jsonFetch(`${workerBaseUrl}/internal/workspaces/${workspaceId}/exec`, {
      method: 'POST',
      headers: workerHeaders,
      body: JSON.stringify({
        cmd: 'printf "%s,%s,%s,%s,%s" "$(ulimit -t)" "$(ulimit -f)" "$(ulimit -u)" "$(ulimit -n)" "$(ulimit -v)"',
        timeoutMs: 10000,
      }),
    })
    const limitStdout = Buffer.from(limitProbe.stdoutBase64, 'base64').toString('utf8').trim()
    const expectedLimits = [
      expectedLimitValue('BORING_WORKER_EXEC_CPU_SECONDS', '30'),
      expectedFileSizeBlocks(),
      expectedLimitValue('BORING_WORKER_EXEC_MAX_PROCESSES', '512'),
      expectedLimitValue('BORING_WORKER_EXEC_OPEN_FILES', '256'),
      expectedVirtualMemoryKb(),
    ].join(',')
    if (limitProbe.exitCode !== 0 || limitStdout !== expectedLimits) {
      fail(`worker resource limits not applied: expected ${expectedLimits}, got ${limitStdout}`)
    }

    await jsonFetch(`${workerBaseUrl}/internal/workspaces/${workspaceId}/exec`, {
      method: 'POST',
      headers: workerHeaders,
      body: JSON.stringify({ cmd: "printf 'worker->public' > from-worker.txt", timeoutMs: 10000 }),
    })

    const readBack = await jsonFetch(`${publicBaseUrl}/api/v1/files?path=from-worker.txt`)
    if (readBack.content !== 'worker->public') fail(`public did not see worker write: ${JSON.stringify(readBack)}`)

    const tree = await jsonFetch(`${publicBaseUrl}/api/v1/tree?path=.&recursive=true`)
    const treePaths = tree.entries.map((entry) => entry.path)
    if (!treePaths.includes('from-public.txt') || !treePaths.includes('from-worker.txt')) {
      fail(`tree missing files: ${JSON.stringify(treePaths)}`)
    }

    const search = await jsonFetch(`${publicBaseUrl}/api/v1/files/search?q=from-*.txt&limit=10`)
    if (!search.results.includes('from-public.txt') || !search.results.includes('from-worker.txt')) {
      fail(`search missing files: ${JSON.stringify(search)}`)
    }

    const git = await jsonFetch(`${publicBaseUrl}/api/v1/git/file-url?path=from-public.txt`)
    if (git.enabled !== false) fail(`git file-url should be disabled in remote-worker mode: ${JSON.stringify(git)}`)

    await runFsEventsSmoke(workerBaseUrl, workerHeaders)
    log('remote_worker_smoke.ok', { workerBaseUrl, publicBaseUrl })
  } finally {
    await publicApp.close().catch(() => {})
    await workerApp.close().catch(() => {})
    if (!process.env.REMOTE_WORKER_SMOKE_KEEP_WORKSPACE) {
      const cleanupTarget = ownsWorkspaceRoot ? workspaceRoot : join(workspaceRoot, workspaceId)
      await rm(cleanupTarget, { recursive: true, force: true }).catch(() => {})
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    event: 'remote_worker_smoke.failed',
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
