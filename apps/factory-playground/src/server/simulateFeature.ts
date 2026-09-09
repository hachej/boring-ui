import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import {
  createSandboxBashTool,
  createSandboxManagementTool,
  SandboxLeaseService,
} from '@hachej/boring-sandbox-plugin/server'
import {
  createLocalDisposableProvider,
  FACTORY_WORKSPACE_SCOPE_ID,
  FACTORY_WORKER_AGENT_TYPE_ID,
} from '@hachej/boring-factory/server/sandbox'

export interface FactorySimulationEvent {
  readonly at: string
  readonly stage: string
  readonly message: string
  readonly workerSessionId?: string
  readonly beadId?: string
  readonly sandbox?: string
}

export interface FactoryWorkerReceipt {
  readonly workerSessionId: string
  readonly beadId: string
  readonly sandbox: string
  readonly sha: string
  readonly sandboxSourceSha: string
  readonly testExitCode: number
  readonly testOutputDigest: `sha256:${string}`
  readonly hostValidation: 'clean'
  readonly released: boolean
}

export interface FactorySimulationReceipt {
  readonly request: string
  readonly orchestratorSessionId: string
  readonly loopCommand: '/loop'
  readonly sharedEpicWorktree: true
  readonly workers: readonly FactoryWorkerReceipt[]
  readonly integratedFeatureSha: string
  readonly integratedTestExitCode: 0
  readonly cleanupDebt: 0
  readonly merged: false
}

interface SimulateFeatureOptions {
  readonly seedRoot: string
  readonly leaseRoot: string
  readonly outputPath?: string
  readonly workGraphRoot?: string
  readonly orchestratorSessionId?: string
  readonly workerSessionIds?: readonly [string, string]
  readonly delayMs?: number
  readonly onEvent?: (event: FactorySimulationEvent) => void | Promise<void>
}

const execFileAsync = promisify(execFile)

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function details(result: ToolResult): Record<string, unknown> {
  if (result.isError) throw new Error(result.content.map((part) => part.text).join('\n'))
  return (result.details ?? {}) as Record<string, unknown>
}

function testOutputText(result: ToolResult): string {
  if (result.isError) throw new Error(result.content.map((part) => part.text).join('\n'))
  return result.content.map((part) => part.text).join('\n')
}

function changedOutputText(result: ToolResult): string {
  return testOutputText(result)
}

function context(sessionId: string, toolCallId: string): ToolExecContext {
  return {
    abortSignal: new AbortController().signal,
    toolCallId,
    sessionId,
    workspaceId: FACTORY_WORKSPACE_SCOPE_ID,
    requestId: `${sessionId}:${toolCallId}`,
  }
}

async function runBr(cwd: string, args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync('br', [...args, '--json', '--no-auto-flush'], { cwd })
  return JSON.parse(stdout)
}

function issueId(value: unknown): string {
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  throw new Error('br did not return an issue id')
}

export async function simulateFactoryFeature(options: SimulateFeatureOptions): Promise<FactorySimulationReceipt> {
  const delayMs = options.delayMs ?? 250
  const events: FactorySimulationEvent[] = []
  const emit = async (event: Omit<FactorySimulationEvent, 'at'>) => {
    const complete = { at: new Date().toISOString(), ...event }
    events.push(complete)
    await options.onEvent?.(complete)
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  const workGraphRoot = resolve(options.workGraphRoot ?? resolve(options.leaseRoot, '../work-graph'), randomUUID())
  const integrationRoot = resolve(workGraphRoot, 'integrated-feature')
  const service = new SandboxLeaseService({
    workspaceRoot: options.leaseRoot,
    provider: createLocalDisposableProvider(integrationRoot),
    serviceDigest: digest('factory-playground-simulation-v1'),
    providerWorkspaceId: FACTORY_WORKSPACE_SCOPE_ID,
    ttlMs: 60_000,
    reapIntervalMs: 60_000,
    drainTimeoutMs: 5_000,
    maxActiveLeasesPerOwner: 1,
    maxActiveLeasesTotal: 2,
  })
  const toolOptions = {
    leases: service,
    workspaceScopeId: FACTORY_WORKSPACE_SCOPE_ID,
    agentTypeId: FACTORY_WORKER_AGENT_TYPE_ID,
  }
  const sandbox = createSandboxManagementTool(toolOptions)
  const bash = createSandboxBashTool(toolOptions)
  const orchestratorSessionId = options.orchestratorSessionId ?? 'factory-orchestrator-demo'
  const receipts: FactoryWorkerReceipt[] = []
  let integratedFeatureSha = ''

  try {
    await mkdir(workGraphRoot, { recursive: true })
    await cp(options.seedRoot, integrationRoot, { recursive: true })
    await execFileAsync('git', ['init', '-q'], { cwd: integrationRoot })
    await execFileAsync('git', ['config', 'user.email', 'factory@example.test'], { cwd: integrationRoot })
    await execFileAsync('git', ['config', 'user.name', 'Factory Integration'], { cwd: integrationRoot })
    await execFileAsync('git', ['add', '.'], { cwd: integrationRoot })
    await execFileAsync('git', ['commit', '-qm', 'baseline'], { cwd: integrationRoot })
    await execFileAsync('br', ['init', '--prefix', 'demo', '--no-auto-flush'], { cwd: workGraphRoot })
  const workerSessionIds = options.workerSessionIds ?? ['factory-worker-demo-1', 'factory-worker-demo-2'] as const
  const definitions = [
    {
      title: 'Implement excited greeting',
      command: "printf '%s\\n' 'export function greeting(name) {' '  return `Hello, ${name}!`' '}' > src/greeting.js && sed -i 's/Hello, Factory/Hello, Factory!/' test/greeting.test.js",
      expectedPaths: ['src/greeting.js', 'test/greeting.test.js'],
    },
    {
      title: 'Document excited greeting',
      command: "printf '\\n## Example\\n\\n`greeting(\\\"Factory\\\")` returns `Hello, Factory!`.\\n' >> README.md",
      expectedPaths: ['README.md'],
    },
  ] as const
  const work = [] as Array<(typeof definitions)[number] & { beadId: string }>
  for (const [index, definition] of definitions.entries()) {
    const created = await runBr(workGraphRoot, [
      'create', definition.title, '--type', 'task', '--priority', '1', '--slug', `feature-${index + 1}`,
    ])
    work.push({ ...definition, beadId: issueId(created) })
  }
    await emit({ stage: 'intake', message: 'Feature request admitted: add an excited greeting.' })
    await emit({ stage: 'plan-gate', message: 'Plan approved and two ready beads materialized in the real br graph.' })
    await emit({ stage: 'loop', message: 'The deterministic harness advanced after the native app executed /loop.' })

    for (const workerSessionId of workerSessionIds) {
      const ready = await runBr(workGraphRoot, ['ready']) as Array<{ id?: unknown }>
      const beadId = typeof ready[0]?.id === 'string' ? ready[0].id : undefined
      const item = work.find((candidate) => candidate.beadId === beadId)
      if (!item) {
        throw new Error(`worker ${workerSessionId} found no recognized ready bead: ${JSON.stringify(ready)}`)
      }
      await runBr(workGraphRoot, [
        'update', item.beadId, '--claim', '--actor', workerSessionId, '--notes', `session=${workerSessionId}`,
      ])
      await emit({
        stage: 'claim',
        message: 'Worker ran br ready, selected the first priority/age candidate, and atomically claimed it with its own session identity.',
        workerSessionId,
        beadId: item.beadId,
      })
      await execFileAsync('bash', ['-lc', item.command], { cwd: integrationRoot })
      const changedOutput = (await execFileAsync('git', ['diff', '--name-only'], { cwd: integrationRoot })).stdout
      const changedPaths = changedOutput.split('\n').map((path) => path.trim()).filter(Boolean).sort()
      if (JSON.stringify(changedPaths) !== JSON.stringify([...item.expectedPaths].sort())) {
        throw new Error(`validation rejected ${item.beadId}: expected ${item.expectedPaths.join(', ')}, got ${changedPaths.join(', ')}`)
      }
      await execFileAsync('git', ['add', '--', ...item.expectedPaths], { cwd: integrationRoot })
      await execFileAsync('git', ['commit', '-qm', `${item.beadId} implement feature`], { cwd: integrationRoot })
      const sha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: integrationRoot })).stdout.trim()
      await emit({
        stage: 'commit',
        message: `Worker committed its Bead directly in the shared epic worktree at ${sha.slice(0, 12)}.`,
        workerSessionId,
        beadId: item.beadId,
      })

      const createResult = await sandbox.execute({ op: 'create' }, context(workerSessionId, `${item.beadId}:create`))
      const handle = String(details(createResult).sandbox)
      await emit({
        stage: 'sandbox',
        message: `The host snapshotted committed SHA ${sha.slice(0, 12)} into a dedicated test sandbox.`,
        workerSessionId,
        beadId: item.beadId,
        sandbox: handle,
      })
      const run = async (command: string, id: string) => {
        const result = await bash.execute(
          { sandbox: handle, command },
          context(workerSessionId, `${item.beadId}:${id}`),
        )
        testOutputText(result)
        return result
      }
      const sandboxSha = changedOutputText(await run('git rev-parse HEAD', 'sha')).trim().split('\n').at(-1) ?? ''
      if (sandboxSha !== sha) {
        throw new Error(`sandbox source mismatch for ${item.beadId}: expected ${sha}, got ${sandboxSha}`)
      }
      const test = await run('npm test', 'test')
      const testOutput = testOutputText(test)
      await emit({
        stage: 'validation',
        message: `Dedicated sandbox test passed against exact committed SHA ${sha.slice(0, 12)}; this is not independent agent review.`,
        workerSessionId,
        beadId: item.beadId,
        sandbox: handle,
      })
      await sandbox.execute({ op: 'release', sandbox: handle }, context(workerSessionId, `${item.beadId}:release`))
      receipts.push({
        workerSessionId,
        beadId: item.beadId,
        sandbox: handle,
        sha,
        sandboxSourceSha: sandboxSha,
        testExitCode: 0,
        testOutputDigest: digest(testOutput),
        hostValidation: 'clean',
        released: true,
      })
      await emit({
        stage: 'settled',
        message: 'Validated SHA-bound simulation outcome recorded; sandbox drained and released.',
        workerSessionId,
        beadId: item.beadId,
        sandbox: handle,
      })
    }
    integratedFeatureSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: integrationRoot })).stdout.trim()
    const integrationOwner = workerSessionIds[0]
    const integratedLease = await sandbox.execute(
      { op: 'create' },
      context(integrationOwner, 'integrated:create'),
    )
    const integratedHandle = String(details(integratedLease).sandbox)
    const integratedSandboxSha = changedOutputText(await bash.execute(
      { sandbox: integratedHandle, command: 'git rev-parse HEAD' },
      context(integrationOwner, 'integrated:sha'),
    )).trim().split('\n').at(-1) ?? ''
    if (integratedSandboxSha !== integratedFeatureSha) {
      throw new Error(`integrated sandbox source mismatch: expected ${integratedFeatureSha}, got ${integratedSandboxSha}`)
    }
    testOutputText(await bash.execute(
      { sandbox: integratedHandle, command: 'npm test' },
      context(integrationOwner, 'integrated:test'),
    ))
    await sandbox.execute(
      { op: 'release', sandbox: integratedHandle },
      context(integrationOwner, 'integrated:release'),
    )
    await emit({
      stage: 'integration',
      message: `Both shared-worktree commits compose and pass in a dedicated sandbox at exact SHA ${integratedFeatureSha.slice(0, 12)}.`,
    })
  } finally {
    try {
      await service.dispose()
    } finally {
      await rm(workGraphRoot, { recursive: true, force: true })
    }
  }

  const receipt: FactorySimulationReceipt = {
    request: 'Add an excited greeting to the demo repository',
    orchestratorSessionId,
    loopCommand: '/loop',
    sharedEpicWorktree: true,
    workers: receipts,
    integratedFeatureSha,
    integratedTestExitCode: 0,
    cleanupDebt: 0,
    merged: false,
  }
  await emit({ stage: 'complete', message: 'Factory simulation complete. Nothing was merged.' })
  if (options.outputPath) {
    await mkdir(dirname(options.outputPath), { recursive: true })
    await writeFile(options.outputPath, `${JSON.stringify({ receipt, events }, null, 2)}\n`, 'utf8')
  }
  return receipt
}
