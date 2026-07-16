import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, link, mkdir, mkdtemp, open, readFile, symlink, writeFile, type FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import type postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'

import { mintAttestedAgentHostDatabaseConnection, type AgentHostAdmissionLedger } from '../admissionLedger.js'
import { AGENT_HOST_V1_COLLECTION_LIMITS } from '../bootCollection.js'
import { createProductionAgentHostDependencies, runAgentHostCommandEntry, type AgentHostEntryContext } from '../agentHostCommandEntry.js'
import { isSupportedLocalAgentHostLockFilesystem } from '../agentHostCommandLockPolicy.js'
import { AgentHostErrorCode } from '../agentHostPlan.js'
import { resolveAgentHostEntryInvocation, runAgentHostRevisionWrapper, type AgentHostEntryInvocation } from '../agentHostCommandWrapper.js'
import * as journals from '../destructivePublicationJournal.js'
import * as publications from '../fencedDestructivePublication.js'
import * as revisions from '../hostRevisionStore.js'

const UID = process.geteuid!()
const DIGEST = `sha256:${'a'.repeat(64)}`
const LIMITS = { maxBindings: 20, maxBundleBytes: 1_000_000, maxTotalBundleBytes: 10_000_000, maxConcurrentPreloads: 4 }
const SUCCESS = `${JSON.stringify({ ok: true, result: { kind: 'APPLY', action: 'NOOP', activeRevision: null, desiredStateDigest: DIGEST, removals: [] } })}\n`
const SOURCE_ENTRY: AgentHostEntryInvocation = {
  command: process.execPath,
  args: ['--import', 'tsx', path.resolve('src/server/deployment/agentHostCommandEntry.ts')],
}

interface Roots { base: string; lockRoot: string; stateRoot: string; env: NodeJS.ProcessEnv }
async function roots(hosts: readonly string[] = ['host-1']): Promise<Roots> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-cli-'))
  const lockRoot = path.join(base, 'locks'); const stateRoot = path.join(base, 'state')
  await mkdir(lockRoot, { mode: 0o700 }); await chmod(lockRoot, 0o700)
  for (const host of hosts) { const file = path.join(lockRoot, `${host}.lock`); await writeFile(file, ''); await chmod(file, 0o600) }
  return { base, lockRoot, stateRoot, env: { ...process.env, BORING_AGENT_HOST_OWNER_UID: String(UID), BORING_AGENT_HOST_STATE_ROOT: stateRoot, BORING_AGENT_HOST_LOCK_ROOT: lockRoot } }
}
function minimal(kind: 'plan' | 'apply' = 'apply', hostId = 'host-1'): Buffer {
  return Buffer.from(JSON.stringify({ kind, plan: { hostId } }))
}
function validApply(hostId = 'host-1'): Buffer {
  return Buffer.from(JSON.stringify({
    kind: 'apply', plan: {
      schemaVersion: 1, hostId, expectedHostRevision: null, hostAppImageDigest: DIGEST,
      runtimeProfileRef: 'runsc-eu', databaseRef: 'postgres-eu', workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots',
      bindings: [{
        bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance', defaultDeploymentId: 'deployment:insurance',
        bundleRef: 'bundle', deploymentRef: 'deployment', workspaceAllocationRef: 'insurance-workspace', sessionAllocationRef: 'insurance-session',
        ownerPrincipalRef: 'owner', landing: { title: 'Insurance', summary: 'Summary.' }, environmentRef: 'production', secretRefs: ['credential-ref'],
      }],
    },
  }))
}
function childScript(line = SUCCESS, delayMs = 0, setup = ''): AgentHostEntryInvocation {
  const script = `${setup};process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>process.stdout.write(${JSON.stringify(line)}),${delayMs}))`
  return { command: process.execPath, args: ['-e', script, '--'] }
}
async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) { try { await access(file); return } catch { await new Promise((resolve) => setTimeout(resolve, 20)) } }
  throw new Error('marker timeout')
}
function externallyLocked(file: string): boolean {
  return spawnSync('flock', ['--exclusive', '--nonblock', file, 'true'], { stdio: 'ignore' }).status !== 0
}
async function collect(child: ChildProcess): Promise<{ code: number | null; stdout: string }> {
  let stdout = ''; child.stdout!.setEncoding('utf8'); child.stdout!.on('data', (chunk: string) => { stdout += chunk })
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  return { code, stdout }
}
async function directEntry(h: Roots, marker: string, handle?: FileHandle): Promise<{ code: number | null; stdout: string }> {
  const entryUrl = pathToFileURL(path.resolve('src/server/deployment/agentHostCommandEntry.ts')).href
  const source = `import {runAgentHostCommandEntry} from ${JSON.stringify(entryUrl)};import fs from 'node:fs';const out=await runAgentHostCommandEntry({mode:'--locked',collectionLimits:${JSON.stringify(LIMITS)},dependencyFactory:()=>{fs.writeFileSync(${JSON.stringify(marker)},'called');throw new Error('factory')}});process.stdout.write(out.line);process.exitCode=out.exitCode`
  const stdio: Array<'pipe' | number> = handle ? ['pipe', 'pipe', 'pipe', handle.fd] : ['pipe', 'pipe', 'pipe']
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, '--'], { env: h.env, stdio })
  await handle?.close(); child.stdin!.end(validApply())
  return collect(child)
}
async function waitForGone(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`pid ${pid} survived`)
}

describe('AgentHost revision command boundary', () => {
  it('allows only the explicit production and CI local filesystem set', () => {
    for (const type of [0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630]) expect(isSupportedLocalAgentHostLockFilesystem(type)).toBe(true)
    for (const type of [0x6969, 0xff534d42, 0xfe534d42, 0x65735546, 0x517b, 0x00c36400]) expect(isSupportedLocalAgentHostLockFilesystem(type)).toBe(false)
  })

  it('selects the source or built sibling from the wrapper location only and fails when it is missing', async () => {
    const source = resolveAgentHostEntryInvocation(pathToFileURL(path.resolve('src/server/deployment/agentHostCommandWrapper.ts')).href)
    expect(source.args.at(-1)).toBe(path.resolve('src/server/deployment/agentHostCommandEntry.ts'))
    const built = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-built-entry-')); const builtWrapper = path.join(built, 'agentHostCommandWrapper.js')
    await writeFile(builtWrapper, ''); await writeFile(path.join(built, 'agentHostCommandEntry.js'), '')
    expect(resolveAgentHostEntryInvocation(pathToFileURL(builtWrapper).href).args.at(-1)).toBe(path.join(built, 'agentHostCommandEntry.js'))
    const fake = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-entry-')); const wrapper = path.join(fake, 'agentHostCommandWrapper.js')
    await writeFile(wrapper, '')
    expect(() => resolveAgentHostEntryInvocation(pathToFileURL(wrapper).href)).toThrowError(expect.objectContaining({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'entry' } }))
  })

  it('rejects malformed, trailing, oversized, and traversal input before an entry runs', async () => {
    const h = await roots(); const marker = path.join(h.base, 'ran'); const entry = childScript(SUCCESS, 0, `require('fs').writeFileSync(${JSON.stringify(marker)},'yes')`)
    const longRollback = Buffer.from(JSON.stringify({ kind: 'rollback', hostId: 'a'.repeat(251), expectedHostRevision: null, targetRevision: 'r0000000001' }))
    for (const input of [Buffer.from(''), Buffer.from('{}{}'), Buffer.alloc(1024 * 1024 + 1), minimal('apply', '../escape'), minimal('apply', 'a'.repeat(251)), longRollback]) {
      const result = await runAgentHostRevisionWrapper({ stdin: Readable.from([input]), env: h.env, entry })
      expect(result.exitCode).toBe(2); expect(result.line).toContain(AgentHostErrorCode.PLAN_INVALID)
    }
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('admits a maximum-length host id at the lock boundary', async () => {
    const hostId = 'a'.repeat(250); const h = await roots([hostId])
    const result = await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal('apply', hostId)]), env: h.env, entry: childScript() })
    expect(result.exitCode).toBe(0)
  })

  it('rejects missing, symlinked, hard-linked, wrong-mode, and wrong-owner lock configuration', async () => {
    const missing = await roots([])
    expect((await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: missing.env, entry: childScript() })).exitCode).toBe(2)
    const wrongMode = await roots(); await chmod(path.join(wrongMode.lockRoot, 'host-1.lock'), 0o644)
    expect((await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: wrongMode.env, entry: childScript() })).exitCode).toBe(2)
    const hard = await roots(); await link(path.join(hard.lockRoot, 'host-1.lock'), path.join(hard.lockRoot, 'alias'))
    expect((await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: hard.env, entry: childScript() })).exitCode).toBe(2)
    const linked = await roots(); const alias = path.join(linked.base, 'locks-link'); await symlink(linked.lockRoot, alias)
    expect((await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: { ...linked.env, BORING_AGENT_HOST_LOCK_ROOT: alias }, entry: childScript() })).exitCode).toBe(2)
    const owner = await roots()
    expect((await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: { ...owner.env, BORING_AGENT_HOST_OWNER_UID: String(UID + 1) }, entry: childScript() })).exitCode).toBe(2)
  })

  it('holds one host lock across FD3 close, rejects a contender, and does not serialize other hosts', async () => {
    const h = await roots(['host-1', 'host-2']); const marker = path.join(h.base, 'closed-fd3')
    const first = runAgentHostRevisionWrapper({
      stdin: Readable.from([minimal()]), env: h.env,
      entry: childScript(SUCCESS, 300, `require('fs').closeSync(3);require('fs').writeFileSync(${JSON.stringify(marker)},'yes')`),
    })
    await waitForFile(marker)
    expect(externallyLocked(path.join(h.lockRoot, 'host-1.lock'))).toBe(true)
    const contender = await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: h.env, entry: childScript() })
    expect(contender).toEqual(expect.objectContaining({ exitCode: 3 })); expect(contender.line).toContain(AgentHostErrorCode.REVISION_CONFLICT)
    const other = await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal('apply', 'host-2')]), env: h.env, entry: childScript() })
    expect(other.exitCode).toBe(0); expect((await first).exitCode).toBe(0)
    expect(externallyLocked(path.join(h.lockRoot, 'host-1.lock'))).toBe(false)
  })

  it('uses the real entry lock proof and fails closed without a publication ledger before creating revision state', async () => {
    const h = await roots(); const output = await runAgentHostRevisionWrapper({ stdin: Readable.from([validApply()]), env: h.env, entry: SOURCE_ENTRY })
    expect(output.exitCode).toBe(4)
    expect(JSON.parse(output.line)).toEqual({ ok: false, error: { code: AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, details: { field: 'rollbackJournal' } } })
    await expect(access(h.stateRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not construct dependencies for a missing direct FD3', async () => {
    const h = await roots(); const factory = vi.fn()
    const keys = ['BORING_AGENT_HOST_OWNER_UID', 'BORING_AGENT_HOST_STATE_ROOT', 'BORING_AGENT_HOST_LOCK_ROOT'] as const
    const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    for (const key of keys) process.env[key] = h.env[key]
    try {
      const output = await runAgentHostCommandEntry({ stdin: Readable.from([validApply()]), mode: '--locked', collectionLimits: LIMITS, dependencyFactory: factory })
      expect(output.exitCode).toBe(2); expect(factory).not.toHaveBeenCalled()
    } finally { for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key] }
  })

  it('passes the parsed host identity into dependency construction', async () => {
    const h = await roots(); const keys = ['BORING_AGENT_HOST_OWNER_UID', 'BORING_AGENT_HOST_STATE_ROOT', 'BORING_AGENT_HOST_LOCK_ROOT'] as const
    const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]])); let context: AgentHostEntryContext | undefined
    for (const key of keys) process.env[key] = h.env[key]
    const command = JSON.parse(validApply('host-2').toString()) as { kind: string }; command.kind = 'plan'
    try {
      const output = await runAgentHostCommandEntry({ stdin: Readable.from([JSON.stringify(command)]), mode: '--read-only', dependencyFactory: (value) => {
        context = value; throw new Error('stop after dependency construction')
      } })
      expect(output).toMatchObject({ exitCode: 70 }); expect(context).toMatchObject({ hostId: 'host-2', collectionLimits: AGENT_HOST_V1_COLLECTION_LIMITS })
    } finally { for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key] }
  })

  it('constructs fenced publication only from an injected ledger and shares one revision store', () => {
    const revisionStore = {} as ReturnType<typeof revisions.createHostRevisionStore>
    const fencedPublication = { recoverPending: vi.fn(async () => {}), publish: vi.fn(async () => {}) }
    const createStore = vi.spyOn(revisions, 'createHostRevisionStore').mockReturnValue(revisionStore)
    const createJournal = vi.spyOn(journals, 'createAgentHostDestructivePublicationJournalStore').mockReturnValue({} as ReturnType<typeof journals.createAgentHostDestructivePublicationJournalStore>)
    const createPublication = vi.spyOn(publications, 'createAgentHostFencedDestructivePublication').mockReturnValue(fencedPublication)
    const context = { hostId: 'host-1', ownerUid: UID, stateRoot: '/agent-host-state', collectionLimits: LIMITS, mutationGuard: { assertHeld: vi.fn() } }
    try {
      const absent = createProductionAgentHostDependencies(context)
      expect(absent.store).toBe(revisionStore); expect(absent.fencedPublication).toBeUndefined()
      expect(createStore).toHaveBeenCalledOnce(); expect(createJournal).not.toHaveBeenCalled(); expect(createPublication).not.toHaveBeenCalled()

      createStore.mockClear()
      const admissionLedger = { databaseRef: 'postgres-eu' } as AgentHostAdmissionLedger
      const present = createProductionAgentHostDependencies({ ...context, admissionLedger })
      expect(present.store).toBe(revisionStore); expect(present.fencedPublication).toBe(fencedPublication); expect(createStore).toHaveBeenCalledOnce()
      expect(createPublication).toHaveBeenCalledWith({ admissionLedger, journalStore: expect.anything(), revisionStore,
        publicationControl: expect.objectContaining({ preload: expect.any(Function), recover: expect.any(Function) }) })
    } finally { createStore.mockRestore(); createJournal.mockRestore(); createPublication.mockRestore() }
  })

  it('uses and closes an injected attested database connection', async () => {
    const h = await roots(); const keys = ['BORING_AGENT_HOST_OWNER_UID', 'BORING_AGENT_HOST_STATE_ROOT', 'BORING_AGENT_HOST_LOCK_ROOT'] as const
    const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]])); const release = vi.fn(); const end = vi.fn(async () => {})
    const options = { debug: false as boolean | ((connectionId: number, query: string, parameters: unknown[], types: unknown[]) => void), onclose: undefined as undefined | ((connectionId: number) => void) }
    const reserved = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { const query = strings.join('$'); if (typeof options.debug === 'function') options.debug(7, query, values, []); return query.includes('::text AS token') ? [{ token: values[0] }] : [] }), { release }) as unknown as postgres.ReservedSql
    const reserve = vi.fn(async () => reserved); const sql = { reserve, end, options } as unknown as postgres.Sql
    const databaseConnection = mintAttestedAgentHostDatabaseConnection('postgres-eu', sql, { ownsClient: true })
    const command = JSON.parse(validApply().toString()) as { kind: string }; command.kind = 'plan'
    for (const key of keys) process.env[key] = h.env[key]
    try {
      const output = await runAgentHostCommandEntry({ stdin: Readable.from([JSON.stringify(command)]), mode: '--read-only', collectionLimits: LIMITS, databaseConnection })
      expect(output).toMatchObject({ exitCode: 4 }); expect(reserve).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce(); expect(end).toHaveBeenCalledOnce()
    } finally { for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key] }
  })

  it('rejects a wrong-file FD3 before dependency construction', async () => {
    const h = await roots(); const marker = path.join(h.base, 'factory-called'); const file = path.join(h.base, 'wrong.lock')
    await writeFile(file, ''); await chmod(file, 0o600)
    const result = await directEntry(h, marker, await open(file, constants.O_RDWR | constants.O_NOFOLLOW))
    expect(result.code).toBe(2); expect(result.stdout).toContain(AgentHostErrorCode.PLAN_INVALID)
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)

  it('rejects a canonical unlocked direct FD3 before dependency construction', async () => {
    const h = await roots(); const marker = path.join(h.base, 'factory-called'); const file = path.join(h.lockRoot, 'host-1.lock')
    const result = await directEntry(h, marker, await open(file, constants.O_RDWR | constants.O_NOFOLLOW))
    expect(result.code).toBe(2); expect(result.stdout).toContain(AgentHostErrorCode.PLAN_INVALID)
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(externallyLocked(file)).toBe(false)
  }, 15_000)

  it('rejects a separately opened FD3 when another OFD owns the canonical lock', async () => {
    const h = await roots(); const marker = path.join(h.base, 'factory-called'); const file = path.join(h.lockRoot, 'host-1.lock')
    const holder = spawn('flock', ['--exclusive', file, 'sleep', '30'], { stdio: 'ignore' })
    const deadline = Date.now() + 3_000
    while (!externallyLocked(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(externallyLocked(file)).toBe(true)
    const result = await directEntry(h, marker, await open(file, constants.O_RDWR | constants.O_NOFOLLOW))
    expect(result.code).toBe(3); expect(result.stdout).toContain(AgentHostErrorCode.REVISION_CONFLICT)
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    holder.kill('SIGTERM'); await new Promise<void>((resolve) => holder.once('close', () => resolve()))
  }, 15_000)

  it('rechecks same-OFD ownership when the mutation guard runs', async () => {
    const h = await roots(); const marker = path.join(h.base, 'guard-rejected')
    const entryUrl = pathToFileURL(path.resolve('src/server/deployment/agentHostCommandEntry.ts')).href
    const source = `import {runAgentHostCommandEntry} from ${JSON.stringify(entryUrl)};import fs from 'node:fs';const out=await runAgentHostCommandEntry({mode:'--locked',collectionLimits:${JSON.stringify(LIMITS)},dependencyFactory:ctx=>{fs.closeSync(3);if(fs.openSync(process.env.BORING_AGENT_HOST_LOCK_ROOT+'/host-1.lock','r+')!==3)throw new Error('fd');try{ctx.mutationGuard.assertHeld('host-1')}catch(error){fs.writeFileSync(${JSON.stringify(marker)},'rejected');throw error}fs.writeFileSync(${JSON.stringify(marker)},'accepted');throw new Error('guard')}});process.stdout.write(out.line);process.exitCode=out.exitCode`
    const output = await runAgentHostRevisionWrapper({
      stdin: Readable.from([validApply()]), env: h.env,
      entry: { command: process.execPath, args: ['--import', 'tsx', '--input-type=module', '-e', source, '--'] },
    })
    expect(output.exitCode).toBe(3); expect(await readFile(marker, 'utf8')).toBe('rejected')
  }, 15_000)

  it('accepts only the fixed child envelope and redacts malformed output and stderr', async () => {
    const h = await roots()
    for (const script of [
      childScript('{"ok":true,"result":{},"extra":"secret"}\n'),
      childScript(`${JSON.stringify({ ok: true, result: { kind: 'APPLY', action: 'CREATE', activeRevision: null, desiredStateDigest: DIGEST, removals: [] } })}\n`),
      childScript(`${JSON.stringify({ ok: true, result: { kind: 'PLAN', action: 'NOOP', activeRevision: null, desiredStateDigest: DIGEST, removals: [] } })}\n`),
      childScript(`${SUCCESS}${SUCCESS}`),
      { command: process.execPath, args: ['-e', `process.stdout.write('x'.repeat(${1024 * 1024 + 1})+'\\n')`, '--'] },
      childScript('not-json\n', 0, `process.stderr.write('/private/raw-secret')`),
    ]) {
      const output = await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: h.env, entry: script })
      expect(output).toEqual({ line: '{"ok":false,"error":{"code":"AGENT_HOST_PUBLICATION_FAILED","details":{"field":"command"}}}\n', exitCode: 70 })
      expect(output.line).not.toMatch(/private|raw-secret/)
    }
  }, 15_000)

  it('kills an orphaned process group on normal leader exit before releasing the lock', async () => {
    const h = await roots(); const pidFile = path.join(h.base, 'orphan-pid')
    const setup = `const c=require('child_process').spawn('sleep',['30'],{stdio:'inherit'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref()`
    const output = await runAgentHostRevisionWrapper({ stdin: Readable.from([minimal()]), env: h.env, entry: childScript(SUCCESS, 0, setup) })
    expect(output.exitCode).toBe(0); const pid = Number(await readFile(pidFile, 'utf8'))
    await waitForGone(pid)
    expect(externallyLocked(path.join(h.lockRoot, 'host-1.lock'))).toBe(false)
  })

  it('bounds signal shutdown, kills a SIGTERM-ignoring group, then releases the lock', async () => {
    const h = await roots(); const marker = path.join(h.base, 'signal-pids')
    const descendant = `process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`
    const entryCode = `process.on('SIGTERM',()=>{});const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,c.pid]));process.stdin.resume();setInterval(()=>{},1000)`
    const wrapperUrl = pathToFileURL(path.resolve('src/server/deployment/agentHostCommandWrapper.ts')).href
    const harness = `import {runAgentHostRevisionWrapper} from ${JSON.stringify(wrapperUrl)};const out=await runAgentHostRevisionWrapper({handleSignals:true,entry:{command:process.execPath,args:['-e',${JSON.stringify(entryCode)},'--']}});process.stdout.write(out.line);process.exitCode=out.exitCode`
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', harness, '--'], { env: h.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin!.end(minimal()); await waitForFile(marker)
    expect(externallyLocked(path.join(h.lockRoot, 'host-1.lock'))).toBe(true)
    child.kill('SIGTERM'); const result = await collect(child)
    expect(result).toEqual({ code: 143, stdout: '{"ok":false,"error":{"code":"AGENT_HOST_PUBLICATION_FAILED","details":{"field":"signal"}}}\n' })
    for (const pid of JSON.parse(await readFile(marker, 'utf8')) as number[]) await waitForGone(pid)
    expect(externallyLocked(path.join(h.lockRoot, 'host-1.lock'))).toBe(false)
  }, 15_000)

  it('reports a signal latched after leader exit while group cleanup is running', async () => {
    const h = await roots(); const marker = path.join(h.base, 'late-signal-pids')
    const descendant = `process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});process.send('ready');setInterval(()=>{},1000)`
    const entryCode = `let ended=false,ready=false;const done=()=>{if(ended&&ready)process.stdout.write(${JSON.stringify(SUCCESS)},()=>process.exit(0))};const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',()=>{ready=true;require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,c.pid]));done()});process.stdin.resume();process.stdin.on('end',()=>{ended=true;done()})`
    const wrapperUrl = pathToFileURL(path.resolve('src/server/deployment/agentHostCommandWrapper.ts')).href
    const harness = `import {runAgentHostRevisionWrapper} from ${JSON.stringify(wrapperUrl)};const out=await runAgentHostRevisionWrapper({handleSignals:true,entry:{command:process.execPath,args:['-e',${JSON.stringify(entryCode)},'--']}});process.stdout.write(out.line);process.exitCode=out.exitCode`
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', harness, '--'], { env: h.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin!.end(minimal()); await waitForFile(marker)
    const [leader, descendantPid] = JSON.parse(await readFile(marker, 'utf8')) as number[]
    await waitForGone(leader!); child.kill('SIGINT')
    const result = await collect(child)
    expect(result).toEqual({ code: 130, stdout: '{"ok":false,"error":{"code":"AGENT_HOST_PUBLICATION_FAILED","details":{"field":"signal"}}}\n' })
    await waitForGone(descendantPid!)
    expect(externallyLocked(path.join(h.lockRoot, 'host-1.lock'))).toBe(false)
  }, 15_000)

  it('keeps the host lock held by the entry after abrupt wrapper death', async () => {
    const h = await roots(); const marker = path.join(h.base, 'wrapper-death-entry')
    const entryCode = `require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.stdin.resume();setInterval(()=>{},1000)`
    const wrapperUrl = pathToFileURL(path.resolve('src/server/deployment/agentHostCommandWrapper.ts')).href
    const harness = `import {runAgentHostRevisionWrapper} from ${JSON.stringify(wrapperUrl)};const out=await runAgentHostRevisionWrapper({entry:{command:process.execPath,args:['-e',${JSON.stringify(entryCode)},'--']}});process.stdout.write(out.line);process.exitCode=out.exitCode`
    const wrapper = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', harness, '--'], { env: h.env, stdio: ['pipe', 'pipe', 'pipe'] })
    wrapper.stdin!.end(minimal()); await waitForFile(marker)
    const entryPid = Number(await readFile(marker, 'utf8')); const lockFile = path.join(h.lockRoot, 'host-1.lock')
    expect(externallyLocked(lockFile)).toBe(true)
    wrapper.kill('SIGKILL'); expect((await collect(wrapper)).code).toBeNull()
    expect(externallyLocked(lockFile)).toBe(true)
    process.kill(-entryPid, 'SIGKILL'); await waitForGone(entryPid)
    expect(externallyLocked(lockFile)).toBe(false)
  }, 15_000)

  it('source execution from a foreign cwd creates no path named 3', async () => {
    const h = await roots(); const cwd = path.join(h.base, 'foreign'); await mkdir(cwd, { mode: 0o700 })
    const wrapper = path.resolve('src/server/deployment/agentHostCommandWrapper.ts')
    const child = spawn(path.resolve('../../node_modules/.bin/tsx'), [wrapper], { cwd, env: h.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin!.end(validApply()); const result = await collect(child)
    expect(result.code).toBe(4); expect(result.stdout).toContain(AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED)
    await expect(access(path.join(cwd, '3'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)
})
