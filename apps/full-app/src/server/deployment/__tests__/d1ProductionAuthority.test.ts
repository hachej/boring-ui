import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { D1CollectionController } from '../bootCollection.js'
import type { D1PendingPublicationV1 } from '../d1PublicationControl.js'
import { createD1ProductionAuthority } from '../d1ProductionAuthority.js'
import { D1HostErrorCode, type D1SiteBindingV1 } from '../d1Plan.js'
import { createD1RuntimeInputsIdentity } from '../d1RuntimeInputs.js'
import type { D1StoredCandidateV1, D1StoredCompleteV1 } from '../hostRevisionStore.js'

const digest = (value: string) => `sha256:${value.repeat(64)}` as const
const binding: D1SiteBindingV1 = { bindingId: 'one', hostname: 'one.example.test', workspaceId: 'workspace-one', defaultDeploymentId: 'deployment-one',
  bundleRef: 'bundle-one', deploymentRef: 'deployment-one', workspaceAllocationRef: 'allocation-one', sessionAllocationRef: 'session-one',
  ownerPrincipalRef: 'owner-one', landing: { title: 'One', summary: 'One' }, environmentRef: 'production', secretRefs: [] }
const desired = { schemaVersion: 1, domain: 'boring-d1-desired:v1', plan: { schemaVersion: 1, hostId: 'host-1', hostAppImageDigest: digest('f'),
  runtimeProfileRef: 'runsc', databaseRef: 'database', workspaceRootPolicyRef: 'workspaces', sessionRootPolicyRef: 'sessions', bindings: [binding] },
resolvedBindings: [{ schemaVersion: 1, bindingId: 'one' }] } as never
let input: Awaited<ReturnType<typeof createD1RuntimeInputsIdentity>>
const oldActive = { schemaVersion: 1 as const, revisionId: 'r0000000001', desiredStateDigest: digest('a') }
const targetActive = { schemaVersion: 1 as const, revisionId: 'r0000000002', desiredStateDigest: digest('b') }
const candidate = { revisionId: targetActive.revisionId, desired, desiredStateDigest: targetActive.desiredStateDigest, secretRefs: {} } as unknown as D1StoredCandidateV1
const complete = (active: typeof oldActive | typeof targetActive): D1StoredCompleteV1 => ({ ...candidate, revisionId: active.revisionId,
  desiredStateDigest: active.desiredStateDigest, observation: { bindings: [{ runtimeInputs: input }] }, completion: {} } as never)

beforeEach(async () => { input = await createD1RuntimeInputsIdentity(binding, { environment: { versionFingerprint: digest('1') },
  workspaceAllocation: { versionFingerprint: digest('2') }, sessionAllocation: { versionFingerprint: digest('3') }, secrets: [] }) })

function harness(start: typeof oldActive | typeof targetActive | null, initiallyServed: typeof oldActive | typeof targetActive | null = null) {
  let durable = start; let served = initiallyServed; let pending: D1PendingPublicationV1 | null = { schemaVersion: 1, operationId: 'operation-1',
    expectedRevision: oldActive.revisionId, expectedDigest: oldActive.desiredStateDigest, targetRevision: targetActive.revisionId,
    targetDigest: targetActive.desiredStateDigest, runtimeInputs: [input], rollback: null, state: 'prepared' }
  const preload = vi.fn(async () => ({ bindings: [] })); const serve = vi.fn(async (active: typeof oldActive) => { served = active; return active })
  const reproduce = vi.fn(async () => desired)
  const discardPrepared = vi.fn()
  const controller = { resolver: { resolvePlan: vi.fn(async () => desired), reproduce }, preload, serve,
    snapshot: () => served && ({ revisionId: served.revisionId, desiredStateDigest: served.desiredStateDigest }), read: vi.fn(), readRecipe: vi.fn(),
    settleRetirement: vi.fn(), discardPrepared } as unknown as D1CollectionController
  const store = { readActive: vi.fn(async () => durable), readCandidate: vi.fn(async () => candidate),
    readComplete: vi.fn(async (revision: string) => complete(revision === oldActive.revisionId ? oldActive : targetActive)) } as never
  const authority = createD1ProductionAuthority({ hostId: 'host-1', ownerUid: 0, dependencies: { store, servedCollection: controller,
    candidatePreloader: { prepare: vi.fn() }, readPending: async () => pending } })
  return { authority, preload, serve, reproduce, discardPrepared, setDurable(value: typeof oldActive | typeof targetActive | null) { durable = value },
    setPending(value: D1PendingPublicationV1 | null) { pending = value }, served: () => served }
}

describe('D1 production publication authority', () => {
  it('prepares without changing served state, then commits only the durable target', async () => {
    const h = harness(oldActive, oldActive)
    await expect(h.authority.prepare('operation-1')).resolves.toMatchObject({ durableRevision: oldActive.revisionId, servedRevision: oldActive.revisionId })
    expect(h.served()).toEqual(oldActive); expect(h.preload).toHaveBeenCalledTimes(1)
    await expect(h.authority.commit('operation-1')).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    h.setDurable(targetActive)
    await expect(h.authority.commit('operation-1')).resolves.toMatchObject({ durableRevision: targetActive.revisionId, servedRevision: targetActive.revisionId })
  })

  it('discards an exact prepared operation once across a lost acknowledgement retry', async () => {
    const h = harness(oldActive, oldActive); await h.authority.prepare('operation-1')
    await h.authority.discard('operation-1'); await h.authority.discard('operation-1')
    expect(h.discardPrepared).toHaveBeenCalledTimes(1); expect(h.discardPrepared).toHaveBeenCalledWith(targetActive)
  })

  it('passes the exact root-owned rollback authorization into the atomic serve', async () => {
    const h = harness(oldActive, oldActive); const rollback = { operationId: 'operation-1', hostId: 'host-1', expectedRevision: oldActive.revisionId,
      expectedDigest: oldActive.desiredStateDigest, targetRevision: targetActive.revisionId, targetDigest: targetActive.desiredStateDigest,
      removalBindingIds: ['removed'] }
    h.setPending({ schemaVersion: 1, ...rollback, runtimeInputs: [input], rollback, state: 'prepared' })
    await h.authority.prepare('operation-1'); h.setDurable(targetActive); await h.authority.commit('operation-1')
    expect(h.serve).toHaveBeenLastCalledWith(targetActive, { kind: 'rollback', authorization: rollback })
  })

  it.each([[oldActive, oldActive], [targetActive, targetActive]] as const)('converges valid pending restart tuple %#', async (durable, expectedServed) => {
    const h = harness(durable); await h.authority.recover(); expect(h.served()).toEqual(expectedServed)
    if (durable === oldActive) expect(h.preload).toHaveBeenCalledTimes(2)
  })

  it('recovers only an exact reproduction of the durable complete revision', async () => {
    const h = harness(targetActive); h.setPending(null); await h.authority.recover(); expect(h.served()).toEqual(targetActive)
    const drifted = harness(targetActive); drifted.setPending(null); drifted.reproduce.mockResolvedValueOnce({} as never)
    await expect(drifted.authority.recover()).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
  })

  it('fails closed on an unrelated durable tuple', async () => {
    const unrelated = { schemaVersion: 1 as const, revisionId: 'r0000000009', desiredStateDigest: digest('9') }
    await expect(harness(unrelated as never).authority.recover()).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
  })
})
