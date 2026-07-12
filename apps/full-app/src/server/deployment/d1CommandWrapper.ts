import { spawn, type ChildProcess } from 'node:child_process'
import { constants, lstatSync, type Stats } from 'node:fs'
import { lstat, open, realpath, statfs, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'

import { parseD1CliInput } from './d1CommandCliProtocol.js'
import { isSupportedLocalD1LockFilesystem } from './d1CommandLockPolicy.js'
import { d1Digest, D1HostError, D1HostErrorCode, strictD1Ref } from './d1Plan.js'

const MAX_BYTES = 1024 * 1024
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const
const KNOWN_CODES = new Set<string>(Object.values(D1HostErrorCode))

export interface D1EntryInvocation { readonly command: string; readonly args: readonly string[] }
export interface D1WrapperOptions {
  readonly stdin?: Readable
  readonly env?: NodeJS.ProcessEnv
  readonly entry?: D1EntryInvocation
  readonly handleSignals?: boolean
}
export interface D1CliOutput { readonly line: string; readonly exitCode: number }
class D1WrapperProtocolError extends Error {}

function failure(code: D1HostErrorCode, field: string, exitCode: number): D1CliOutput {
  return { line: `${JSON.stringify({ ok: false, error: { code, details: { field } } })}\n`, exitCode }
}
function invalid(field: string): never { throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field }) }
function absolute(value: string | undefined, field: string): string {
  if (!value || !path.isAbsolute(value) || path.resolve(value) !== value) invalid(field)
  return value
}
function ownerUid(value: string | undefined): number {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) invalid('ownerUid')
  const uid = Number(value)
  if (!Number.isSafeInteger(uid) || typeof process.geteuid !== 'function' || process.geteuid() !== uid) invalid('ownerUid')
  return uid
}
async function readBounded(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
    size += chunk.length
    if (size > MAX_BYTES) invalid('stdin')
    chunks.push(chunk)
  }
  if (size === 0) invalid('stdin')
  return Buffer.concat(chunks)
}
function sameFile(left: Stats, right: Stats, uid: number): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.uid === uid && right.uid === uid && (left.mode & 0o777) === 0o600 &&
    (right.mode & 0o777) === 0o600 && left.nlink === 1 && right.nlink === 1
}
async function openHostLock(root: string, hostId: string, uid: number): Promise<FileHandle> {
  let rootInfo: Stats
  try { rootInfo = await lstat(root) } catch { invalid('lockRoot') }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.uid !== uid || (rootInfo.mode & 0o777) !== 0o700 || await realpath(root) !== root) invalid('lockRoot')
  if (!isSupportedLocalD1LockFilesystem((await statfs(root)).type)) invalid('lockRoot')
  const lockPath = path.join(root, `${hostId}.lock`)
  let before: Stats
  try { before = await lstat(lockPath) } catch { invalid('hostLock') }
  if (before.isSymbolicLink()) invalid('hostLock')
  let handle: FileHandle
  try { handle = await open(lockPath, constants.O_RDWR | constants.O_NOFOLLOW) } catch { invalid('hostLock') }
  try {
    if (!sameFile(before, await handle.stat(), uid)) invalid('hostLock')
    return handle
  } catch (error) { await handle.close(); throw error }
}
async function acquireHostLock(handle: FileHandle): Promise<void> {
  const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'], {
    shell: false, stdio: ['ignore', 'ignore', 'ignore', handle.fd],
  })
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve)
  })
  if (code === 75) throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'hostLock' })
  if (code !== 0) invalid('hostLock')
}

export function resolveD1EntryInvocation(metaUrl = import.meta.url): D1EntryInvocation {
  const wrapper = fileURLToPath(metaUrl)
  const source = wrapper.endsWith('.ts')
  if (!source && !wrapper.endsWith('.js')) invalid('entry')
  const entry = path.join(path.dirname(wrapper), `d1CommandEntry.${source ? 'ts' : 'js'}`)
  let info: Stats
  try { info = lstatSync(entry) } catch { invalid('entry') }
  if (!info.isFile() || info.isSymbolicLink()) invalid('entry')
  return { command: process.execPath, args: [...process.execArgv, entry] }
}
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try { process.kill(-pid, signal); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}
function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}
async function waitForGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (groupAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  return !groupAlive(pid)
}
async function terminateGroup(pid: number): Promise<boolean> {
  if (!groupAlive(pid)) return true
  signalGroup(pid, 'SIGTERM')
  if (await waitForGroupExit(pid, 500)) return true
  signalGroup(pid, 'SIGKILL')
  return waitForGroupExit(pid, 2_000)
}
function capture(child: ChildProcess): { output: Promise<Buffer>; overflow: () => boolean } {
  const chunks: Buffer[] = []; let size = 0; let tooLarge = false
  const output = new Promise<Buffer>((resolve) => {
    child.stdout!.on('data', (value: Buffer) => {
      size += value.length
      if (size <= MAX_BYTES) chunks.push(value); else { tooLarge = true; if (child.pid) signalGroup(child.pid, 'SIGKILL') }
    })
    let stderrSize = 0
    child.stderr!.on('data', (value: Buffer) => { stderrSize += value.length; if (stderrSize > MAX_BYTES) { tooLarge = true; if (child.pid) signalGroup(child.pid, 'SIGKILL') } })
    child.stdout!.on('end', () => resolve(Buffer.concat(chunks)))
  })
  return { output, overflow: () => tooLarge }
}
function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
function parseChildOutput(bytes: Buffer, childCode: number | null, expectedKind: 'PLAN' | 'APPLY' | 'ROLLBACK'): D1CliOutput {
  const text = bytes.toString('utf8')
  if (!text.endsWith('\n') || text.slice(0, -1).includes('\n') || text.slice(0, -1).trim() !== text.slice(0, -1)) return failure(D1HostErrorCode.PUBLICATION_FAILED, 'command', 70)
  try {
    const value = JSON.parse(text) as unknown
    if (!exactRecord(value, ['ok', value && typeof value === 'object' && 'result' in value ? 'result' : 'error'])) throw new Error()
    if (value.ok === true && childCode === 0 && typeof value.result === 'object' && value.result !== null) {
      const resultKeys = ['kind', 'action', 'activeRevision', 'desiredStateDigest', 'removals', ...(Object.hasOwn(value.result, 'revisionId') ? ['revisionId'] : [])]
      if (!exactRecord(value.result, resultKeys)) throw new Error()
      const result = value.result
      if (result.kind !== expectedKind || !['NOOP', 'CREATE'].includes(result.action as string) ||
        (result.activeRevision !== null && (typeof result.activeRevision !== 'string' || !/^r\d{10}$/.test(result.activeRevision))) ||
        (Object.hasOwn(result, 'revisionId') && (typeof result.revisionId !== 'string' || !/^r\d{10}$/.test(result.revisionId))) || !Array.isArray(result.removals)) throw new Error()
      const hasRevision = Object.hasOwn(result, 'revisionId')
      if ((result.kind === 'PLAN' && hasRevision) || (result.action === 'NOOP' && hasRevision) ||
        (result.kind !== 'PLAN' && result.action === 'CREATE' && (!hasRevision || result.revisionId !== result.activeRevision))) throw new Error()
      const removals = result.removals.map((item, index) => strictD1Ref(item, `removals[${index}]`))
      if (new Set(removals).size !== removals.length || removals.some((item, index) => index > 0 && removals[index - 1]! > item)) throw new Error()
      const fixed = { kind: result.kind, action: result.action, activeRevision: result.activeRevision, ...(Object.hasOwn(result, 'revisionId') ? { revisionId: result.revisionId } : {}), desiredStateDigest: d1Digest(result.desiredStateDigest, 'desiredStateDigest'), removals }
      return { line: `${JSON.stringify({ ok: true, result: fixed })}\n`, exitCode: 0 }
    }
    if (value.ok !== false || !exactRecord(value.error, ['code', 'details']) || !exactRecord(value.error.details, ['field']) || typeof value.error.code !== 'string' || !KNOWN_CODES.has(value.error.code) || typeof value.error.details.field !== 'string' || !/^[A-Za-z0-9.[\]_-]{1,80}$/.test(value.error.details.field)) throw new Error()
    const field = value.error.details.field
    const code = value.error.code as D1HostErrorCode
    const exitCode = code === D1HostErrorCode.PLAN_INVALID ? 2 : code === D1HostErrorCode.REVISION_CONFLICT ? 3 : 4
    if (childCode !== exitCode) throw new Error()
    return failure(code, field, exitCode)
  } catch { return failure(D1HostErrorCode.PUBLICATION_FAILED, 'command', 70) }
}

export async function runD1RevisionWrapper(options: D1WrapperOptions = {}): Promise<D1CliOutput> {
  let lock: FileHandle | undefined; let child: ChildProcess | undefined; let signal: keyof typeof SIGNAL_EXIT | undefined
  let termination: Promise<boolean> | undefined
  const inputStream = options.stdin ?? process.stdin
  const handlers = new Map<NodeJS.Signals, () => void>(); let result: D1CliOutput
  if (options.handleSignals) for (const name of Object.keys(SIGNAL_EXIT) as Array<keyof typeof SIGNAL_EXIT>) {
    const handler = () => {
      signal ??= name
      if (child?.pid) {
        signalGroup(child.pid, name)
        termination ??= terminateGroup(child.pid).catch(() => false)
      } else inputStream.destroy()
    }
    handlers.set(name, handler); process.on(name, handler)
  }
  try {
    if (process.platform !== 'linux') invalid('platform')
    const env = options.env ?? process.env
    const uid = ownerUid(env.BORING_D1_OWNER_UID)
    absolute(env.BORING_D1_STATE_ROOT, 'stateRoot')
    const lockRoot = absolute(env.BORING_D1_LOCK_ROOT, 'lockRoot')
    const input = await readBounded(inputStream)
    const { identity } = parseD1CliInput(input)
    const entry = options.entry ?? resolveD1EntryInvocation()
    if (identity.kind !== 'plan') { lock = await openHostLock(lockRoot, identity.hostId, uid); await acquireHostLock(lock) }
    const args = [...entry.args, identity.kind === 'plan' ? '--read-only' : '--locked']
    let spawned: ChildProcess
    try {
      spawned = spawn(entry.command, args, {
        detached: true, env, shell: false, stdio: lock ? ['pipe', 'pipe', 'pipe', lock.fd] : ['pipe', 'pipe', 'pipe'],
      })
    } catch { throw new D1WrapperProtocolError() }
    child = spawned
    if (signal && spawned.pid) { signalGroup(spawned.pid, signal); termination ??= terminateGroup(spawned.pid).catch(() => false) }
    const captured = capture(spawned)
    spawned.stdin!.on('error', () => {})
    spawned.stdin!.end(input)
    const exited = await new Promise<{ code: number | null; spawnError: boolean }>((resolve) => {
      let settled = false
      spawned.once('error', () => { if (!settled) { settled = true; resolve({ code: null, spawnError: true }) } })
      spawned.once('exit', (code) => { if (!settled) { settled = true; resolve({ code, spawnError: false }) } })
    })
    if (spawned.pid) termination ??= terminateGroup(spawned.pid).catch(() => false)
    if (termination && !await termination) await new Promise<never>(() => { setInterval(() => void lock?.fd, 60_000) })
    const output = await captured.output
    if (signal) result = failure(D1HostErrorCode.PUBLICATION_FAILED, 'signal', SIGNAL_EXIT[signal])
    else if (exited.spawnError || captured.overflow()) result = failure(D1HostErrorCode.PUBLICATION_FAILED, 'command', 70)
    else result = parseChildOutput(output, exited.code, identity.kind.toUpperCase() as 'PLAN' | 'APPLY' | 'ROLLBACK')
  } catch (error) {
    result = signal ? failure(D1HostErrorCode.PUBLICATION_FAILED, 'signal', SIGNAL_EXIT[signal]) : error instanceof D1WrapperProtocolError
      ? failure(D1HostErrorCode.PUBLICATION_FAILED, 'command', 70) : error instanceof D1HostError
        ? failure(error.code, error.details.field ?? 'command', error.code === D1HostErrorCode.PLAN_INVALID ? 2 : error.code === D1HostErrorCode.REVISION_CONFLICT ? 3 : 4)
      : failure(D1HostErrorCode.PLAN_INVALID, 'command', 2)
  } finally {
    const dead = !child?.pid || await (termination ?? terminateGroup(child.pid).catch(() => false))
    if (!dead) await new Promise<never>(() => { setInterval(() => void lock?.fd, 60_000) })
    for (const [name, handler] of handlers) process.off(name, handler)
    await lock?.close()
  }
  if (signal) result = failure(D1HostErrorCode.PUBLICATION_FAILED, 'signal', SIGNAL_EXIT[signal])
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await runD1RevisionWrapper({ handleSignals: true })
  process.stdout.write(output.line); process.exitCode = output.exitCode
}
