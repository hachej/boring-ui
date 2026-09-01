import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Sandbox, Snapshot } from '@vercel/sandbox'

import { SandboxLeaseService } from '../src/server/leaseService'
import { createSandboxBashTool } from '../src/server/sandboxBashTool'
import { createSandboxManagementTool } from '../src/server/sandboxManagementTool'
import { sandboxLeaseOwnerId } from '../src/server/leaseOwner'
import type { ToolExecContext } from '@hachej/boring-agent/shared'
import { buildHarnessAgentTools, type RuntimeBundle } from '@hachej/boring-bash/agent'
import { FileHandleStore, createVercelSandboxProvider } from '@hachej/boring-sandbox/providers/vercel-sandbox'

const SERVICE_DIGEST = 'vercel-live-smoke-v1'
const AGENT_TYPE_ID = 'factory-worker-smoke'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function disposableName(workspaceId: string, handle: string): string {
  const requestId = createHash('sha256')
    .update(`${SERVICE_DIGEST}:${handle}:provider-create`)
    .digest('hex')
  return `boring-lease-${createHash('sha256')
    .update(`${workspaceId}:${handle}:${requestId}`)
    .digest('hex')
    .slice(0, 40)}`
}

function httpStatus(error: unknown): number | undefined {
  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }
  if (typeof candidate.statusCode === 'number') return candidate.statusCode
  if (typeof candidate.status === 'number') return candidate.status
  return typeof candidate.response?.status === 'number' ? candidate.response.status : undefined
}

async function main(): Promise<void> {
  if (process.env.RUN_VERCEL_SANDBOX_LEASE_SMOKE !== '1') {
    console.error('Skipping real Vercel lease smoke. Set RUN_VERCEL_SANDBOX_LEASE_SMOKE=1 to run.')
    return
  }

  const token = process.env.VERCEL_TOKEN
    ?? process.env.VERCEL_ACCESS_TOKEN
    ?? process.env.VERCEL_OIDC_TOKEN
  if (!token?.trim()) {
    throw new Error('VERCEL_TOKEN, VERCEL_ACCESS_TOKEN, or VERCEL_OIDC_TOKEN is required')
  }
  const teamId = requireEnv('VERCEL_TEAM_ID')
  const projectId = requireEnv('VERCEL_PROJECT_ID')
  const telemetrySalt = requireEnv('BORING_SANDBOX_TELEMETRY_SALT')
  const credentials = { token, teamId, projectId }

  const tempDir = await mkdtemp(join(tmpdir(), 'boring-agent-vercel-lease-smoke-'))
  const store = new FileHandleStore({ storePath: join(tempDir, 'handles.json') })
  const workspaceId = `vercel-lease-smoke-${Date.now()}`
  const toolContext = {
    abortSignal: new AbortController().signal,
    toolCallId: 'vercel-live-smoke',
    sessionId: 'vercel-live-smoke-session',
    workspaceId,
  } as ToolExecContext
  const ownerId = sandboxLeaseOwnerId({ workspaceScopeId: workspaceId, agentTypeId: AGENT_TYPE_ID }, toolContext)
  const handles = ['lease-smoke-handle-0001', 'lease-smoke-handle-0002']
  const deadlineHandle = 'lease-timeout-proof-0001'
  const remoteNames = handles.map((handle) => disposableName(workspaceId, handle))
  const allRemoteNames = [...remoteNames, disposableName(workspaceId, deadlineHandle)]
  const startedAt = Date.now()

  let seed: Sandbox | undefined
  let snapshot: Snapshot | undefined
  let service: SandboxLeaseService | undefined
  let deadlineService: SandboxLeaseService | undefined
  let sequence = 0
  const cleanupFailures: unknown[] = []
  let phase = 'seed-create'

  try {
    seed = await Sandbox.create({
      ...credentials,
      runtime: 'node24',
      persistent: false,
    })
    phase = 'seed-write'
    const seeded = await seed.runCommand({
      cmd: 'sh',
      args: ['-c', 'mkdir -p /workspace && printf seeded > /workspace/base.txt'],
    })
    if ((seeded.exitCode ?? 1) !== 0) throw new Error('failed to seed immutable Vercel smoke snapshot')
    phase = 'snapshot-create'
    snapshot = await seed.snapshot({ expiration: 24 * 60 * 60 * 1000 })

    const provider = createVercelSandboxProvider({
      lifecycle: 'disposable',
      timeoutMs: 10 * 60 * 1000,
      snapshotExpirationMs: 24 * 60 * 60 * 1000,
      telemetrySalt,
      store,
      immutableSnapshotId: snapshot.snapshotId,
    })
    service = new SandboxLeaseService({
      workspaceRoot: join(tempDir, 'leases'),
      provider,
      providerWorkspaceId: workspaceId,
      serviceDigest: SERVICE_DIGEST,
      ttlMs: 10 * 60 * 1000,
      reapIntervalMs: 60_000,
      drainTimeoutMs: 30_000,
      maxActiveLeasesPerOwner: 2,
      maxActiveLeasesTotal: 2,
      createHandle: () => handles[sequence++]!,
    })

    const managementTool = createSandboxManagementTool({
      leases: service,
      workspaceScopeId: workspaceId,
      agentTypeId: AGENT_TYPE_ID,
    })
    const createLease = async (toolCallId: string) => {
      const response = await managementTool.execute(
        { op: 'create' },
        { ...toolContext, toolCallId },
      )
      if (response.isError) {
        const code = (response.details as { code?: unknown } | undefined)?.code
        throw Object.assign(new Error('sandbox create tool failed'), {
          code: typeof code === 'string' ? code : 'SANDBOX_CREATE_FAILED',
        })
      }
      const details = response.details as { sandbox?: unknown; expiresAt?: unknown }
      if (typeof details.sandbox !== 'string' || typeof details.expiresAt !== 'number') {
        throw new Error('sandbox create tool returned an invalid receipt')
      }
      return { handle: details.sandbox, expiresAt: details.expiresAt }
    }
    const releaseLease = async (handle: string, toolCallId: string) => {
      const response = await managementTool.execute(
        { op: 'release', sandbox: handle },
        { ...toolContext, toolCallId },
      )
      if (response.isError) throw new Error(`sandbox release tool failed: ${JSON.stringify(response.details)}`)
    }

    phase = 'lease-acquire-first'
    const first = await createLease('vercel-live-create-first')
    phase = 'lease-acquire-second'
    const second = await createLease('vercel-live-create-second')
    if (first.handle === second.handle) throw new Error('Vercel leases reused an opaque handle')
    if ((await store.list()).length !== 0) throw new Error('disposable leases polluted the persistent handle store')

    phase = 'lease-first-operations'
    await service.withPair(ownerId, first.handle, async (pair) => {
      if ((await pair.workspace.readFile('base.txt')).trim() !== 'seeded') {
        throw new Error('first lease did not inherit the immutable snapshot')
      }
      await pair.workspace.writeFile('isolated.txt', 'first')
      const result = await pair.sandbox.exec('printf first-exec')
      if (result.exitCode !== 0 || Buffer.from(result.stdout).toString('utf8') !== 'first-exec') {
        throw new Error('targeted execution failed in first Vercel lease')
      }
    })
    phase = 'lease-second-operations'
    await service.withPair(ownerId, second.handle, async (pair) => {
      if ((await pair.workspace.readFile('base.txt')).trim() !== 'seeded') {
        throw new Error('second lease did not inherit the immutable snapshot')
      }
      await pair.workspace.writeFile('isolated.txt', 'second')
      if ((await pair.workspace.readFile('isolated.txt')).trim() !== 'second') {
        throw new Error('second lease write was not isolated')
      }
    })
    await service.withPair(ownerId, first.handle, async (pair) => {
      if ((await pair.workspace.readFile('isolated.txt')).trim() !== 'first') {
        throw new Error('mutable bytes crossed Vercel lease boundaries')
      }
    })

    phase = 'sandbox-bash-exec'
    const canonicalBashContract = await service.withPair(ownerId, second.handle, async (pair) => {
      const bash = buildHarnessAgentTools({
        workspace: pair.workspace,
        sandbox: pair.sandbox,
        fileSearch: { async search() { return [] } },
        bash: { kind: 'remote' },
        filesystem: { kind: 'remote-workspace' },
      } as RuntimeBundle).find((tool) => tool.name === 'bash')
      if (!bash) throw new Error('canonical bash tool was not composed')
      return JSON.stringify({ description: bash.description, parameters: bash.parameters })
    })
    const sandboxBash = createSandboxBashTool({
      leases: service,
      workspaceScopeId: workspaceId,
      agentTypeId: AGENT_TYPE_ID,
    })
    const sandboxBashResult = await sandboxBash.execute(
      { sandbox: second.handle, command: 'printf sandbox-bash' },
      toolContext,
    )
    if (sandboxBashResult.isError || !sandboxBashResult.content.some((part) => part.text.includes('sandbox-bash'))) {
      throw new Error('sandbox_bash did not target the selected Vercel lease')
    }
    if ('sandbox' in (sandboxBash.parameters.properties as Record<string, unknown>)) {
      const { sandbox: _sandbox, ...sandboxBashProperties } = sandboxBash.parameters.properties as Record<string, unknown>
      if (!('command' in sandboxBashProperties)) throw new Error('sandbox_bash lost the canonical bash contract')
    }
    const canonicalBashAfter = await service.withPair(ownerId, second.handle, async (pair) => {
      const bash = buildHarnessAgentTools({
        workspace: pair.workspace,
        sandbox: pair.sandbox,
        fileSearch: { async search() { return [] } },
        bash: { kind: 'remote' },
        filesystem: { kind: 'remote-workspace' },
      } as RuntimeBundle).find((tool) => tool.name === 'bash')
      return JSON.stringify({ description: bash?.description, parameters: bash?.parameters })
    })
    if (canonicalBashAfter !== canonicalBashContract) throw new Error('sandbox plugin mutated canonical bash')

    phase = 'lease-pin-release'
    let unblock!: () => void
    const pin = new Promise<void>((resolve) => { unblock = resolve })
    const pinned = service.withPair(ownerId, first.handle, async () => await pin)
    await Promise.resolve()
    let released = false
    const release = releaseLease(first.handle, 'vercel-live-release-first').then(() => { released = true })
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (released) throw new Error('release deleted a Vercel lease beneath an active operation')
    unblock()
    await pinned
    await release
    await releaseLease(second.handle, 'vercel-live-release-second')

    for (const handle of handles) {
      await service.withPair(ownerId, handle, async () => undefined)
        .then(() => { throw new Error('released Vercel lease remained targetable') })
        .catch((error: unknown) => {
          if ((error as { code?: unknown }).code !== 'SANDBOX_LEASE_NOT_FOUND') throw error
        })
    }

    phase = 'remote-deletion-confirmation'
    for (const name of remoteNames) {
      try {
        const candidate = await Sandbox.get({ ...credentials, name, resume: false })
        await candidate.delete()
        throw new Error('released Vercel sandbox still existed and required smoke compensation')
      } catch (error) {
        const status = httpStatus(error)
        if (status !== 404 && status !== 410) throw error
      }
    }

    phase = 'provider-deadline-create'
    const deadlineProvider = createVercelSandboxProvider({
      lifecycle: 'disposable',
      timeoutMs: 10_000,
      snapshotExpirationMs: 24 * 60 * 60 * 1000,
      telemetrySalt,
      store,
      immutableSnapshotId: snapshot.snapshotId,
    })
    deadlineService = new SandboxLeaseService({
      workspaceRoot: join(tempDir, 'deadline-lease'),
      provider: deadlineProvider,
      providerWorkspaceId: workspaceId,
      serviceDigest: SERVICE_DIGEST,
      ttlMs: 60_000,
      reapIntervalMs: 60_000,
      drainTimeoutMs: 30_000,
      maxActiveLeasesPerOwner: 1,
      maxActiveLeasesTotal: 1,
      createHandle: () => deadlineHandle,
    })
    const deadlineTool = createSandboxManagementTool({
      leases: deadlineService,
      workspaceScopeId: workspaceId,
      agentTypeId: AGENT_TYPE_ID,
    })
    const deadlineCreate = await deadlineTool.execute(
      { op: 'create' },
      { ...toolContext, toolCallId: 'vercel-live-deadline-create' },
    )
    if (deadlineCreate.isError) throw new Error(`deadline create failed: ${JSON.stringify(deadlineCreate.details)}`)
    phase = 'provider-compute-deadline-check'
    const deadlineAt = Date.now() + 45_000
    let deadlineStatus: string | undefined
    while (Date.now() < deadlineAt) {
      const candidate = await Sandbox.get({ ...credentials, name: allRemoteNames[2]!, resume: false })
      deadlineStatus = candidate.status
      if (deadlineStatus === 'stopped') break
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    if (deadlineStatus !== 'stopped') {
      throw Object.assign(new Error('Vercel sandbox remained active after its provider deadline'), {
        code: 'PROVIDER_DEADLINE_ACTIVE',
      })
    }
    const deadlineRelease = await deadlineTool.execute(
      { op: 'release', sandbox: deadlineHandle },
      { ...toolContext, toolCallId: 'vercel-live-deadline-release' },
    )
    if (deadlineRelease.isError) throw new Error(`deadline release failed: ${JSON.stringify(deadlineRelease.details)}`)

    phase = 'completed'
    console.log(JSON.stringify({
      ok: true,
      leasesCreated: 2,
      immutableSnapshotInherited: true,
      isolatedMutableRoots: true,
      sandboxBashExec: true,
      releaseWaitedForPin: true,
      releasedLeasesUnavailable: true,
      remoteDeletionConfirmed: true,
      providerComputeDeadlineEnforced: true,
      providerSnapshotExpirationMs: 86_400_000,
      persistentHandleRecords: 0,
      durationMs: Date.now() - startedAt,
    }))
  } catch (error) {
    if (error && typeof error === 'object') Object.defineProperty(error, 'smokePhase', { value: phase })
    throw error
  } finally {
    if (deadlineService) {
      try { await deadlineService.dispose() } catch (error) { cleanupFailures.push(error) }
    }
    if (service) {
      try { await service.dispose() } catch (error) { cleanupFailures.push(error) }
    }
    for (const name of allRemoteNames) {
      try {
        const candidate = await Sandbox.get({ ...credentials, name, resume: false })
        await candidate.delete()
      } catch (error) {
        const status = httpStatus(error)
        if (status !== 404 && status !== 410) cleanupFailures.push(error)
      }
    }
    if (snapshot) {
      try { await snapshot.delete() } catch (error) { cleanupFailures.push(error) }
    }
    if (seed) {
      try { await seed.delete() } catch (error) {
        const status = httpStatus(error)
        if (status !== 404 && status !== 410) cleanupFailures.push(error)
      }
    }
    await rm(tempDir, { recursive: true, force: true })
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'Vercel lease smoke cleanup failed')
    }
  }
}

main().catch((error) => {
  const candidate = error as { code?: unknown; smokePhase?: unknown }
  console.error(JSON.stringify({
    ok: false,
    code: typeof candidate.code === 'string' ? candidate.code : 'SMOKE_FAILED',
    phase: typeof candidate.smokePhase === 'string' ? candidate.smokePhase : 'cleanup',
    status: httpStatus(error) ?? null,
    errorType: error instanceof Error ? error.name : typeof error,
  }))
  process.exitCode = 1
})
