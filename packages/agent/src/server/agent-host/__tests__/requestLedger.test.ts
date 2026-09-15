import { randomUUID } from 'node:crypto'
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
    await ledger.acceptAdmission(key, 'admission-a')
    await ledger.beginEffect(key)
    await ledger.complete(key, { accepted: true })
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
    await ledger.prepare(key, 'digest-a', acceptedFor(key))
    expect((await ledger.read(key))?.state).toBe('pending-admission')
    await ledger.reject(key, {
      kind: 'gateway',
      error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'rejected' })
  })

  it('permits outcome-unknown only from in-flight', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await ledger.prepare(key, 'digest-a', acceptedFor(key))
    await expect(ledger.markOutcomeUnknown(key, {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      message: 'unknown',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    await ledger.acceptAdmission(key, 'admission-a')
    await ledger.beginEffect(key)
    await ledger.markOutcomeUnknown(key, {
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
      await ledger.prepare(key, 'digest-a', acceptedFor(key))
      await ledger.markAdmissionRetryable(key)
      await expect(ledger.prepare(key, 'digest-b', acceptedFor(key))).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.acceptAdmission(key, 'unclaimed')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      const claims = await Promise.all([ledger.prepare(key, 'digest-a', acceptedFor(key)), ledger.prepare(key, 'digest-a', acceptedFor(key))])
      expect(claims.map(({ ownership }) => ownership)).toEqual(['reclaimed', 'existing'])
      expect(claims[0]?.record).not.toHaveProperty('retryable')
      await ledger.acceptAdmission(key, 'admitted')
      await ledger.beginEffect(key)
      await ledger.complete(key, { accepted: true })
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
      await ledger.prepare(key, 'digest-a', acceptedFor(key))
      await ledger.acceptAdmission(key, 'admitted')
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.beginEffect(key)
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.markOutcomeUnknown(key, { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown' })
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
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
        await ledger.prepare(requestKey, 'digest', acceptedFor(requestKey))
        await ledger.acceptAdmission(requestKey, `bearer:${requestKey.requestId}`)
        await ledger.beginEffect(requestKey)
        expect(await ledger.read(requestKey)).not.toHaveProperty('admissionReceipt')
      }
      const completed = make('no-provenance-completed'); await start(completed); await ledger.complete(completed, { ok: true })
      const rejected = make('no-provenance-rejected'); await start(rejected); await ledger.reject(rejected, { kind: 'gateway', error: { code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT, message: 'failed' } })
      const unknown = make('no-provenance-unknown'); await start(unknown); await ledger.markOutcomeUnknown(unknown, { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown' })
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
      await ledger.prepare(key, 'digest', context)
      const assertContext = async () => {
        const retained = (await ledger.read(key))!.acceptedWork
        expect(retained).toEqual(context)
        expect(Object.isFrozen(retained)).toBe(true)
        expect(Object.isFrozen(retained.identity.requestKey.target)).toBe(true)
        expect(() => { (retained.identity.agent as { agentTypeId: string }).agentTypeId = 'forged' }).toThrow()
      }
      await assertContext()
      await ledger.markAdmissionRetryable(key)
      await ledger.prepare(key, 'digest', context)
      await assertContext()
      await ledger.acceptAdmission(key, 'provenance-only')
      await assertContext()
      await ledger.beginEffect(key)
      await assertContext()
      await ledger.complete(key, { ok: true })
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

  it('atomically elects one retry owner across concurrent connections and starts only its effect', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const setup = new SqliteAgentRequestLedger(path)
    await setup.prepare(key, 'digest-a', acceptedFor(key))
    await setup.markAdmissionRetryable(key)
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
    expect(losers[0]?.claim.record.state).toMatch(/^(pending-admission|admission-accepted|in-flight)$/)
    expect(losers[0]?.effectStarted).toBe(false)
    expect(retried.filter(({ effectStarted }) => effectStarted)).toHaveLength(1)

    const owner = new SqliteAgentRequestLedger(path)
    await expect(owner.read(key)).resolves.toMatchObject({ state: 'in-flight' })
    await owner.complete(key, { accepted: true })
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
        await initial.prepare(key, 'digest-a', acceptedFor(key))
        if (state === 'rejected') {
          await initial.reject(key, {
            kind: 'gateway',
            error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
          })
        } else if (state !== 'pending-admission') {
          await initial.acceptAdmission(key, 'admitted')
          if (state !== 'admission-accepted') await initial.beginEffect(key)
          if (state === 'completed') await initial.complete(key, { accepted: true })
          if (state === 'outcome-unknown') await initial.markOutcomeUnknown(key, {
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
      await ledger.prepare(stateKey, `digest-${state}`, acceptedFor(stateKey))
      if (state === 'rejected') {
        await ledger.reject(stateKey, {
          kind: 'gateway',
          error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
        })
      } else if (state !== 'pending-admission') {
        await ledger.acceptAdmission(stateKey, 'admitted')
        if (state !== 'admission-accepted') await ledger.beginEffect(stateKey)
        if (state === 'completed') await ledger.complete(stateKey, { accepted: true })
        if (state === 'outcome-unknown') await ledger.markOutcomeUnknown(stateKey, {
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
    for (const state of ['pending-admission', 'admission-accepted', 'in-flight'] as const) {
      await expect(ledger.prepare(keyed(state), `digest-${state}`, acceptedFor(keyed(state)))).resolves.toMatchObject({
        ownership: 'existing', record: { state },
      })
    }
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
