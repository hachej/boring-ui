import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import type { AgentCoreHarnessFactory } from '../../../shared/harness'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createScriptedPiHarness } from '../../testing/scriptedPiHarness'
import { createAgentHost } from '../createAgentHost'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import type { AgentRequestKey, CreateAgentHostOptions } from '../types'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function options(overrides: Partial<CreateAgentHostOptions> = {}) {
  const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-host-lifecycle-'))
  roots.push(sessionRoot)
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'agent-host-workspace-'))
  roots.push(workspaceRoot)
  const baseAdapter = createTestRuntimeModeAdapter('direct')
  const dispose = vi.fn(async () => baseAdapter.dispose?.())
  const runtimeModeAdapter = { ...baseAdapter, dispose }
  const value: CreateAgentHostOptions = {
    agents: [{ agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } }],
    fleetCompiler: { compile: async ({ agents }) => agents },
    hostId: 'lifecycle-host',
    scopeVerifier: { verify: async (scope) => ({ workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }) },
    runtimeModeAdapter,
    sessionRoot,
    shutdownGraceMs: 10,
    harnessFactory: createScriptedPiHarness as AgentCoreHarnessFactory,
    resolveRuntimeScope: async () => ({
      identity: 'runtime-a',
      environment: {
        placementIdentity: 'direct-a',
        workspaceRoot,
        provisioningFingerprint: 'provision-a',
      },
      sessionNamespace: 'alpha-a',
    }),
    ...overrides,
  }
  return { value, dispose }
}

const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope

function deferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = (value) => resolvePromise(value as T | PromiseLike<T>)
  })
  return { promise, resolve }
}

function createRequestKey(requestId: string): AgentRequestKey {
  return {
    workspaceScopeId: scope.workspaceScopeId,
    authSubjectId: scope.authSubjectId,
    operation: 'session.create',
    target: { kind: 'agent', agentTypeId: 'alpha' },
    requestId,
  }
}

async function expectBounded(operation: () => Promise<void>): Promise<void> {
  const before = Date.now()
  await operation()
  expect(Date.now() - before).toBeLessThan(250)
}

describe('Agent Host lifecycle', () => {
  it('closes active unbounded subscriptions and disposes bindings, Environment, and adapter once', async () => {
    const fixture = await options()
    const created = await createAgentHost(fixture.value)
    const ref = await created.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create' })
    const connection = await created.gateway.connectSession({ scope, ref })
    const pending = connection.events[Symbol.asyncIterator]().next()

    await Promise.all([created.host.close(), created.host.close()])
    await expect(pending).resolves.toMatchObject({ done: true })
    expect(fixture.dispose).toHaveBeenCalledOnce()
    await expect(created.gateway.listAgents({ scope })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
    })
  })

  it('bounds a stuck admitted effect by shutdownGraceMs and fences late completion', async () => {
    let admitStarted!: () => void
    const started = new Promise<void>((resolve) => { admitStarted = resolve })
    const fixture = await options({
      effectAdmission: {
        async admit() {
          admitStarted()
          return await new Promise<never>(() => {})
        },
      },
    })
    const created = await createAgentHost(fixture.value)
    void created.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'stuck' }).catch(() => {})
    await started
    const before = Date.now()
    await created.host.close()
    expect(Date.now() - before).toBeLessThan(250)
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })

  it('bounds adapter creation across drain and close, then disposes its late bundle exactly once', async () => {
    const fixture = await options()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const releaseCreate = deferred<void>()
    const createStarted = deferred<void>()
    const disposeRuntime = vi.fn(async () => {})
    const disposeAdapter = vi.fn(async () => {})
    const ledger = new InMemoryAgentRequestLedger()
    const created = await createAgentHost({
      ...fixture.value,
      requestLedger: ledger,
      runtimeModeAdapter: {
        ...baseAdapter,
        async create(ctx) {
          createStarted.resolve()
          await releaseCreate.promise
          const bundle = await baseAdapter.create(ctx)
          return { ...bundle, disposeRuntime }
        },
        dispose: disposeAdapter,
      },
    })
    const request = created.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'adapter-stuck' })
    request.catch(() => {})
    await createStarted.promise

    await expectBounded(() => created.host.drain())
    await expect(ledger.read(createRequestKey('adapter-stuck'))).resolves.toMatchObject({ state: 'outcome-unknown' })
    await expect(request).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED })
    await expectBounded(() => Promise.all([created.host.close(), created.host.close()]).then(() => {}))
    expect(disposeAdapter).toHaveBeenCalledOnce()

    releaseCreate.resolve()
    await vi.waitFor(() => expect(disposeRuntime).toHaveBeenCalledOnce())
    await created.host.close()
    expect(disposeRuntime).toHaveBeenCalledOnce()
    expect(disposeAdapter).toHaveBeenCalledOnce()
  })

  it('aborts and bounds non-cooperative provisioning across drain and close without double teardown', async () => {
    const fixture = await options()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const releaseProvision = deferred<void>()
    const provisionStarted = deferred<AbortSignal>()
    const disposeRuntime = vi.fn(async () => {})
    const disposeAdapter = vi.fn(async () => {})
    const created = await createAgentHost({
      ...fixture.value,
      runtimeModeAdapter: {
        ...baseAdapter,
        async create(ctx) {
          const bundle = await baseAdapter.create(ctx)
          return { ...bundle, disposeRuntime }
        },
        dispose: disposeAdapter,
      },
      resolveRuntimeScope: async () => ({
        identity: 'runtime-provision',
        environment: {
          placementIdentity: 'direct-provision',
          workspaceRoot: (await fixture.value.resolveRuntimeScope({ agentTypeId: 'alpha', scope })).environment.workspaceRoot,
          provisioningFingerprint: 'provision-stuck',
          async provisionRuntime({ signal }) {
            provisionStarted.resolve(signal)
            await releaseProvision.promise
          },
        },
        sessionNamespace: 'alpha-provision',
      }),
    })
    const request = created.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'provision-stuck' })
    request.catch(() => {})
    const signal = await provisionStarted.promise

    await expectBounded(() => created.host.drain())
    expect(signal.aborted).toBe(true)
    await expect(request).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED })
    await expectBounded(() => created.host.close())
    expect(disposeAdapter).toHaveBeenCalledOnce()

    releaseProvision.resolve()
    await vi.waitFor(() => expect(disposeRuntime).toHaveBeenCalledOnce())
    await Promise.all([created.host.drain(), created.host.close()])
    expect(disposeRuntime).toHaveBeenCalledOnce()
    expect(disposeAdapter).toHaveBeenCalledOnce()
  })

  it('bounds pending harness composition across drain and close and fences its late generation', async () => {
    const fixture = await options()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const releaseHarness = deferred<void>()
    const harnessStarted = deferred<void>()
    const disposeRuntime = vi.fn(async () => {})
    const disposeAdapter = vi.fn(async () => {})
    const harnessFactory: AgentCoreHarnessFactory = async (input) => {
      harnessStarted.resolve()
      await releaseHarness.promise
      return await createScriptedPiHarness(input)
    }
    const created = await createAgentHost({
      ...fixture.value,
      harnessFactory,
      runtimeModeAdapter: {
        ...baseAdapter,
        async create(ctx) {
          const bundle = await baseAdapter.create(ctx)
          return { ...bundle, disposeRuntime }
        },
        dispose: disposeAdapter,
      },
    })
    const request = created.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'harness-stuck' })
    request.catch(() => {})
    await harnessStarted.promise

    await expectBounded(() => created.host.drain())
    await expect(request).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED })
    await expectBounded(() => created.host.close())
    expect(disposeRuntime).toHaveBeenCalledOnce()
    expect(disposeAdapter).toHaveBeenCalledOnce()

    releaseHarness.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await Promise.all([created.host.drain(), created.host.close()])
    expect(disposeRuntime).toHaveBeenCalledOnce()
    expect(disposeAdapter).toHaveBeenCalledOnce()
    await expect(created.gateway.listAgents({ scope })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
    })
  })

  it('keeps gateway.close facade-local and idempotent', async () => {
    const fixture = await options()
    const created = await createAgentHost(fixture.value)
    await Promise.all([created.gateway.close(), created.gateway.close()])
    expect((await created.host.describe()).draining).toBe(false)
    await created.host.close()
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })
})
