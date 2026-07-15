import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'

import { createD1ActiveCollectionReader } from '../src/server/deployment/activeCollectionReader.js'
import { captureD1CoreProofRevision, verifyD1CoreProof } from '../src/server/deployment/d1CoreProof.js'
import { captureD1DrFingerprint, createD1DrRowsReader } from '../src/server/deployment/d1DrProof.js'
import { D1HostErrorCode, strictD1HostId } from '../src/server/deployment/d1Plan.js'

const MAX_BYTES = 4 * 1024 * 1024
const LIVE_TIMEOUT_MS = 30 * 60 * 1000
const CLEANUP_GRACE_MS = 5 * 60 * 1000
const CLEANUP_COMMAND_TIMEOUT_MS = 30_000
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function failure(): never {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: D1HostErrorCode.PROOF_INVALID, details: { field: 'proof' } } })}\n`)
  process.exit(4)
}
function absolute(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value) || resolve(value) !== value) failure()
  return value
}
function hostConfig() {
  const hostId = strictD1HostId(process.env.BORING_D1_HOST_ID, 'hostId')
  const ownerUid = Number(process.env.BORING_D1_OWNER_UID)
  if (!Number.isSafeInteger(ownerUid) || ownerUid < 0) failure()
  const stateRoot = absolute(process.env.BORING_D1_PROOF_STATE_ROOT ?? '/var/lib/boring/d1')
  const hostRoot = resolve(stateRoot, hostId)
  return { hostId, ownerUid, hostRoot, reader: createD1ActiveCollectionReader({ hostRoot, hostId, ownerUid, appGid: 10001 }) }
}
async function readBounded(): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const value of process.stdin) {
    const chunk = value as Uint8Array
    size += chunk.byteLength
    if (size > MAX_BYTES) failure()
    chunks.push(chunk)
  }
  if (size === 0) failure()
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    failure()
  }
}
async function cleanupCommand(args: readonly string[]): Promise<Readonly<{ status: number | null; failed: boolean }>> {
  return new Promise((accept) => {
    const cleanup = spawn(process.env.BORING_DOCKER_BINARY ?? 'docker', args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: 'ignore',
    })
    let settled = false
    const finish = (result: Readonly<{ status: number | null; failed: boolean }>) => { if (!settled) { settled = true; clearTimeout(timeout); accept(result) } }
    const timeout = setTimeout(() => { cleanup.kill('SIGKILL'); finish({ status: null, failed: true }) }, CLEANUP_COMMAND_TIMEOUT_MS)
    cleanup.once('error', () => finish({ status: null, failed: true }))
    cleanup.once('close', (status) => finish({ status, failed: false }))
  })
}
async function cleanupIsolationResources(pid: number, workRoot: string): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return true
  const containers = [`d1-006rq-a-${pid}`, `d1-006rq-b-${pid}`]
  const networks = [`d1-006rq-neta-${pid}`, `d1-006rq-netb-${pid}`]
  const image = `boring-d1-006rq:${pid.toString(36)}`
  // The harness is synchronous, so it cannot dispatch its own signal handler
  // while a host command is blocked. After escalation, the parent removes the
  // deterministic daemon resources in dependency order; a second pass closes
  // races with a command that was still unwinding when SIGKILL arrived.
  for (let attempt = 0; attempt < 2; attempt++) {
    await Promise.all(containers.map((name) => cleanupCommand(['rm', '-f', name])))
    await Promise.all([
      ...networks.map((name) => cleanupCommand(['network', 'rm', '-f', name])),
      cleanupCommand(['image', 'rm', '-f', image]),
    ])
  }
  const inspections = await Promise.all([
    ...containers.map((name) => cleanupCommand(['inspect', name])),
    ...networks.map((name) => cleanupCommand(['network', 'inspect', name])),
    cleanupCommand(['image', 'inspect', image]),
  ])
  let incomplete = inspections.some((result) => result.failed || result.status === 0)
  await rm(workRoot, { recursive: true, force: true }).catch(() => { incomplete = true })
  return incomplete
}
async function liveIsolation(): Promise<unknown> {
  const harness = resolve(repoRoot, 'packages/boring-sandbox/scripts/qualify-docker-runsc-isolation.mjs')
  const workRoot = join(tmpdir(), `boring-d1-006rq-supervised-proof-${process.pid}`)
  const child = spawn(process.execPath, [harness, '--d1-isolation-worker'], {
    cwd: repoRoot,
    env: { ...process.env, BORING_D1_006_WORK_ROOT: workRoot },
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const chunks: Uint8Array[] = []
  let size = 0
  let stopped = false
  let escalation: ReturnType<typeof setTimeout> | undefined
  let forcedCleanup: Promise<boolean> | undefined
  let forceSettle: (() => void) | undefined
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return
    try { process.kill(-child.pid, signal) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') stopped = true
    }
  }
  const forceStop = () => {
    if (forcedCleanup) return
    if (escalation) clearTimeout(escalation)
    signalGroup('SIGKILL')
    forcedCleanup = child.pid ? cleanupIsolationResources(child.pid, workRoot) : Promise.resolve(true)
    void forcedCleanup.finally(() => forceSettle?.())
  }
  const stop = () => {
    if (stopped) { forceStop(); return }
    stopped = true
    signalGroup('SIGTERM')
    escalation = setTimeout(forceStop, CLEANUP_GRACE_MS)
  }
  const interrupted = () => stop()
  process.on('SIGINT', interrupted)
  process.on('SIGTERM', interrupted)
  const timeout = setTimeout(stop, LIVE_TIMEOUT_MS)
  child.stdout.on('data', (chunk: Uint8Array) => {
    size += chunk.byteLength
    if (size > MAX_BYTES) stop()
    else chunks.push(chunk)
  })
  const code = await new Promise<number | null>((accept, reject) => {
    forceSettle = () => accept(null)
    child.once('error', reject)
    child.once('close', accept)
  }).catch(() => null)
  if (stopped && child.pid && !forcedCleanup) forcedCleanup = cleanupIsolationResources(child.pid, workRoot)
  if (forcedCleanup) await forcedCleanup
  process.removeListener('SIGINT', interrupted)
  process.removeListener('SIGTERM', interrupted)
  clearTimeout(timeout)
  if (escalation) clearTimeout(escalation)
  if (code !== 0 || stopped || size === 0) failure()
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    failure()
  }
}

try {
  if (process.argv.length !== 3) failure()
  if (process.argv[2] === 'capture') {
    const snapshot = await captureD1CoreProofRevision(hostConfig().reader)
    process.stdout.write(`${JSON.stringify({ ok: true, snapshot })}\n`)
  } else if (process.argv[2] === 'capture-dr') {
    const config = hostConfig()
    const workspaceRoot = absolute(process.env.BORING_AGENT_WORKSPACE_ROOT)
    const sessionRoot = absolute(process.env.BORING_AGENT_SESSION_ROOT)
    const databaseUrl = process.env.BORING_D1_PROOF_DATABASE_URL
    if (typeof databaseUrl !== 'string' || databaseUrl.length === 0 || databaseUrl.length > 4096 || databaseUrl.includes('\0')) failure()
    const sql = postgres(databaseUrl, { max: 1, prepare: false })
    const dr = await captureD1DrFingerprint({
      reader: config.reader, revisionReader: config.reader, hostId: config.hostId, hostRoot: config.hostRoot, workspaceRoot, sessionRoot,
      readRows: createD1DrRowsReader(sql),
    }).finally(() => sql.end({ timeout: 5 }))
    process.stdout.write(`${JSON.stringify({ ok: true, dr })}\n`)
  } else if (process.argv[2] === 'verify-live') {
    const proof = await readBounded()
    const report = await verifyD1CoreProof(proof, await liveIsolation())
    process.stdout.write(`${JSON.stringify({ ok: true, report })}\n`)
  } else failure()
} catch {
  failure()
}
