import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGatewayAcceptedWorkContext } from '../acceptedWork'
import { DurableAcceptedWorkQueue } from '../durableAcceptedWorkQueue'

const roots: string[] = []
function path() { const root = mkdtempSync(join(tmpdir(), 'accepted-queue-')); roots.push(root); return join(root, 'queue.sqlite') }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function accepted(subject = 'user-1', seatId?: string, agentTypeId = 'alpha') {
  return createGatewayAcceptedWorkContext({
    key: {
      workspaceScopeId: 'workspace-1', authSubjectId: subject, operation: 'session.followup', requestId: 'request-1',
      target: { kind: 'session', ref: { agentTypeId, sessionId: 'session-1' } },
    },
    admittedAgentTypeId: agentTypeId,
    ...(seatId ? { seat: { seatId } } : {}),
  })
}
const material = { kind: 'followup', content: 'durable prompt', clientSeq: 4 }

describe('DurableAcceptedWorkQueue', () => {
  it('persists immutable prompt/follow-up material and provenance across process restart', () => {
    const file = path()
    const first = new DurableAcceptedWorkQueue(file)
    first.enqueue({ id: 'work-1', acceptedWork: accepted(), request: material, admissionFingerprint: 'agent-def-v1' })
    first.close()
    const reopened = new DurableAcceptedWorkQueue(file)
    const record = reopened.read('work-1')!
    expect(record).toMatchObject({ state: 'queued', request: material, admissionFingerprint: 'agent-def-v1' })
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.acceptedWork.identity)).toBe(true)
    reopened.close()
  })

  it.each([
    ['standalone', undefined],
    ['first seat', 'seat-a'],
    ['second seat', 'seat-b'],
  ])('freshly readmits retained %s authority', async (_name, seatId) => {
    const queue = new DurableAcceptedWorkQueue(path())
    const context = accepted('user-1', seatId)
    queue.enqueue({ id: 'work-1', acceptedWork: context, request: material, admissionFingerprint: 'agent-def-v1' })
    const claim = await queue.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'agent-def-v1' }))
    expect(claim?.record.state).toBe('claimed')
    queue.complete('work-1', claim!.claimToken)
    expect(queue.read('work-1')?.state).toBe('completed')
    queue.close()
  })

  it.each([
    ['revoked authority', async () => { throw new Error('access revoked') }],
    ['changed subject', async () => ({ acceptedWork: accepted('user-2'), admissionFingerprint: 'agent-def-v1' })],
    ['changed seat', async () => ({ acceptedWork: accepted('user-1', 'seat-b'), admissionFingerprint: 'agent-def-v1' })],
    ['changed agent definition', async () => ({ acceptedWork: accepted('user-1', 'seat-a'), admissionFingerprint: 'agent-def-v2' })],
    ['changed request identity', async () => ({
      acceptedWork: createGatewayAcceptedWorkContext({
        key: {
          workspaceScopeId: 'workspace-1', authSubjectId: 'user-1', operation: 'session.followup', requestId: 'request-2',
          target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-1' } },
        },
        admittedAgentTypeId: 'alpha', seat: { seatId: 'seat-a' },
      }),
      admissionFingerprint: 'agent-def-v1',
    })],
  ])('fails closed with auditable provenance for %s', async (_name, readmit) => {
    const queue = new DurableAcceptedWorkQueue(path())
    const historical = accepted('user-1', 'seat-a')
    queue.enqueue({ id: 'work-1', acceptedWork: historical, request: material, admissionFingerprint: 'agent-def-v1' })
    expect(await queue.claimNext(readmit)).toBeUndefined()
    const rejected = queue.read('work-1')!
    expect(rejected.state).toBe('rejected')
    expect(rejected.terminalReason).toBeTruthy()
    expect(rejected.acceptedWork).toEqual(historical)
    expect(rejected.request).toEqual(material)
    queue.close()
  })

  it('allows only one claimant and rejects duplicate/stale completion', async () => {
    const file = path()
    const left = new DurableAcceptedWorkQueue(file)
    const right = new DurableAcceptedWorkQueue(file)
    const context = accepted()
    left.enqueue({ id: 'work-1', acceptedWork: context, request: material, admissionFingerprint: 'v1' })
    const [a, b] = await Promise.all([
      left.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'v1' })),
      right.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'v1' })),
    ])
    const claims = [a, b].filter(Boolean)
    expect(claims).toHaveLength(1)
    left.complete('work-1', claims[0]!.claimToken)
    expect(() => right.complete('work-1', claims[0]!.claimToken)).toThrow('stale')
    left.close(); right.close()
  })

  it('does not mistake another live handle for process restart', async () => {
    const file = path()
    const context = accepted()
    const claimant = new DurableAcceptedWorkQueue(file)
    claimant.enqueue({ id: 'work-1', acceptedWork: context, request: material, admissionFingerprint: 'v1' })
    const claim = await claimant.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'v1' }))
    const observer = new DurableAcceptedWorkQueue(file)
    expect(observer.read('work-1')?.state).toBe('claimed')
    claimant.complete('work-1', claim!.claimToken)
    claimant.close(); observer.close()
  })

  it('marks a claimed item outcome-unknown after queue restart instead of executing twice', async () => {
    const file = path()
    const context = accepted()
    const first = new DurableAcceptedWorkQueue(file)
    first.enqueue({ id: 'work-1', acceptedWork: context, request: material, admissionFingerprint: 'v1' })
    expect(await first.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'v1' }))).toBeTruthy()
    first.close()
    const reopened = new DurableAcceptedWorkQueue(file)
    expect(reopened.read('work-1')).toMatchObject({
      state: 'outcome-unknown', terminalReason: 'queue closed while work was claimed', request: material,
    })
    expect(await reopened.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'v1' }))).toBeUndefined()
    reopened.close()
  })

  it('preserves unknown outcome terminally and never readmits it', async () => {
    const queue = new DurableAcceptedWorkQueue(path())
    const context = accepted()
    queue.enqueue({ id: 'work-1', acceptedWork: context, request: material, admissionFingerprint: 'v1' })
    const claim = await queue.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'v1' }))
    queue.markOutcomeUnknown('work-1', claim!.claimToken, 'worker disconnected after dispatch')
    expect(queue.read('work-1')).toMatchObject({ state: 'outcome-unknown', terminalReason: 'worker disconnected after dispatch' })
    expect(await queue.claimNext(async () => ({ acceptedWork: context, admissionFingerprint: 'v1' }))).toBeUndefined()
    queue.close()
  })

  it('makes enqueue idempotent only for identical immutable material', () => {
    const queue = new DurableAcceptedWorkQueue(path())
    const input = { id: 'work-1', acceptedWork: accepted(), request: material, admissionFingerprint: 'v1' }
    expect(queue.enqueue(input)).toEqual(queue.enqueue(input))
    expect(() => queue.enqueue({ ...input, request: { ...material, content: 'forged' } })).toThrow('conflicts')
    queue.close()
  })
})
