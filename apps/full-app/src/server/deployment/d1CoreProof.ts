import { createAgentAssetDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { RUNTIME_ISOLATION_PROBE_IDS, verifyDockerRuntimeIsolationEvidence } from '@hachej/boring-sandbox/providers/runsc'

import type { D1ActiveCollectionReader } from './activeCollectionReader.js'
import { assertD1ExactKeys, d1Digest, D1HostError, D1HostErrorCode, strictD1Ref } from './d1Plan.js'

const REVISION = /^r\d{10}$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface D1CoreProofBindingV1 {
  readonly bindingId: string
  readonly bindingIdDigest: Sha256Digest
  readonly hostnameDigest: Sha256Digest
  readonly workspaceIdDigest: Sha256Digest
  readonly runtimeProfileId: 'runsc'
  readonly runtimeProfileContentDigest: Sha256Digest
  readonly isolationAttestationDigest: Sha256Digest
  readonly bundleDigest: Sha256Digest
  readonly compositionDigest: Sha256Digest
  readonly deploymentDigest: Sha256Digest
  readonly resolvedDigest: Sha256Digest
  readonly runtimeInputsDigest: Sha256Digest
}
export interface D1CoreProofRevisionV1 {
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly coreImageDigest: Sha256Digest
  readonly bindings: readonly D1CoreProofBindingV1[]
}
export interface D1CoreProofReportV1 {
  readonly schemaVersion: 1
  readonly status: 'pass'
  readonly coreImageDigest: Sha256Digest
  readonly revisions: Readonly<{
    initial: string
    nPlusOne: string
    rollback: string
  }>
  readonly bindings: Readonly<{ initial: 3; nPlusOne: 4; rollback: 3 }>
  readonly isolation: Readonly<{
    evidenceDigest: Sha256Digest
    testSuiteDigest: Sha256Digest
  }>
  readonly timing: Readonly<{
    totalSeconds: number
    targetSeconds: 900
    targetMet: boolean
  }>
  readonly dr: Readonly<{
    rpoSeconds: number
    rtoSeconds: number
    ingressStarts: 0
  }>
  readonly redaction: Readonly<{
    containsSecrets: false
    containsRawPaths: false
  }>
}

function failed(): never {
  throw new D1HostError(D1HostErrorCode.PROOF_INVALID, { field: 'proof' })
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    assertD1ExactKeys(value, keys, 'proof')
    return value
  } catch {
    failed()
  }
}
function digest(value: unknown): Sha256Digest {
  try {
    return d1Digest(value, 'proof')
  } catch {
    failed()
  }
}
function ref(value: unknown): string {
  try {
    return strictD1Ref(value, 'proof')
  } catch {
    failed()
  }
}
function revision(value: unknown): string {
  if (typeof value !== 'string' || !REVISION.test(value)) failed()
  return value
}
function count(value: unknown, positive = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (positive ? 1 : 0)) failed()
  return value as number
}
function duration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) failed()
  return value
}
function positiveDuration(value: unknown): number {
  const result = duration(value)
  if (result === 0) failed()
  return result
}
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) failed()
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) failed()
  return parsed
}
function truth(value: unknown): true {
  if (value !== true) failed()
  return true
}
function falsity(value: unknown): false {
  if (value !== false) failed()
  return false
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
function later(left: string, right: string): boolean {
  return Number(right.slice(1)) > Number(left.slice(1))
}

async function identityDigest(domain: string, value: string): Promise<Sha256Digest> {
  return createAgentAssetDigest(JSON.stringify({ domain, value }))
}
export async function createD1CoreProofBindingIdDigest(value: string): Promise<Sha256Digest> {
  return identityDigest('boring-d1-proof-binding:v1', ref(value))
}
export async function createD1CoreProofOperationIdDigest(value: string): Promise<Sha256Digest> {
  return identityDigest('boring-d1-proof-operation:v1', ref(value))
}

/** Captures only redacted identities from the same served authority used by live D1 requests. */
export async function captureD1CoreProofRevision(reader: D1ActiveCollectionReader): Promise<D1CoreProofRevisionV1> {
  try {
    const collection = await reader.read()
    if (!collection) failed()
    const bindings = await Promise.all(
      collection.desired.plan.bindings.map(async (binding) => {
        const resolved = collection.desired.resolvedBindings.filter((value) => value.bindingId === binding.bindingId)
        const observed = collection.observation.bindings.filter((value) => value.bindingId === binding.bindingId)
        if (resolved.length !== 1 || observed.length !== 1) failed()
        const value = resolved[0]!
        if (value.composition.snapshot.runtimeProfile.id !== 'runsc') failed()
        return Object.freeze({
          bindingId: binding.bindingId,
          bindingIdDigest: await createD1CoreProofBindingIdDigest(binding.bindingId),
          hostnameDigest: await identityDigest('boring-d1-proof-hostname:v1', binding.hostname),
          workspaceIdDigest: await identityDigest('boring-d1-proof-workspace:v1', binding.workspaceId),
          runtimeProfileId: 'runsc' as const,
          runtimeProfileContentDigest: value.composition.snapshot.runtimeProfile.contentDigest,
          isolationAttestationDigest: value.composition.snapshot.runtimeProfile.isolationAttestationDigest,
          bundleDigest: value.definition.digest,
          compositionDigest: value.composition.digest,
          deploymentDigest: value.deployment.digest,
          resolvedDigest: value.resolvedDigest,
          runtimeInputsDigest: observed[0]!.runtimeInputs.digest,
        })
      }),
    )
    bindings.sort((left, right) => (left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0))
    return Object.freeze({
      revisionId: collection.active.revisionId,
      desiredStateDigest: collection.active.desiredStateDigest,
      coreImageDigest: collection.desired.plan.hostAppImageDigest,
      bindings: Object.freeze(bindings),
    })
  } catch (error) {
    if (error instanceof D1HostError && error.code === D1HostErrorCode.PROOF_INVALID) throw error
    failed()
  }
}

async function binding(raw: unknown): Promise<D1CoreProofBindingV1> {
  const value = record(raw, [
    'bindingId', 'bindingIdDigest', 'hostnameDigest', 'workspaceIdDigest', 'runtimeProfileId', 'runtimeProfileContentDigest',
    'isolationAttestationDigest', 'bundleDigest', 'compositionDigest', 'deploymentDigest', 'resolvedDigest', 'runtimeInputsDigest',
  ])
  const bindingId = ref(value.bindingId)
  const bindingIdDigest = digest(value.bindingIdDigest)
  if (bindingIdDigest !== await createD1CoreProofBindingIdDigest(bindingId)) failed()
  return Object.freeze({
    bindingId,
    bindingIdDigest,
    hostnameDigest: digest(value.hostnameDigest),
    workspaceIdDigest: digest(value.workspaceIdDigest),
    runtimeProfileId: value.runtimeProfileId === 'runsc' ? 'runsc' : failed(),
    runtimeProfileContentDigest: digest(value.runtimeProfileContentDigest),
    isolationAttestationDigest: digest(value.isolationAttestationDigest),
    bundleDigest: digest(value.bundleDigest),
    compositionDigest: digest(value.compositionDigest),
    deploymentDigest: digest(value.deploymentDigest),
    resolvedDigest: digest(value.resolvedDigest),
    runtimeInputsDigest: digest(value.runtimeInputsDigest),
  })
}
async function snapshot(raw: unknown): Promise<D1CoreProofRevisionV1> {
  const value = record(raw, ['revisionId', 'desiredStateDigest', 'coreImageDigest', 'bindings'])
  if (!Array.isArray(value.bindings)) failed()
  const bindings = await Promise.all(value.bindings.map(binding))
  if (new Set(bindings.map((item) => item.bindingId)).size !== bindings.length || bindings.some((item, index) => index > 0 && bindings[index - 1]!.bindingId >= item.bindingId)) failed()
  return Object.freeze({
    revisionId: revision(value.revisionId),
    desiredStateDigest: digest(value.desiredStateDigest),
    coreImageDigest: digest(value.coreImageDigest),
    bindings: Object.freeze(bindings),
  })
}
function check(raw: unknown, outcome: 'allowed' | 'denied', code: string | null) {
  const ordered = outcome === 'allowed'
  const value = record(raw, ['outcome', 'code', 'effectsBefore', 'effectsAfter', 'admissionsBefore', 'admissionsAfter', ...(ordered ? ['admissionCommittedAt', 'effectStartedAt'] : [])])
  if (value.outcome !== outcome || value.code !== code) failed()
  if (ordered && timestamp(value.admissionCommittedAt) >= timestamp(value.effectStartedAt)) failed()
  return {
    effectsBefore: count(value.effectsBefore),
    effectsAfter: count(value.effectsAfter),
    admissionsBefore: count(value.admissionsBefore),
    admissionsAfter: count(value.admissionsAfter),
  }
}
function authorization(raw: unknown, initial: D1CoreProofRevisionV1): void {
  if (!Array.isArray(raw) || raw.length !== initial.bindings.length) failed()
  const expected = initial.bindings.map((value) => value.bindingId)
  const crossTargets: string[] = []
  const actual = raw.map((item) => {
    const value = record(item, ['bindingId', 'crossBindingId', 'member', 'nonMember', 'crossBinding'])
    const bindingId = ref(value.bindingId)
    const crossBindingId = ref(value.crossBindingId)
    if (bindingId === crossBindingId || !expected.includes(crossBindingId)) failed()
    crossTargets.push(crossBindingId)
    const member = check(value.member, 'allowed', null)
    const nonMember = check(value.nonMember, 'denied', 'not_member')
    const cross = check(value.crossBinding, 'denied', D1HostErrorCode.HOST_SCOPE_VIOLATION)
    if (
      member.effectsAfter !== member.effectsBefore + 1 ||
      member.admissionsAfter !== member.admissionsBefore + 1 ||
      nonMember.effectsBefore !== member.effectsAfter ||
      nonMember.effectsAfter !== nonMember.effectsBefore ||
      nonMember.admissionsBefore !== member.admissionsAfter ||
      nonMember.admissionsAfter !== nonMember.admissionsBefore ||
      cross.effectsBefore !== nonMember.effectsAfter ||
      cross.effectsAfter !== cross.effectsBefore ||
      cross.admissionsBefore !== nonMember.admissionsAfter ||
      cross.admissionsAfter !== cross.admissionsBefore
    ) failed()
    return bindingId
  })
  if (!same(actual, expected) || !same(crossTargets.sort(), expected)) failed()
}
function continuity(
  raw: unknown,
  inflight: true,
): Readonly<{
  before: Sha256Digest
  after: Sha256Digest
  restartBefore: number
  restartAfter: number
  ingressBefore: Sha256Digest
  ingressAfter: Sha256Digest
  ingressRestartBefore: number
  ingressRestartAfter: number
  mutations: number
  bindingId: string
  completed: true
  reconnect: Sha256Digest
}>
function continuity(
  raw: unknown,
  inflight: false,
): Readonly<{
  before: Sha256Digest
  after: Sha256Digest
  restartBefore: number
  restartAfter: number
  ingressBefore: Sha256Digest
  ingressAfter: Sha256Digest
  ingressRestartBefore: number
  ingressRestartAfter: number
  mutations: number
}>
function continuity(raw: unknown, inflight: boolean) {
  const keys = [
    'coreProcessDigestBefore', 'coreProcessDigestAfter', 'restartCountBefore', 'restartCountAfter',
    'ingressProcessDigestBefore', 'ingressProcessDigestAfter', 'ingressRestartCountBefore', 'ingressRestartCountAfter',
    'composeServiceMutationCount', ...(inflight ? ['inFlightBindingId', 'inFlightCompleted', 'reconnectResolvedDigest'] : []),
  ]
  const value = record(raw, keys)
  const result = {
    before: digest(value.coreProcessDigestBefore),
    after: digest(value.coreProcessDigestAfter),
    restartBefore: count(value.restartCountBefore),
    restartAfter: count(value.restartCountAfter),
    ingressBefore: digest(value.ingressProcessDigestBefore),
    ingressAfter: digest(value.ingressProcessDigestAfter),
    ingressRestartBefore: count(value.ingressRestartCountBefore),
    ingressRestartAfter: count(value.ingressRestartCountAfter),
    mutations: count(value.composeServiceMutationCount),
  }
  if (result.before !== result.after || result.restartBefore !== result.restartAfter || result.ingressBefore !== result.ingressAfter
    || result.ingressRestartBefore !== result.ingressRestartAfter || result.mutations !== 0) failed()
  return inflight
    ? {
        ...result,
        bindingId: ref(value.inFlightBindingId),
        completed: truth(value.inFlightCompleted),
        reconnect: digest(value.reconnectResolvedDigest),
      }
    : result
}
function isolation(raw: unknown): {
  evidenceDigest: Sha256Digest
  testSuiteDigest: Sha256Digest
} {
  const value = record(raw, ['schemaVersion', 'domain', 'profile', 'profileDigest', 'testSuiteDigest', 'probes', 'positiveControls', 'coldStartLatency', 'redaction', 'evidenceDigest'])
  const verification = verifyDockerRuntimeIsolationEvidence(raw, value.profile, value.testSuiteDigest)
  if (verification.status !== 'accepted') failed()
  const probes = record(value.probes, RUNTIME_ISOLATION_PROBE_IDS)
  for (const id of RUNTIME_ISOLATION_PROBE_IDS) if (record(probes[id], ['status']).status !== 'passed') failed()
  return {
    evidenceDigest: digest(verification.evidenceDigest),
    testSuiteDigest: digest(value.testSuiteDigest),
  }
}
// These are redacted operator-attested fingerprints. Host-origin authenticity and artifact attestation are deliberately deferred to tz4.
function drIdentity(raw: unknown) {
  const value = record(raw, [
    'hostIdentityDigest', 'admissionHistoryDigest', 'admissionRows', 'admittedBindingDigests', 'journalHistoryDigest', 'journalRows', 'membershipDigest', 'membershipRows',
    'revisionHistoryDigest', 'revisionRows', 'completeRevisions', 'destructivePublications', 'activeDesiredStateDigest', 'stateRootDigest', 'workspaceRootDigest', 'workspaceDataDigest', 'sessionRootDigest', 'sessionHistoryDigest',
  ])
  if (!Array.isArray(value.admittedBindingDigests) || !Array.isArray(value.completeRevisions) || !Array.isArray(value.destructivePublications)) failed()
  const admittedBindingDigests = value.admittedBindingDigests.map(digest)
  if (new Set(admittedBindingDigests).size !== admittedBindingDigests.length
    || admittedBindingDigests.some((item, index) => index > 0 && admittedBindingDigests[index - 1]! >= item)) failed()
  const completeRevisions = value.completeRevisions.map((rawRevision) => {
    const revisionValue = record(rawRevision, ['revisionId', 'desiredStateDigest'])
    return Object.freeze({ revisionId: revision(revisionValue.revisionId), desiredStateDigest: digest(revisionValue.desiredStateDigest) })
  })
  if (new Set(completeRevisions.map((item) => item.revisionId)).size !== completeRevisions.length
    || completeRevisions.some((item, index) => index > 0 && completeRevisions[index - 1]!.revisionId >= item.revisionId)) failed()
  const destructivePublications = value.destructivePublications.map((rawPublication) => {
    const publication = record(rawPublication, [
      'operationIdDigest', 'state', 'expectedRevisionId', 'expectedDesiredStateDigest', 'publicationRevisionId',
      'publicationDesiredStateDigest', 'requestedTargetRevisionId', 'requestedTargetDesiredStateDigest', 'removalBindingDigests',
    ])
    if (publication.state !== 'committed' || !Array.isArray(publication.removalBindingDigests)
      || (publication.requestedTargetRevisionId === null) !== (publication.requestedTargetDesiredStateDigest === null)) failed()
    const removalBindingDigests = publication.removalBindingDigests.map(digest)
    if (removalBindingDigests.length === 0 || new Set(removalBindingDigests).size !== removalBindingDigests.length
      || removalBindingDigests.some((item, index) => index > 0 && removalBindingDigests[index - 1]! >= item)) failed()
    return Object.freeze({
      operationIdDigest: digest(publication.operationIdDigest), state: 'committed' as const,
      expectedRevisionId: revision(publication.expectedRevisionId), expectedDesiredStateDigest: digest(publication.expectedDesiredStateDigest),
      requestedTargetRevisionId: publication.requestedTargetRevisionId === null ? null : revision(publication.requestedTargetRevisionId),
      requestedTargetDesiredStateDigest: publication.requestedTargetDesiredStateDigest === null ? null : digest(publication.requestedTargetDesiredStateDigest),
      publicationRevisionId: revision(publication.publicationRevisionId), publicationDesiredStateDigest: digest(publication.publicationDesiredStateDigest),
      removalBindingDigests: Object.freeze(removalBindingDigests),
    })
  })
  if (new Set(destructivePublications.map((item) => item.operationIdDigest)).size !== destructivePublications.length
    || destructivePublications.some((item, index) => index > 0 && destructivePublications[index - 1]!.operationIdDigest >= item.operationIdDigest)) failed()
  return Object.freeze({
    hostIdentityDigest: digest(value.hostIdentityDigest),
    admissionHistoryDigest: digest(value.admissionHistoryDigest),
    admissionRows: count(value.admissionRows, true),
    admittedBindingDigests: Object.freeze(admittedBindingDigests),
    journalHistoryDigest: digest(value.journalHistoryDigest),
    journalRows: count(value.journalRows, true),
    membershipDigest: digest(value.membershipDigest),
    membershipRows: count(value.membershipRows, true),
    revisionHistoryDigest: digest(value.revisionHistoryDigest),
    revisionRows: count(value.revisionRows, true),
    completeRevisions: Object.freeze(completeRevisions),
    destructivePublications: Object.freeze(destructivePublications),
    activeDesiredStateDigest: digest(value.activeDesiredStateDigest),
    stateRootDigest: digest(value.stateRootDigest),
    workspaceRootDigest: digest(value.workspaceRootDigest),
    workspaceDataDigest: digest(value.workspaceDataDigest),
    sessionRootDigest: digest(value.sessionRootDigest),
    sessionHistoryDigest: digest(value.sessionHistoryDigest),
  })
}

export async function verifyD1CoreProof(raw: unknown, liveIsolationEvidence: unknown): Promise<D1CoreProofReportV1> {
  try {
    const value = record(raw, ['schemaVersion', 'domain', 'initial', 'authorization', 'nPlusOne', 'rollback', 'timing', 'dr', 'redaction'])
    if (value.schemaVersion !== 1 || value.domain !== 'boring-d1-core-proof:v1') failed()
    const initial = await snapshot(value.initial)
    if (initial.bindings.length !== 3) failed()
    for (const key of ['bindingIdDigest', 'hostnameDigest', 'workspaceIdDigest', 'compositionDigest', 'resolvedDigest'] as const) {
      if (new Set(initial.bindings.map((item) => item[key])).size !== 3) failed()
    }

    authorization(value.authorization, initial)

    const add = record(value.nPlusOne, ['revision', 'continuity'])
    const nPlusOne = await snapshot(add.revision)
    if (nPlusOne.bindings.length !== 4 || nPlusOne.coreImageDigest !== initial.coreImageDigest
      || nPlusOne.desiredStateDigest === initial.desiredStateDigest || !later(initial.revisionId, nPlusOne.revisionId)) failed()
    const retained = nPlusOne.bindings.filter((item) => initial.bindings.some((prior) => prior.bindingId === item.bindingId))
    const additions = nPlusOne.bindings.filter((item) => !initial.bindings.some((prior) => prior.bindingId === item.bindingId))
    if (!same(retained, initial.bindings) || additions.length !== 1) failed()
    const addContinuity = continuity(add.continuity, true)
    const inFlight = initial.bindings.find((item) => item.bindingId === addContinuity.bindingId)
    const reconnected = nPlusOne.bindings.find((item) => item.bindingId === addContinuity.bindingId)
    if (!inFlight || !reconnected || addContinuity.reconnect !== inFlight.resolvedDigest || reconnected.resolvedDigest !== inFlight.resolvedDigest) failed()

    const rollbackValue = record(value.rollback, ['revision', 'authorization', 'removedBindingId', 'removedBindingAdmitted', 'continuity'])
    const rollbackAuthorization = record(rollbackValue.authorization, [
      'operationIdDigest', 'expectedRevisionId', 'expectedDesiredStateDigest', 'requestedTargetRevisionId', 'requestedTargetDesiredStateDigest',
      'publicationRevisionId', 'publicationDesiredStateDigest',
    ])
    const rollbackOperationIdDigest = digest(rollbackAuthorization.operationIdDigest)
    if (revision(rollbackAuthorization.expectedRevisionId) !== nPlusOne.revisionId
      || digest(rollbackAuthorization.expectedDesiredStateDigest) !== nPlusOne.desiredStateDigest
      || revision(rollbackAuthorization.requestedTargetRevisionId) !== initial.revisionId
      || digest(rollbackAuthorization.requestedTargetDesiredStateDigest) !== initial.desiredStateDigest) failed()
    const rollback = await snapshot(rollbackValue.revision)
    if (revision(rollbackAuthorization.publicationRevisionId) !== rollback.revisionId
      || digest(rollbackAuthorization.publicationDesiredStateDigest) !== rollback.desiredStateDigest) failed()
    const removed = ref(rollbackValue.removedBindingId)
    falsity(rollbackValue.removedBindingAdmitted)
    if (!later(nPlusOne.revisionId, rollback.revisionId) || rollback.bindings.length !== 3 || rollback.coreImageDigest !== initial.coreImageDigest
      || rollback.desiredStateDigest !== initial.desiredStateDigest || !same(rollback.bindings, initial.bindings)
      || removed !== additions[0]!.bindingId) failed()
    const rollbackContinuity = continuity(rollbackValue.continuity, false)
    if (rollbackContinuity.before !== addContinuity.after || rollbackContinuity.restartBefore !== addContinuity.restartAfter
      || rollbackContinuity.ingressBefore !== addContinuity.ingressAfter
      || rollbackContinuity.ingressRestartBefore !== addContinuity.ingressRestartAfter) failed()

    const timing = record(value.timing, ['targetSeconds', 'totalSeconds', 'stages'])
    if (timing.targetSeconds !== 900 || !Array.isArray(timing.stages) || timing.stages.length !== 2) failed()
    const totalSeconds = duration(timing.totalSeconds)
    const expectedStageNames = ['apply-three', 'first-success']
    let stageSeconds = 0
    let firstStarted = 0
    let priorCompleted = 0
    for (const [index, rawStage] of timing.stages.entries()) {
      const stage = record(rawStage, ['name', 'startedAt', 'completedAt', 'seconds'])
      if (ref(stage.name) !== expectedStageNames[index]) failed()
      const startedAt = timestamp(stage.startedAt)
      const completedAt = timestamp(stage.completedAt)
      const seconds = positiveDuration(stage.seconds)
      if (completedAt <= startedAt || Math.abs(seconds - (completedAt - startedAt) / 1000) > 0.001
        || (index > 0 && startedAt !== priorCompleted)) failed()
      if (index === 0) firstStarted = startedAt
      priorCompleted = completedAt
      stageSeconds += seconds
    }
    if (Math.abs(totalSeconds - stageSeconds) > 0.001 || Math.abs(totalSeconds - (priorCompleted - firstStarted) / 1000) > 0.001) failed()

    const dr = record(value.dr, ['offline', 'ingressStarts', 'source', 'restored', 'readableSessions', 'rpoSeconds', 'rtoSeconds'])
    truth(dr.offline)
    if (count(dr.ingressStarts) !== 0 || count(dr.readableSessions, true) < 1) failed()
    const source = drIdentity(dr.source)
    const restored = drIdentity(dr.restored)
    if (!same(source, restored) || source.admissionRows !== source.admittedBindingDigests.length
      || !same(source.admittedBindingDigests, initial.bindings.map((binding) => binding.bindingIdDigest).sort())
      || source.journalRows < 2 || source.membershipRows < 3 || source.revisionRows < 3
      || source.completeRevisions.length !== source.revisionRows
      || !source.completeRevisions.some((item) => item.revisionId === initial.revisionId && item.desiredStateDigest === initial.desiredStateDigest)
      || !source.completeRevisions.some((item) => item.revisionId === nPlusOne.revisionId && item.desiredStateDigest === nPlusOne.desiredStateDigest)
      || !source.completeRevisions.some((item) => item.revisionId === rollback.revisionId && item.desiredStateDigest === rollback.desiredStateDigest)
      || !source.destructivePublications.some((item) => item.operationIdDigest === rollbackOperationIdDigest
        && item.expectedRevisionId === nPlusOne.revisionId && item.expectedDesiredStateDigest === nPlusOne.desiredStateDigest
        && item.requestedTargetRevisionId === initial.revisionId && item.requestedTargetDesiredStateDigest === initial.desiredStateDigest
        && item.publicationRevisionId === rollback.revisionId && item.publicationDesiredStateDigest === rollback.desiredStateDigest
        && same(item.removalBindingDigests, [additions[0]!.bindingIdDigest]))
      || restored.activeDesiredStateDigest !== rollback.desiredStateDigest) failed()
    const rpoSeconds = duration(dr.rpoSeconds)
    const rtoSeconds = duration(dr.rtoSeconds)
    const redaction = record(value.redaction, ['containsSecrets', 'containsRawPaths'])
    falsity(redaction.containsSecrets)
    falsity(redaction.containsRawPaths)
    const acceptedIsolation = isolation(liveIsolationEvidence)
    const runtimeProfileContentDigest = initial.bindings[0]!.runtimeProfileContentDigest
    for (const observed of [initial, nPlusOne, rollback]) {
      if (observed.bindings.some((item) => item.runtimeProfileId !== 'runsc'
        || item.runtimeProfileContentDigest !== runtimeProfileContentDigest
        || item.isolationAttestationDigest !== acceptedIsolation.evidenceDigest)) failed()
    }

    return Object.freeze({
      schemaVersion: 1,
      status: 'pass',
      coreImageDigest: initial.coreImageDigest,
      revisions: Object.freeze({
        initial: initial.revisionId,
        nPlusOne: nPlusOne.revisionId,
        rollback: rollback.revisionId,
      }),
      bindings: Object.freeze({ initial: 3, nPlusOne: 4, rollback: 3 }),
      isolation: Object.freeze(acceptedIsolation),
      timing: Object.freeze({
        totalSeconds,
        targetSeconds: 900,
        targetMet: totalSeconds <= 900,
      }),
      dr: Object.freeze({ rpoSeconds, rtoSeconds, ingressStarts: 0 }),
      redaction: Object.freeze({
        containsSecrets: false,
        containsRawPaths: false,
      }),
    })
  } catch (error) {
    if (error instanceof D1HostError && error.code === D1HostErrorCode.PROOF_INVALID) throw error
    failed()
  }
}
