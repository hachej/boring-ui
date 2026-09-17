import { parentPort, workerData } from 'node:worker_threads'
import { createGatewayAcceptedWorkContext } from '../../acceptedWork'
import { SqliteAgentRequestLedger } from '../../sqliteRequestLedger'
import type { AgentRequestKey, AgentRequestLedgerPrepareResult } from '../../types'

interface ClaimWorkerInput {
  dbPath: string
  key: AgentRequestKey
  digest: string
  barrier: SharedArrayBuffer
}

interface ClaimProcessInput {
  dbPath: string
  key: AgentRequestKey
  digest: string
  request: import('../../../../shared/index').JsonValue
  claimLeaseMs: number
  mode: 'complete' | 'hold'
}

type ClaimWorkerMessage =
  | { claim: AgentRequestLedgerPrepareResult; effectStarted: boolean }
  | { error: { name: string; message: string; stack?: string } }

function accepted(key: AgentRequestKey) {
  return createGatewayAcceptedWorkContext({
    key,
    admittedAgentTypeId: key.target.kind === 'agent' ? key.target.agentTypeId : key.target.ref.agentTypeId,
  })
}

async function workerMain(input: ClaimWorkerInput): Promise<void> {
  const sync = new Int32Array(input.barrier)
  const ledger = new SqliteAgentRequestLedger(input.dbPath)
  let message: ClaimWorkerMessage
  try {
    Atomics.add(sync, 0, 1)
    Atomics.notify(sync, 0)
    Atomics.wait(sync, 1, 0)
    const claim = await ledger.prepare(input.key, input.digest, accepted(input.key))
    let effectStarted = false
    if (claim.ownership === 'reclaimed') {
      await ledger.acceptAdmission(input.key, claim.claimToken, 'parallel-admission')
      await ledger.beginEffect(input.key, claim.claimToken)
      effectStarted = true
      await ledger.complete(input.key, claim.claimToken, { accepted: true })
    }
    message = { claim, effectStarted }
  } catch (error) {
    message = {
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: 'Error', message: String(error) },
    }
  } finally {
    ledger.close()
  }
  parentPort?.postMessage(message)
}

async function nextStdinLine(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdin.once('data', () => resolve())
    process.stdin.once('error', reject)
    process.stdin.resume()
  })
}

async function processMain(input: ClaimProcessInput): Promise<void> {
  const ledger = new SqliteAgentRequestLedger(input.dbPath, { claimLeaseMs: input.claimLeaseMs })
  process.stdout.write('READY\n')
  await nextStdinLine()
  const claim = await ledger.prepare(input.key, input.digest, accepted(input.key), input.request)
  let effectStarted = false
  if (claim.ownership === 'created' || claim.ownership === 'reclaimed') {
    await ledger.acceptAdmission(input.key, claim.claimToken, 'process-admission')
    await ledger.beginEffect(input.key, claim.claimToken)
    effectStarted = true
    if (input.mode === 'complete') await ledger.complete(input.key, claim.claimToken, { accepted: true })
  }
  process.stdout.write(`${JSON.stringify({ claim, effectStarted })}\n`)
  if (input.mode === 'hold' && effectStarted) {
    setInterval(() => {}, 60_000)
    return
  }
  ledger.close()
}

if (parentPort) {
  await workerMain(workerData as ClaimWorkerInput)
} else {
  const encoded = process.env.REQUEST_LEDGER_PROCESS_INPUT
  if (!encoded) throw new Error('REQUEST_LEDGER_PROCESS_INPUT is required')
  await processMain(JSON.parse(encoded) as ClaimProcessInput)
}
