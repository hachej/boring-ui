import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { createGatewayAcceptedWorkContext, projectAgentRequestRunId } from '../acceptedWork'
import { canonicalDigest, canonicalJson } from '../canonical'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { MIN_REQUEST_RETENTION_MS, SqliteAgentRequestLedger } from '../sqliteRequestLedger'
import { AGENT_GATEWAY_EFFECTS, type AgentRequestKey, type AgentRequestLedger } from '../types'

const require = createRequire(import.meta.url)

const claimWorkerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'requestLedgerClaimWorker.ts',
)

const key: AgentRequestKey = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
  operation: 'session.create',
  target: { kind: 'agent', agentTypeId: 'alpha' },
  requestId: 'request-a',
}

function acceptedFor(requestKey: AgentRequestKey) {
  const agentTypeId = requestKey.target.kind === 'agent' ? requestKey.target.agentTypeId : requestKey.target.ref.agentTypeId
  return createGatewayAcceptedWorkContext({ key: requestKey, admittedAgentTypeId: agentTypeId })
}

interface ParallelClaimResult {
  claim: Awaited<ReturnType<AgentRequestLedger['prepare']>>
  effectStarted: boolean
}

function owned(result: Awaited<ReturnType<AgentRequestLedger['prepare']>>) {
  if (result.ownership === 'existing') throw new Error('expected request claim ownership')
  return result
}

function runClaimWorker(
  workerPath: string,
  dbPath: string,
  barrier: SharedArrayBuffer,
): Promise<ParallelClaimResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { dbPath, key, digest: 'digest-a', barrier },
    })
    worker.once('message', (message: ParallelClaimResult & { error?: { message: string; stack?: string } }) => {
      if (message.error) {
        const error = new Error(message.error.message)
        error.stack = message.error.stack
        reject(error)
        return
      }
      resolve(message)
    })
    worker.once('error', (error) => {
      // Unblock the coordinator if module startup fails before this worker can
      // announce readiness; Promise.all then reports the original worker error.
      Atomics.add(new Int32Array(barrier), 0, 1)
      reject(error)
    })
  })
}

interface ProcessClaim {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  result: Promise<ParallelClaimResult>
}

function runProcessClaim(workerPath: string, input: Record<string, unknown>): ProcessClaim {
  const child = spawn(process.execPath, [workerPath], {
    env: { ...process.env, REQUEST_LEDGER_PROCESS_INPUT: JSON.stringify(input) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = ''
  let readyResolve!: () => void
  let resultResolve!: (result: ParallelClaimResult) => void
  let reject!: (error: Error) => void
  const ready = new Promise<void>((resolve, rejectReady) => { readyResolve = resolve; reject = rejectReady })
  const result = new Promise<ParallelClaimResult>((resolve, rejectResult) => {
    resultResolve = resolve
    const previous = reject
    reject = (error) => { previous(error); rejectResult(error) }
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n')
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (line === 'READY') readyResolve()
      else if (line) resultResolve(JSON.parse(line) as ParallelClaimResult)
    }
  })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (code && code !== 0) reject(new Error(`claim child exited ${code}: ${signal ?? ''}`))
  })
  return { child, ready, result }
}

async function runParallelClaims(dbPath: string): Promise<[ParallelClaimResult, ParallelClaimResult]> {
  // Bundle the fixture with the production ledger source because bare Node's
  // worker ESM resolver cannot load that source's extensionless TS imports.
  const workerBundlePath = join(tmpdir(), `request-ledger-claim-worker-${randomUUID()}.mjs`)
  await build({
    entryPoints: [claimWorkerPath],
    outfile: workerBundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  })

  try {
    // Slot 0 counts ready workers; slot 1 releases both from a deterministic barrier.
    const barrier = new SharedArrayBuffer(8)
    const sync = new Int32Array(barrier)
    const claims = [
      runClaimWorker(workerBundlePath, dbPath, barrier),
      runClaimWorker(workerBundlePath, dbPath, barrier),
    ] as const
    const deadline = Date.now() + 10_000
    while (Atomics.load(sync, 0) < 2) {
      if (Date.now() >= deadline) throw new Error(`only ${Atomics.load(sync, 0)}/2 claim workers reached the start barrier`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    Atomics.store(sync, 1, 1)
    Atomics.notify(sync, 1, 2)
    return await Promise.all(claims)
  } finally {
    rmSync(workerBundlePath, { force: true })
  }
}

describe('InMemoryAgentRequestLedger', () => {
  it('implements pending → accepted → in-flight → completed and acknowledgement replay', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const [first, retry] = await Promise.all([
      ledger.prepare(key, 'digest-a', acceptedFor(key)),
      ledger.prepare(key, 'digest-a', acceptedFor(key)),
    ])
    expect(first).toMatchObject({ ownership: 'created', record: { state: 'pending-admission' } })
    expect(retry).toMatchObject({ ownership: 'existing', record: first.record })
    const claim = owned(first)
    await ledger.acceptAdmission(key, claim.claimToken, 'admission-a')
    await ledger.beginEffect(key, claim.claimToken)
    await ledger.complete(key, claim.claimToken, { accepted: true })
    expect(await ledger.prepare(key, 'digest-a', acceptedFor(key))).toMatchObject({
      ownership: 'existing',
      record: { state: 'completed', receipt: { accepted: true } },
    })
    await expect(ledger.prepare(key, 'digest-b', acceptedFor(key))).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
  })

  it('retains stable strong rejection', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const claim = owned(await ledger.prepare(key, 'digest-a', acceptedFor(key)))
    expect((await ledger.read(key))?.state).toBe('pending-admission')
    await ledger.reject(key, claim.claimToken, {
      kind: 'gateway',
      error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'rejected' })
  })

  it('permits outcome-unknown only from in-flight', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const claim = owned(await ledger.prepare(key, 'digest-a', acceptedFor(key)))
    await expect(ledger.markOutcomeUnknown(key, claim.claimToken, {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      message: 'unknown',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    await ledger.acceptAdmission(key, claim.claimToken, 'admission-a')
    await ledger.beginEffect(key, claim.claimToken)
    await ledger.markOutcomeUnknown(key, claim.claimToken, {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      message: 'unknown',
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'outcome-unknown' })
  })
})

describe.each<{ name: string; create(): AgentRequestLedger }>([
  { name: 'in-memory', create: () => new InMemoryAgentRequestLedger() },
  { name: 'SQLite', create: () => new SqliteAgentRequestLedger(join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)) },
])('$name admission retry ownership', ({ create }) => {
  it('retains the digest and elects one retry owner before allowing admission', async () => {
    const ledger = create()
    try {
      const first = owned(await ledger.prepare(key, 'digest-a', acceptedFor(key)))
      await ledger.markAdmissionRetryable(key, first.claimToken)
      await expect(ledger.prepare(key, 'digest-b', acceptedFor(key))).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.acceptAdmission(key, first.claimToken, 'unclaimed')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      const claims = await Promise.all([ledger.prepare(key, 'digest-a', acceptedFor(key)), ledger.prepare(key, 'digest-a', acceptedFor(key))])
      expect(claims.map(({ ownership }) => ownership)).toEqual(['reclaimed', 'existing'])
      expect(claims[0]?.record).not.toHaveProperty('retryable')
      const retry = owned(claims[0]!)
      await ledger.acceptAdmission(key, retry.claimToken, 'admitted')
      await ledger.beginEffect(key, retry.claimToken)
      await ledger.complete(key, retry.claimToken, { accepted: true })
      await expect(ledger.prepare(key, 'digest-a', acceptedFor(key))).resolves.toMatchObject({
        ownership: 'existing', record: { state: 'completed', receipt: { accepted: true } },
      })
    } finally {
      await ledger.close?.()
    }
  })

  it('does not release accepted, in-flight, or unknown effects for another attempt', async () => {
    const ledger = create()
    try {
      const claim = owned(await ledger.prepare(key, 'digest-a', acceptedFor(key)))
      await ledger.acceptAdmission(key, claim.claimToken, 'admitted')
      await expect(ledger.markAdmissionRetryable(key, claim.claimToken)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.beginEffect(key, claim.claimToken)
      await expect(ledger.markAdmissionRetryable(key, claim.claimToken)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.markOutcomeUnknown(key, claim.claimToken, { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown' })
      await expect(ledger.markAdmissionRetryable(key, claim.claimToken)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.prepare(key, 'digest-a', acceptedFor(key))).resolves.toMatchObject({ ownership: 'existing', record: { state: 'outcome-unknown' } })
    } finally {
      await ledger.close?.()
    }
  })
})

describe.each<{ name: string; create(): AgentRequestLedger }>([
  { name: 'in-memory', create: () => new InMemoryAgentRequestLedger() },
  { name: 'SQLite', create: () => new SqliteAgentRequestLedger(join(tmpdir(), `accepted-work-${randomUUID()}.sqlite`)) },
])('$name accepted work conformance', ({ create }) => {
  it('accepts the exhaustive canonical operation schema and rejects invalid operations', async () => {
    const ledger = create()
    try {
      for (const [index, operation] of AGENT_GATEWAY_EFFECTS.entries()) {
        const target = operation === 'session.create' || operation === 'agent.reload'
          ? { kind: 'agent' as const, agentTypeId: 'alpha' }
          : { kind: 'session' as const, ref: { agentTypeId: 'alpha', sessionId: 'session-a' } }
        const operationKey = { ...key, operation, target, requestId: `effect-${index}` }
        await expect(ledger.prepare(operationKey, 'digest', acceptedFor(operationKey))).resolves.toMatchObject({ ownership: 'created' })
      }
      const invalidKey = { ...key, operation: 'session.send' as AgentRequestKey['operation'], target: { kind: 'session' as const, ref: { agentTypeId: 'alpha', sessionId: 'session-a' } } }
      const validSessionKey = { ...invalidKey, operation: 'session.prompt' as const }
      const invalid = structuredClone(acceptedFor(validSessionKey)) as any
      invalid.identity.requestKey.operation = 'session.send'
      invalid.operation = 'session.send'
      await expect(ledger.prepare(invalidKey, 'digest', invalid)).rejects.toThrow('invalid accepted work operation')
    } finally { await ledger.close?.() }
  })

  it('drops admission provenance from every post-admission state', async () => {
    const ledger = create()
    try {
      const make = (requestId: string): AgentRequestKey => ({ ...key, requestId })
      const start = async (requestKey: AgentRequestKey) => {
        const claim = owned(await ledger.prepare(requestKey, 'digest', acceptedFor(requestKey)))
        await ledger.acceptAdmission(requestKey, claim.claimToken, `bearer:${requestKey.requestId}`)
        await ledger.beginEffect(requestKey, claim.claimToken)
        expect(await ledger.read(requestKey)).not.toHaveProperty('admissionReceipt')
        return claim.claimToken
      }
      const completed = make('no-provenance-completed'); const completedToken = await start(completed); await ledger.complete(completed, completedToken, { ok: true })
      const rejected = make('no-provenance-rejected'); const rejectedToken = await start(rejected); await ledger.reject(rejected, rejectedToken, { kind: 'gateway', error: { code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT, message: 'failed' } })
      const unknown = make('no-provenance-unknown'); const unknownToken = await start(unknown); await ledger.markOutcomeUnknown(unknown, unknownToken, { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown' })
      for (const requestKey of [completed, rejected, unknown]) {
        const record = await ledger.read(requestKey)
        expect(record).not.toHaveProperty('admissionReceipt')
        expect(JSON.stringify(record)).not.toContain('bearer:')
      }
    } finally { await ledger.close?.() }
  })
  it('retains one frozen context through retries and every transition', async () => {
    const ledger = create()
    try {
      const context = createGatewayAcceptedWorkContext({ key, admittedAgentTypeId: 'alpha', seat: { seatId: 'seat-a' } })
      let claim = owned(await ledger.prepare(key, 'digest', context))
      const assertContext = async () => {
        const retained = (await ledger.read(key))!.acceptedWork
        expect(retained).toEqual(context)
        expect(Object.isFrozen(retained)).toBe(true)
        expect(Object.isFrozen(retained.identity.requestKey.target)).toBe(true)
        expect(() => { (retained.identity.agent as { agentTypeId: string }).agentTypeId = 'forged' }).toThrow()
      }
      await assertContext()
      await ledger.markAdmissionRetryable(key, claim.claimToken)
      claim = owned(await ledger.prepare(key, 'digest', context))
      await assertContext()
      await ledger.acceptAdmission(key, claim.claimToken, 'provenance-only')
      await assertContext()
      await ledger.beginEffect(key, claim.claimToken)
      await assertContext()
      await ledger.complete(key, claim.claimToken, { ok: true })
      await assertContext()
    } finally { await ledger.close?.() }
  })

  it('rejects forged context and collision-prone key-part substitutions', async () => {
    const ledger = create()
    try {
      const context = createGatewayAcceptedWorkContext({ key, admittedAgentTypeId: 'alpha' })
      const forged = structuredClone(context)
      ;(forged.identity as { runId: string }).runId = 'forged'
      await expect(ledger.prepare(key, 'digest', forged)).rejects.toThrow('invalid accepted work redundant projection')

      const left = { ...key, workspaceScopeId: 'a|b', authSubjectId: 'c' }
      const right = { ...key, workspaceScopeId: 'a', authSubjectId: 'b|c' }
      expect(projectAgentRequestRunId(left)).not.toBe(projectAgentRequestRunId(right))
      await ledger.prepare(left, 'left', createGatewayAcceptedWorkContext({ key: left, admittedAgentTypeId: 'alpha' }))
      await ledger.prepare(right, 'right', createGatewayAcceptedWorkContext({ key: right, admittedAgentTypeId: 'alpha' }))
      expect((await ledger.read(left))?.digest).toBe('left')
      expect((await ledger.read(right))?.digest).toBe('right')
    } finally { await ledger.close?.() }
  })

  it('keeps Agent identity independent of optional Seat participation', async () => {
    const ledger = create()
    try {
      const standalone = { ...key, requestId: 'standalone' }
      const seatA = { ...key, requestId: 'seat-a' }
      const seatB = { ...key, requestId: 'seat-b' }
      await ledger.prepare(standalone, 'a', createGatewayAcceptedWorkContext({ key: standalone, admittedAgentTypeId: 'alpha' }))
      await ledger.prepare(seatA, 'b', createGatewayAcceptedWorkContext({ key: seatA, admittedAgentTypeId: 'alpha', seat: { seatId: 'one' } }))
      await ledger.prepare(seatB, 'c', createGatewayAcceptedWorkContext({ key: seatB, admittedAgentTypeId: 'alpha', seat: { seatId: 'two' } }))
      expect((await ledger.read(standalone))?.acceptedWork.identity.participation).toBeUndefined()
      expect((await ledger.read(seatA))?.acceptedWork.identity).toMatchObject({ agent: { agentTypeId: 'alpha' }, participation: { seatId: 'one' } })
      expect((await ledger.read(seatB))?.acceptedWork.identity).toMatchObject({ agent: { agentTypeId: 'alpha' }, participation: { seatId: 'two' } })
    } finally { await ledger.close?.() }
  })
})

describe('SqliteAgentRequestLedger', () => {
  it('strictly rejects values that can collide with canonical JSON', () => {
    const sparse = new Array(1) as unknown as import('../../../shared/index').JsonValue
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 })
    const hidden = Object.defineProperty({}, 'value', { enumerable: false, value: 1 })
    const symbolProperty = { value: 1 } as Record<PropertyKey, unknown>; symbolProperty[Symbol('hidden')] = 2
    class Exotic { value = 1 }
    const exoticArray = Object.setPrototypeOf([1], Object.create(Array.prototype))
    const invalid = [
      sparse,
      new Date(0),
      new Exotic(),
      accessor,
      hidden,
      symbolProperty,
      exoticArray,
      { value: undefined },
      { value: () => undefined },
      { value: Symbol('value') },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: 1n },
      cyclic,
    ]
    for (const value of invalid) expect(() => canonicalJson(value as never)).toThrow(/canonical JSON rejects/)
    expect(canonicalJson(Object.assign(Object.create(null), { b: 2, a: 1 }))).toBe('{"a":1,"b":2}')
  })

  it('rejects Proxy objects before reflective inspection or property reads', () => {
    const target = { a: 1, hidden: 2 }
    let hiddenOwnKeysReads = 0
    let hiddenValueReads = 0
    const hidingKeys = new Proxy(target, {
      ownKeys() {
        hiddenOwnKeysReads += 1
        return ['a']
      },
      get(proxiedTarget, key, receiver) {
        hiddenValueReads += 1
        return Reflect.get(proxiedTarget, key, receiver)
      },
    })

    let unstableReads = 0
    const unstable = new Proxy({ value: 0 }, {
      get(proxiedTarget, key, receiver) {
        if (key === 'value') unstableReads += 1
        return key === 'value' ? unstableReads : Reflect.get(proxiedTarget, key, receiver)
      },
    })

    for (const value of [
      hidingKeys,
      unstable,
      [hidingKeys],
      { nested: hidingKeys },
      [unstable],
      { nested: unstable },
    ]) {
      expect(() => canonicalJson(value as never)).toThrow(/canonical JSON rejects Proxy objects/)
      expect(() => canonicalDigest(value as never)).toThrow(/canonical JSON rejects Proxy objects/)
    }

    expect(hiddenOwnKeysReads).toBe(0)
    expect(hiddenValueReads).toBe(0)
    expect(unstableReads).toBe(0)
    expect(canonicalDigest(target)).toBe(canonicalDigest({ a: 1, hidden: 2 }))
  })

  it('does not let root or nested Proxy objects collide with stable canonical digests', () => {
    const stable = { a: 1, nested: [{ value: 1 }] }
    const stableDigest = canonicalDigest(stable)
    const collidingShape = { a: 1, nested: [new Proxy({ value: 1 }, {})] }
    const rootProxy = new Proxy(stable, {})

    expect(stableDigest).toBe(canonicalDigest({ nested: [{ value: 1 }], a: 1 }))
    expect(() => canonicalDigest(rootProxy as never)).toThrow(/canonical JSON rejects Proxy objects/)
    expect(() => canonicalDigest(collidingShape as never)).toThrow(/canonical JSON rejects Proxy objects/)
  })

  it('stores immutable canonical gateway request material and rejects non-JSON numbers', async () => {
    const path = join(tmpdir(), `canonical-request-ledger-${randomUUID()}.sqlite`)
    const ledger = new SqliteAgentRequestLedger(path)
    try {
      const request = { z: [3, { b: true, a: 'secret' }], a: 1 }
      const digest = canonicalDigest(request)
      const created = await ledger.prepare(key, digest, acceptedFor(key), request)
      expect(created.record.queuedRequest).toEqual({ a: 1, z: [3, { a: 'secret', b: true }] })
      expect(Object.isFrozen(created.record.queuedRequest)).toBe(true)
      expect(canonicalJson(created.record.queuedRequest!)).toBe(canonicalJson(request))
      await expect(ledger.prepare(key, digest, acceptedFor(key), { a: 1, z: [3, { a: 'secret', b: true }] }))
        .resolves.toMatchObject({ ownership: 'existing' })
      const nanKey = { ...key, requestId: 'nan' }
      await expect(ledger.prepare(nanKey, 'digest', acceptedFor(nanKey), { value: Number.NaN } as any))
        .rejects.toThrow('non-finite')
    } finally {
      ledger.close()
    }
  })

  it('enforces one canonical RequestKey per derived RunId in the database', async () => {
    const path = join(tmpdir(), `duplicate-run-${randomUUID()}.sqlite`)
    const ledger = new SqliteAgentRequestLedger(path)
    await ledger.prepare(key, 'digest-a', acceptedFor(key))
    ledger.close()
    const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const database = new SqliteDatabaseSync(path)
    const duplicateKey = { ...key, requestId: 'different-storage-key' }
    const duplicateRecord = { key: duplicateKey, acceptedWork: acceptedFor(duplicateKey), digest: 'digest-b', state: 'pending-admission', updatedAt: 0 }
    expect(() => database.prepare(`
      INSERT INTO agent_request_ledger(request_key, run_id, digest, state, record_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('different-storage-key', projectAgentRequestRunId(key), 'digest-b', 'pending-admission', JSON.stringify(duplicateRecord), 0)).toThrow(/UNIQUE/)
    database.close()
  })

  it('rejects SQLite memory, temp, and URI filenames before opening', () => {
    for (const filename of [
      ':memory:',
      '',
      'file::memory:',
      'file:ledger?mode=memory',
      'file:ledger?mode=temp',
      'file:ledger.sqlite',
    ]) {
      expect(() => new SqliteAgentRequestLedger(filename), filename).toThrow('filesystem SQLite path')
    }
  })

  it('persists a filesystem database across close and reopen', async () => {
    const path = join(tmpdir(), `durable-reopen-${randomUUID()}.sqlite`)
    const first = new SqliteAgentRequestLedger(path)
    const claim = owned(await first.prepare(key, 'digest-a', acceptedFor(key)))
    await first.acceptAdmission(key, claim.claimToken, 'admitted')
    await first.beginEffect(key, claim.claimToken)
    await first.complete(key, claim.claimToken, { durable: true })
    first.close()
    const reopened = new SqliteAgentRequestLedger(path)
    await expect(reopened.read(key)).resolves.toMatchObject({ state: 'completed', receipt: { durable: true } })
    reopened.close()
  })

  it('requires fresh matching admission before reclaim after revocation or seat change', async () => {
    const path = join(tmpdir(), `fresh-readmission-${randomUUID()}.sqlite`)
    const first = new SqliteAgentRequestLedger(path)
    const seatA = createGatewayAcceptedWorkContext({ key, admittedAgentTypeId: 'alpha', seat: { seatId: 'seat-a' } })
    const firstClaim = owned(await first.prepare(key, 'digest-a', seatA))
    await first.markAdmissionRetryable(key, firstClaim.claimToken)
    first.close()
    const resumed = new SqliteAgentRequestLedger(path)
    try {
      const seatB = createGatewayAcceptedWorkContext({ key, admittedAgentTypeId: 'alpha', seat: { seatId: 'seat-b' } })
      await expect(resumed.prepare(key, 'digest-a', seatB)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(resumed.prepare(key, 'digest-a', seatA)).resolves.toMatchObject({ ownership: 'reclaimed' })
    } finally { resumed.close() }
  })

  it.each(['pending-admission', 'admission-accepted'] as const)(
    'reclaims expired %s as fresh pending admission and fences the stale continuation',
    async (state) => {
      const path = join(tmpdir(), `stale-continuation-${state}-${randomUUID()}.sqlite`)
      let now = 0
      const ledger = new SqliteAgentRequestLedger(path, { now: () => now, claimLeaseMs: 100 })
      const stale = owned(await ledger.prepare(key, 'digest-a', acceptedFor(key)))
      if (state === 'admission-accepted') await ledger.acceptAdmission(key, stale.claimToken, 'old-receipt')
      now = 101
      const replacement = owned(await ledger.prepare(key, 'digest-a', acceptedFor(key)))
      expect(replacement.claimToken).not.toBe(stale.claimToken)
      expect(replacement.record).toMatchObject({ state: 'pending-admission' })
      expect(replacement.record).not.toHaveProperty('admissionReceipt')
      await expect(ledger.heartbeat(key, stale.claimToken)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.reject(key, stale.claimToken, {
        kind: 'gateway', error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'stale' },
      })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.acceptAdmission(key, replacement.claimToken, 'fresh-receipt')
      await ledger.beginEffect(key, replacement.claimToken)
      await ledger.complete(key, replacement.claimToken, { winner: true })
      await expect(ledger.read(key)).resolves.toMatchObject({ state: 'completed', receipt: { winner: true } })
      ledger.close()
    },
  )

  it('leases claims to one handle, heartbeats them, and recovers expired in-flight work as outcome unknown', async () => {
    const path = join(tmpdir(), `lease-ledger-${randomUUID()}.sqlite`)
    let now = 0
    const owner = new SqliteAgentRequestLedger(path, { now: () => now, claimLeaseMs: 100 })
    const claim = owned(await owner.prepare(key, 'digest-a', acceptedFor(key)))
    await owner.acceptAdmission(key, claim.claimToken, 'admitted')
    await owner.beginEffect(key, claim.claimToken)
    const observer = new SqliteAgentRequestLedger(path, { now: () => now, claimLeaseMs: 100 })
    await expect(observer.read(key)).resolves.toMatchObject({ state: 'in-flight' })
    await expect(observer.complete(key, 'not-owner', { ok: true })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    now = 90
    await owner.heartbeat(key, claim.claimToken)
    now = 150
    await expect(observer.read(key)).resolves.toMatchObject({ state: 'in-flight' })
    now = 191
    await expect(observer.read(key)).resolves.toMatchObject({
      state: 'outcome-unknown', error: { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN },
    })
    owner.close(); observer.close()
  })

  it('makes terminal settlement digest-idempotent and alarms on a conflicting result', async () => {
    const ledger = new SqliteAgentRequestLedger(join(tmpdir(), `settlement-${randomUUID()}.sqlite`))
    const claim = owned(await ledger.prepare(key, 'digest-a', acceptedFor(key)))
    await ledger.acceptAdmission(key, claim.claimToken, 'admitted')
    await ledger.beginEffect(key, claim.claimToken)
    await ledger.complete(key, claim.claimToken, { b: 2, a: 1 })
    await expect(ledger.complete(key, claim.claimToken, { a: 1, b: 2 })).resolves.toBeUndefined()
    await expect(ledger.complete(key, claim.claimToken, { a: 2, b: 2 })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    ledger.close()
  })

  it('atomically claims across real child processes released by a coordinator barrier', async () => {
    const path = join(tmpdir(), `process-claim-${randomUUID()}.sqlite`)
    const bundle = join(tmpdir(), `request-ledger-process-${randomUUID()}.mjs`)
    const request = { operation: 'create' }
    const digest = canonicalDigest(request)
    await build({ entryPoints: [claimWorkerPath], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22' })
    const setup = new SqliteAgentRequestLedger(path)
    const setupClaim = owned(await setup.prepare(key, digest, acceptedFor(key), request))
    await setup.markAdmissionRetryable(key, setupClaim.claimToken)
    setup.close()
    try {
      const input = { dbPath: path, key, digest, request, claimLeaseMs: 2_000, mode: 'complete' }
      const left = runProcessClaim(bundle, input)
      const right = runProcessClaim(bundle, input)
      await Promise.all([left.ready, right.ready])
      left.child.stdin.write('go\n'); right.child.stdin.write('go\n')
      const results = await Promise.all([left.result, right.result])
      expect(results.filter(({ effectStarted }) => effectStarted)).toHaveLength(1)
      const inspect = new SqliteAgentRequestLedger(path)
      await expect(inspect.read(key)).resolves.toMatchObject({ state: 'completed' })
      inspect.close()
    } finally {
      rmSync(bundle, { force: true })
    }
  }, 20_000)

  it('recovers a SIGKILLed child claim only after lease expiry', async () => {
    const path = join(tmpdir(), `process-kill-${randomUUID()}.sqlite`)
    const bundle = join(tmpdir(), `request-ledger-process-${randomUUID()}.mjs`)
    const request = { operation: 'create-after-kill' }
    const digest = canonicalDigest(request)
    await build({ entryPoints: [claimWorkerPath], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22' })
    const child = runProcessClaim(bundle, { dbPath: path, key, digest, request, claimLeaseMs: 500, mode: 'hold' })
    try {
      await child.ready
      child.child.stdin.write('go\n')
      await expect(child.result).resolves.toMatchObject({ effectStarted: true })
      const observer = new SqliteAgentRequestLedger(path, { claimLeaseMs: 500 })
      await expect(observer.read(key)).resolves.toMatchObject({ state: 'in-flight' })
      child.child.kill('SIGKILL')
      await new Promise((resolve) => setTimeout(resolve, 550))
      await expect(observer.read(key)).resolves.toMatchObject({ state: 'outcome-unknown' })
      observer.close()
    } finally {
      if (!child.child.killed) child.child.kill('SIGKILL')
      rmSync(bundle, { force: true })
    }
  }, 20_000)

  it('migrates legacy active rows and raw-key tombstones for every canonical effect across reopen', async () => {
    const path = join(tmpdir(), `legacy-accepted-work-${randomUUID()}.sqlite`)
    const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const legacy = new SqliteDatabaseSync(path) as DatabaseSync
    legacy.exec(`
      CREATE TABLE agent_request_ledger (request_key TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL, record_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE agent_request_tombstones (request_key TEXT PRIMARY KEY, digest TEXT NOT NULL, key_json TEXT NOT NULL, pruned_at INTEGER NOT NULL);
    `)
    const keys = AGENT_GATEWAY_EFFECTS.map((operation, index): AgentRequestKey => ({
      ...key,
      operation,
      target: operation === 'session.create' || operation === 'agent.reload'
        ? { kind: 'agent', agentTypeId: 'alpha' }
        : { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: `session-${index}` } },
      requestId: `legacy-${operation}`,
    }))
    const storageKey = (requestKey: AgentRequestKey) => JSON.stringify([
      requestKey.workspaceScopeId, requestKey.authSubjectId, requestKey.operation, requestKey.target.kind,
      requestKey.target.kind === 'agent' ? requestKey.target.agentTypeId : [requestKey.target.ref.agentTypeId, requestKey.target.ref.sessionId],
      requestKey.requestId,
    ])
    for (const [index, requestKey] of keys.entries()) {
      const id = storageKey(requestKey)
      legacy.prepare('INSERT INTO agent_request_ledger VALUES (?, ?, ?, ?, ?)').run(
        id, `active-${index}`, 'pending-admission', JSON.stringify({ key: requestKey, digest: `active-${index}`, state: 'pending-admission', updatedAt: index }), index,
      )
      const tombstoneKey = { ...requestKey, requestId: `${requestKey.requestId}-tombstone` }
      legacy.prepare('INSERT INTO agent_request_tombstones VALUES (?, ?, ?, ?)').run(
        storageKey(tombstoneKey), `tombstone-${index}`, JSON.stringify(tombstoneKey), index,
      )
    }
    legacy.close()

    // Construction invokes the production migrateLegacyAcceptedWork path.
    new SqliteAgentRequestLedger(path).close()
    const reopened = new SqliteAgentRequestLedger(path)
    try {
      for (const [index, requestKey] of keys.entries()) {
        expect((await reopened.read(requestKey))?.acceptedWork).toEqual(acceptedFor(requestKey))
        const tombstoneKey = { ...requestKey, requestId: `${requestKey.requestId}-tombstone` }
        expect((await reopened.read(tombstoneKey))?.acceptedWork).toEqual(acceptedFor(tombstoneKey))
        expect((await reopened.read(tombstoneKey))?.digest).toBe(`tombstone-${index}`)
      }
    } finally {
      reopened.close()
      rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true })
    }
  })

  it('transactionally backfills and verifies legacy settlement digests for every terminal state', async () => {
    const path = join(tmpdir(), `legacy-settlements-${randomUUID()}.sqlite`)
    const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const legacy = new SqliteDatabaseSync(path)
    legacy.exec(`
      CREATE TABLE agent_request_ledger (request_key TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL, record_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE agent_request_tombstones (request_key TEXT PRIMARY KEY, digest TEXT NOT NULL, key_json TEXT NOT NULL, pruned_at INTEGER NOT NULL);
    `)
    const terminal = [
      { state: 'completed' as const, value: { ok: true }, field: 'receipt' as const },
      { state: 'rejected' as const, value: { kind: 'gateway', error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' } }, field: 'failure' as const },
      { state: 'outcome-unknown' as const, value: { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown' }, field: 'error' as const },
    ]
    const legacyKeys = terminal.map(({ state }, index): AgentRequestKey => ({ ...key, requestId: `legacy-${state}-${index}` }))
    const storageKey = (requestKey: AgentRequestKey) => JSON.stringify([
      requestKey.workspaceScopeId, requestKey.authSubjectId, requestKey.operation, requestKey.target.kind,
      requestKey.target.kind === 'agent' ? requestKey.target.agentTypeId : [requestKey.target.ref.agentTypeId, requestKey.target.ref.sessionId], requestKey.requestId,
    ])
    for (const [index, item] of terminal.entries()) {
      const requestKey = legacyKeys[index]!
      const record = { key: requestKey, digest: `digest-${item.state}`, state: item.state, [item.field]: item.value, updatedAt: 1 }
      legacy.prepare('INSERT INTO agent_request_ledger VALUES (?, ?, ?, ?, ?)')
        .run(storageKey(requestKey), record.digest, item.state, JSON.stringify(record), 1)
    }
    legacy.close()

    const migrated = new SqliteAgentRequestLedger(path)
    const inspect = new SqliteDatabaseSync(path)
    const rows = inspect.prepare('SELECT record_json, settlement_digest FROM agent_request_ledger ORDER BY state').all() as Array<{ record_json: string; settlement_digest: string }>
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.settlement_digest).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.parse(row.record_json)).toMatchObject({ settlementDigest: row.settlement_digest })
    }
    inspect.close()
    await expect(migrated.complete(legacyKeys[0]!, 'legacy-token', terminal[0]!.value as never)).resolves.toBeUndefined()
    await expect(migrated.reject(legacyKeys[1]!, 'legacy-token', terminal[1]!.value as never)).resolves.toBeUndefined()
    await expect(migrated.markOutcomeUnknown(legacyKeys[2]!, 'legacy-token', terminal[2]!.value as never)).resolves.toBeUndefined()
    await expect(migrated.complete(legacyKeys[0]!, 'legacy-token', { ok: false })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    await expect(migrated.reject(legacyKeys[1]!, 'legacy-token', {
      kind: 'gateway', error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'changed' },
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    await expect(migrated.markOutcomeUnknown(legacyKeys[2]!, 'legacy-token', {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'changed',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    migrated.close()

    new SqliteAgentRequestLedger(path).close()
    const corrupt = new SqliteDatabaseSync(path)
    corrupt.prepare('UPDATE agent_request_ledger SET settlement_digest = ? WHERE request_key = ?').run('conflicting-digest', storageKey(legacyKeys[0]!))
    corrupt.close()
    expect(() => new SqliteAgentRequestLedger(path)).toThrow('settlement digest mismatch')
  })

  it('atomically elects one retry owner across concurrent connections and starts only its effect', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const setup = new SqliteAgentRequestLedger(path)
    const setupClaim = owned(await setup.prepare(key, 'digest-a', acceptedFor(key)))
    await setup.markAdmissionRetryable(key, setupClaim.claimToken)
    setup.close()

    // Each worker owns a separate real node:sqlite connection to this WAL file.
    // Both workers block after opening until the coordinator releases one shared
    // barrier, so their synchronous prepare calls execute on different OS threads.
    const retried = await runParallelClaims(path)
    const reclaimed = retried.filter(({ claim }) => claim.ownership === 'reclaimed')
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0]?.effectStarted).toBe(true)
    const losers = retried.filter(({ claim }) => claim.ownership === 'existing')
    expect(losers).toHaveLength(1)
    expect(losers[0]?.claim.record.state).toMatch(/^(pending-admission|admission-accepted|in-flight|completed)$/)
    expect(losers[0]?.effectStarted).toBe(false)
    expect(retried.filter(({ effectStarted }) => effectStarted)).toHaveLength(1)

    const owner = new SqliteAgentRequestLedger(path)
    await expect(owner.read(key)).resolves.toMatchObject({ state: 'completed', receipt: { accepted: true } })
    owner.close()

    const reopened = new SqliteAgentRequestLedger(path)
    await expect(reopened.prepare(key, 'digest-a', acceptedFor(key))).resolves.toMatchObject({
      ownership: 'existing',
      record: { state: 'completed', receipt: { accepted: true } },
    })
    await expect(reopened.prepare(key, 'digest-b', acceptedFor(key))).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
    reopened.close()
  }, 20_000)

  it.each(['pending-admission', 'admission-accepted', 'in-flight', 'rejected', 'completed', 'outcome-unknown'] as const)(
    'preserves %s across reopen without implicit reclaim or reconciliation',
    async (state) => {
      const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
      const initial = new SqliteAgentRequestLedger(path)
      try {
        const claim = owned(await initial.prepare(key, 'digest-a', acceptedFor(key)))
        if (state === 'rejected') {
          await initial.reject(key, claim.claimToken, {
            kind: 'gateway',
            error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
          })
        } else if (state !== 'pending-admission') {
          await initial.acceptAdmission(key, claim.claimToken, 'admitted')
          if (state !== 'admission-accepted') await initial.beginEffect(key, claim.claimToken)
          if (state === 'completed') await initial.complete(key, claim.claimToken, { accepted: true })
          if (state === 'outcome-unknown') await initial.markOutcomeUnknown(key, claim.claimToken, {
            code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown',
          })
        }
      } finally {
        initial.close()
      }
      const reopened = new SqliteAgentRequestLedger(path)
      try {
        await expect(reopened.prepare(key, 'digest-a', acceptedFor(key))).resolves.toMatchObject({ ownership: 'existing', record: { state } })
        await expect(reopened.prepare(key, 'digest-b', acceptedFor(key))).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      } finally {
        reopened.close()
        rmSync(path, { force: true })
        rmSync(`${path}-wal`, { force: true })
        rmSync(`${path}-shm`, { force: true })
      }
    },
  )

  it('prunes only expired terminal payloads while preserving durable tombstones and unresolved ownership', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    let now = 0
    const ledger = new SqliteAgentRequestLedger(path, { retentionMs: 1, now: () => now })
    const keyed = (requestId: string): AgentRequestKey => ({ ...key, requestId })
    const states = [
      'pending-admission',
      'admission-accepted',
      'in-flight',
      'rejected',
      'completed',
      'outcome-unknown',
    ] as const

    for (const state of states) {
      const stateKey = keyed(state)
      const claim = owned(await ledger.prepare(stateKey, `digest-${state}`, acceptedFor(stateKey)))
      if (state === 'rejected') {
        await ledger.reject(stateKey, claim.claimToken, {
          kind: 'gateway',
          error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
        })
      } else if (state !== 'pending-admission') {
        await ledger.acceptAdmission(stateKey, claim.claimToken, 'admitted')
        if (state !== 'admission-accepted') await ledger.beginEffect(stateKey, claim.claimToken)
        if (state === 'completed') await ledger.complete(stateKey, claim.claimToken, { accepted: true })
        if (state === 'outcome-unknown') await ledger.markOutcomeUnknown(stateKey, claim.claimToken, {
          code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
          message: 'unknown',
        })
      }
    }

    const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const inspect = new SqliteDatabaseSync(path) as DatabaseSync
    const count = (table: string) => (inspect.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count

    now = MIN_REQUEST_RETENTION_MS
    await ledger.prepare(keyed('boundary-trigger'), 'digest-boundary', acceptedFor(keyed('boundary-trigger')))
    expect(count('agent_request_ledger')).toBe(7)
    expect(count('agent_request_tombstones')).toBe(0)

    now += 1
    await ledger.prepare(keyed('expired-trigger'), 'digest-expired', acceptedFor(keyed('expired-trigger')))
    expect(count('agent_request_ledger')).toBe(5)
    expect(count('agent_request_tombstones')).toBe(3)
    for (const state of ['pending-admission', 'admission-accepted'] as const) {
      await expect(ledger.prepare(keyed(state), `digest-${state}`, acceptedFor(keyed(state)))).resolves.toMatchObject({
        ownership: 'reclaimed', record: { state: 'pending-admission' },
      })
    }
    await expect(ledger.prepare(keyed('in-flight'), 'digest-in-flight', acceptedFor(keyed('in-flight')))).resolves.toMatchObject({
      ownership: 'existing', record: { state: 'outcome-unknown' },
    })
    await expect(ledger.prepare(keyed('completed'), 'digest-completed', acceptedFor(keyed('completed')))).resolves.toMatchObject({
      ownership: 'existing',
      record: {
        state: 'outcome-unknown',
        error: { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN },
      },
    })
    await expect(ledger.prepare(keyed('completed'), 'changed-digest', acceptedFor(keyed('completed')))).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
    inspect.close()
    ledger.close()

    const reopened = new SqliteAgentRequestLedger(path, { retentionMs: MIN_REQUEST_RETENTION_MS, now: () => now })
    await expect(reopened.prepare(keyed('completed'), 'digest-completed', acceptedFor(keyed('completed')))).resolves.toMatchObject({
      ownership: 'existing', record: { state: 'outcome-unknown' },
    })
    reopened.close()
    rmSync(path, { force: true })
    rmSync(`${path}-wal`, { force: true })
    rmSync(`${path}-shm`, { force: true })
  })

  it('prunes canonical queued payload secrets while retaining request and settlement idempotency digests', async () => {
    const path = join(tmpdir(), `sensitive-retention-${randomUUID()}.sqlite`)
    let now = 0
    const request = { prompt: 'sensitive prompt material' }
    const digest = canonicalDigest(request)
    const ledger = new SqliteAgentRequestLedger(path, { retentionMs: 1, now: () => now })
    const claim = owned(await ledger.prepare(key, digest, acceptedFor(key), request))
    await ledger.acceptAdmission(key, claim.claimToken, 'admitted')
    await ledger.beginEffect(key, claim.claimToken)
    await ledger.complete(key, claim.claimToken, { ok: true })
    now = MIN_REQUEST_RETENTION_MS + 1
    const trigger = { ...key, requestId: 'sensitive-prune-trigger' }
    await ledger.prepare(trigger, 'trigger-digest', acceptedFor(trigger))
    const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const inspect = new SqliteDatabaseSync(path)
    expect(inspect.prepare('SELECT count(*) AS count FROM agent_request_ledger WHERE request_key != ?').get(JSON.stringify([
      trigger.workspaceScopeId, trigger.authSubjectId, trigger.operation, trigger.target.kind,
      trigger.target.kind === 'agent' ? trigger.target.agentTypeId : [trigger.target.ref.agentTypeId, trigger.target.ref.sessionId], trigger.requestId,
    ]))).toEqual({ count: 0 })
    const tombstone = inspect.prepare('SELECT digest, key_json, settlement_digest FROM agent_request_tombstones').get() as { digest: string; key_json: string; settlement_digest: string }
    expect(tombstone.digest).toBe(digest)
    expect(tombstone.settlement_digest).toBeTruthy()
    expect(tombstone.key_json).not.toContain('sensitive prompt material')
    inspect.close()
    await expect(ledger.prepare(key, digest, acceptedFor(key), request)).resolves.toMatchObject({ ownership: 'existing' })
    await expect(ledger.prepare(key, canonicalDigest({ prompt: 'different' }), acceptedFor(key), { prompt: 'different' })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    ledger.close()
  })

  it('validates the effect target before claiming durable ownership', async () => {
    const ledger = new SqliteAgentRequestLedger(join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`))
    await expect(ledger.prepare({
      ...key,
      target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-a' } },
    }, 'digest-a', acceptedFor({
      ...key,
      target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-a' } },
    }))).rejects.toThrow('request ledger effect/target mismatch')
    ledger.close()
  })
})
