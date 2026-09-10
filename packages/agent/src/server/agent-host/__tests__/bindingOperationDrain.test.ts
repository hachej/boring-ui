import { expect, it, vi } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createAgentHost, type AgentHostRuntime } from '../createAgentHost'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

it('releases every queued binding operation when drain starts during its predecessor', async () => {
  const created = await createAgentHost({
    agents: [{ agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } }],
    fleetCompiler: { compile: async ({ agents }) => agents },
    hostId: 'binding-operation-drain',
    inMemoryRequestLedgerMode: 'test',
    scopeVerifier: { verify: async (scope) => ({ workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }) },
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    resolveAuthorizedEnvironmentScope: async () => ({
      placementIdentity: 'direct-a',
      workspaceRoot: process.cwd(),
      provisioningFingerprint: 'provision-a',
    }),
    resolveAuthorizedAgentRuntimeScope: async () => ({
      identity: 'runtime-a',
      physicalBindingIdentity: 'runtime-a',
      resourceInputDigest: 'runtime-a',
      sessionNamespace: 'alpha-a',
    }),
  })
  // Observe the actual Host queue: gateway receipts can settle via the ledger
  // during drain even when a queued operation itself never releases its tail.
  const runtime = (created.gateway as unknown as { runtime: AgentHostRuntime }).runtime
  const started = deferred()
  const release = deferred()
  const mutateProvider = vi.fn(async () => {
    started.resolve()
    await release.promise
    return 'completed'
  })
  try {
    const first = runtime.runBindingOperation('binding-a', mutateProvider)
    await started.promise
    const operations = [
      first,
      runtime.runBindingOperation('binding-a', mutateProvider),
      runtime.runBindingOperation('binding-a', mutateProvider),
    ]
    const outcomes: Array<PromiseSettledResult<string> | undefined> = operations.map(() => undefined)
    operations.forEach((operation, index) => {
      void operation.then(
        (value) => { outcomes[index] = { status: 'fulfilled', value } },
        (reason) => { outcomes[index] = { status: 'rejected', reason } },
      )
    })

    await created.host.drain()
    expect(mutateProvider).toHaveBeenCalledOnce()
    release.resolve()

    await vi.waitFor(() => expect(outcomes.map((outcome) => outcome?.status)).toEqual([
      'fulfilled', 'rejected', 'rejected',
    ]))
    expect(outcomes[0]).toEqual({ status: 'fulfilled', value: 'completed' })
    for (const outcome of outcomes.slice(1)) {
      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: { code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED },
      })
    }
    expect(mutateProvider).toHaveBeenCalledOnce()
  } finally {
    release.resolve()
    await created.host.close()
  }
})
