import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createFactoryPlayground } from '../src/server/app'
import { FACTORY_ORCHESTRATOR_AGENT_TYPE_ID } from '../src/server/factoryFleet'
import { FACTORY_WORKER_AGENT_TYPE_ID } from '../src/server/sandboxComposition'
import { simulateFactoryFeature } from '../src/server/simulateFeature'

const appRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appRoot, '../..')
const outputPath = resolve(appRoot, 'workspace/factory-runs/latest.json')
const stateRoot = await mkdtemp(resolve(tmpdir(), 'native-factory-watch-'))
const app = await createFactoryPlayground({
  appRoot,
  repositoryRoot,
  workspaceRoot: repositoryRoot,
  logger: false,
  env: {
    ...process.env,
    BORING_FACTORY_STATE_ROOT: resolve(stateRoot, 'state'),
    BORING_AGENT_SESSION_ROOT: resolve(stateRoot, 'sessions'),
  },
})

const header = { 'x-boring-workspace-id': 'factory-playground' }
const createSession = async (agentTypeId: string) => {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${agentTypeId}/sessions`,
    headers: header,
    payload: { requestId: `simulation-${agentTypeId}-${randomUUID()}` },
  })
  if (response.statusCode !== 201) throw new Error(response.body)
  return response.json<{ sessionId: string }>().sessionId
}

console.log('Watching native Factory simulation\n')
try {
  const orchestratorSessionId = await createSession(FACTORY_ORCHESTRATOR_AGENT_TYPE_ID)
  const workerSessionIds = [
    await createSession(FACTORY_WORKER_AGENT_TYPE_ID),
    await createSession(FACTORY_WORKER_AGENT_TYPE_ID),
  ] as const
  const loopResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/commands/execute`,
    headers: header,
    payload: {
      requestId: `simulation-loop-${randomUUID()}`,
      sessionId: orchestratorSessionId,
      name: 'loop',
      args: 'list',
    },
  })
  if (loopResponse.statusCode !== 200) throw new Error(loopResponse.body)
  console.log(`native      Host issued Orchestrator ${orchestratorSessionId} and two Worker sessions; /loop executed.`)

  const receipt = await simulateFactoryFeature({
    seedRoot: resolve(appRoot, 'src/fixtures/demo-repo'),
    leaseRoot: resolve(stateRoot, 'simulation-leases'),
    outputPath,
    orchestratorSessionId,
    workerSessionIds,
    onEvent(event) {
      const owner = event.workerSessionId ? ` · ${event.workerSessionId}` : ''
      const bead = event.beadId ? ` · ${event.beadId}` : ''
      console.log(`${event.at}  ${event.stage.padEnd(10)} ${event.message}${owner}${bead}`)
    },
  })

  console.log(`\nReceipt: ${outputPath}`)
  console.log(JSON.stringify(receipt, null, 2))
} finally {
  try {
    await app.close()
  } finally {
    await rm(stateRoot, { recursive: true, force: true })
  }
}
