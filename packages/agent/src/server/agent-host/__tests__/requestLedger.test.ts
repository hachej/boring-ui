import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { SqliteAgentRequestLedger } from '../sqliteRequestLedger'
import type { AgentRequestKey, AgentRequestLedger } from '../types'

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
      void worker.terminate()
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
      ledger.prepare(key, 'digest-a'),
      ledger.prepare(key, 'digest-a'),
    ])
    expect(first).toMatchObject({ ownership: 'created', record: { state: 'pending-admission' } })
    expect(retry).toMatchObject({ ownership: 'existing', record: first.record })
    await ledger.acceptAdmission(key, 'admission-a')
    await ledger.beginEffect(key)
    await ledger.complete(key, { accepted: true })
    expect(await ledger.prepare(key, 'digest-a')).toMatchObject({
      ownership: 'existing',
      record: { state: 'completed', receipt: { accepted: true } },
    })
    await expect(ledger.prepare(key, 'digest-b')).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
  })

  it('retains stable strong rejection', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await ledger.prepare(key, 'digest-a')
    expect((await ledger.read(key))?.state).toBe('pending-admission')
    await ledger.reject(key, {
      kind: 'gateway',
      error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'rejected' })
  })

  it('permits outcome-unknown only from in-flight', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await ledger.prepare(key, 'digest-a')
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
      await ledger.prepare(key, 'digest-a')
      await ledger.markAdmissionRetryable(key)
      await expect(ledger.prepare(key, 'digest-b')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.acceptAdmission(key, 'unclaimed')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      const claims = await Promise.all([ledger.prepare(key, 'digest-a'), ledger.prepare(key, 'digest-a')])
      expect(claims.map(({ ownership }) => ownership)).toEqual(['reclaimed', 'existing'])
      expect(claims[0]?.record).not.toHaveProperty('retryable')
      await ledger.acceptAdmission(key, 'admitted')
      await ledger.beginEffect(key)
      await ledger.complete(key, { accepted: true })
      await expect(ledger.prepare(key, 'digest-a')).resolves.toMatchObject({
        ownership: 'existing', record: { state: 'completed', receipt: { accepted: true } },
      })
    } finally {
      await ledger.close?.()
    }
  })

  it('does not release accepted, in-flight, or unknown effects for another attempt', async () => {
    const ledger = create()
    try {
      await ledger.prepare(key, 'digest-a')
      await ledger.acceptAdmission(key, 'admitted')
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.beginEffect(key)
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.markOutcomeUnknown(key, { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown' })
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.prepare(key, 'digest-a')).resolves.toMatchObject({ ownership: 'existing', record: { state: 'outcome-unknown' } })
    } finally {
      await ledger.close?.()
    }
  })
})

describe('SqliteAgentRequestLedger', () => {
  it('atomically elects one retry owner across concurrent connections and starts only its effect', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const setup = new SqliteAgentRequestLedger(path)
    await setup.prepare(key, 'digest-a')
    await setup.markAdmissionRetryable(key)
    setup.close()

    // Each worker owns a separate real node:sqlite connection to this WAL file.
    // Both workers block after opening until the coordinator releases one shared
    // barrier, so their synchronous prepare calls execute on different OS threads.
    const retried = await runParallelClaims(path)
    expect(retried.filter(({ claim }) => claim.ownership === 'reclaimed')).toHaveLength(1)
    const losers = retried.filter(({ claim }) => claim.ownership === 'existing')
    expect(losers).toHaveLength(1)
    expect(losers[0]?.claim.record.state).toMatch(/^(pending-admission|admission-accepted|in-flight)$/)
    expect(retried.filter(({ effectStarted }) => effectStarted)).toHaveLength(1)

    const owner = new SqliteAgentRequestLedger(path)
    await expect(owner.read(key)).resolves.toMatchObject({ state: 'in-flight' })
    await owner.complete(key, { accepted: true })
    owner.close()

    const reopened = new SqliteAgentRequestLedger(path)
    await expect(reopened.prepare(key, 'digest-a')).resolves.toMatchObject({
      ownership: 'existing',
      record: { state: 'completed', receipt: { accepted: true } },
    })
    await expect(reopened.prepare(key, 'digest-b')).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
    reopened.close()
  }, 20_000)

  it.each(['pending-admission', 'admission-accepted', 'in-flight', 'outcome-unknown'] as const)(
    'does not reclaim %s after reopen without a proven safe release',
    async (state) => {
      const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
      const initial = new SqliteAgentRequestLedger(path)
      try {
        await initial.prepare(key, 'digest-a')
        if (state !== 'pending-admission') await initial.acceptAdmission(key, 'admitted')
        if (state === 'in-flight' || state === 'outcome-unknown') await initial.beginEffect(key)
        if (state === 'outcome-unknown') await initial.markOutcomeUnknown(key, {
          code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown',
        })
      } finally {
        initial.close()
      }
      const reopened = new SqliteAgentRequestLedger(path)
      try {
        await expect(reopened.prepare(key, 'digest-a')).resolves.toMatchObject({ ownership: 'existing', record: { state } })
        await expect(reopened.prepare(key, 'digest-b')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      } finally {
        reopened.close()
      }
    },
  )

  it('validates the effect target before claiming durable ownership', async () => {
    const ledger = new SqliteAgentRequestLedger(join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`))
    await expect(ledger.prepare({
      ...key,
      target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-a' } },
    }, 'digest-a')).rejects.toThrow('request ledger effect/target mismatch')
    ledger.close()
  })
})
