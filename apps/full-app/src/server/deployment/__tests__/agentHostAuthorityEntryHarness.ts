import { runAgentHostCommandEntry, type AgentHostDependencyFactory } from '../agentHostCommandEntry.js'
import { createAgentHostDestructivePublicationJournalStore } from '../destructivePublicationJournal.js'
import { createAgentHostFencedDestructivePublication } from '../fencedDestructivePublication.js'
import { createAgentHostCompleteEnvelope, deriveAgentHostSecretRefsEnvelope, digestAgentHostDesired,
  type AgentHostDesiredSnapshotV1, type AgentHostObservationV1 } from '../agentHostRevisionCodec.js'
import type { AgentHostStoredCandidateV1 } from '../hostRevisionStore.js'
import { createAgentHostAuthorityIntegrationState } from './agentHostAuthorityIntegrationSupport.js'

// Executed in a real wrapper child process by agentHostAuthorityIntegration.test.ts.
const hostId = process.env.AGENT_HOST_INTEGRATION_HOST_ID!
const databaseRef = process.env.AGENT_HOST_INTEGRATION_DATABASE_REF!
const operationId = process.env.AGENT_HOST_INTEGRATION_OPERATION_ID!
const state = await createAgentHostAuthorityIntegrationState(hostId, databaseRef)
let active = Object.freeze({ schemaVersion: 1 as const, revisionId: state.completeTwo.revisionId, desiredStateDigest: state.completeTwo.desiredStateDigest })
const completes = new Map([[state.completeOne.revisionId, state.completeOne], [state.completeTwo.revisionId, state.completeTwo]])
let candidate: AgentHostStoredCandidateV1 | undefined; let observed: AgentHostObservationV1 | undefined
const store = {
  readActive: async (requestedHostId: string) => requestedHostId === hostId ? active : null,
  readComplete: async (requestedHostId: string, revisionId: string) => requestedHostId === hostId ? completes.get(revisionId) ?? null : null,
  hasTerminalAudit: async () => true, appendAudit: async () => {}, reserveRevisionId: async () => 'r0000000003',
  writeCandidate: async (_hostId: string, revisionId: string, desired: AgentHostDesiredSnapshotV1) => {
    candidate = { revisionId, desired, desiredStateDigest: await digestAgentHostDesired(desired), secretRefs: deriveAgentHostSecretRefsEnvelope(desired) }; return candidate
  },
  writeObservation: async (_hostId: string, _revisionId: string, observation: AgentHostObservationV1) => { observed = observation; return observation },
  writeComplete: async (_hostId: string, revisionId: string) => {
    if (!candidate || !observed) throw new Error()
    const complete = { ...candidate, observation: observed, completion: await createAgentHostCompleteEnvelope(revisionId, candidate.desired, observed) }
    completes.set(revisionId, complete); return complete
  },
  publishActive: async (_requestedHostId: string, revisionId: string) => {
    const target = completes.get(revisionId); if (!target) throw new Error()
    active = Object.freeze({ schemaVersion: 1 as const, revisionId, desiredStateDigest: target.desiredStateDigest }); return active
  },
} as never
const dependencyFactory: AgentHostDependencyFactory = (context) => {
  if (!context.admissionLedger || context.authority?.mode !== 'isolated-proof' || context.authority.databaseRef !== databaseRef) throw new Error()
  const publicationControl = {
    status: async () => ({ durableRevision: state.completeTwo.revisionId, servedRevision: state.completeOne.revisionId, pendingOperation: operationId }),
    commit: async () => {}, discard: async () => {}, recover: async () => {},
  }
  const inspectionFor = (desired: AgentHostDesiredSnapshotV1) => desired.plan.bindings.length === state.completeOne.desired.plan.bindings.length
    ? state.rollbackInspection : state.inspection
  return {
    store,
    resolver: { resolvePlan: async () => state.desired, reproduce: async () => state.completeOne.desired },
    effects: {
      loadAdmittedBindingIds: (requestedHostId: string, requestedDatabaseRef: string) => context.admissionLedger!.listBindingIds(requestedHostId, requestedDatabaseRef),
      loadAgentArtifacts: async () => [], loadRevisionAgentArtifacts: async () => [], materialize: async (value: AgentHostStoredCandidateV1) => inspectionFor(value.desired),
      preload: async (value: AgentHostStoredCandidateV1) => value.desired.plan.bindings.length === state.completeOne.desired.plan.bindings.length
        ? state.completeOne.observation : state.completeTwo.observation,
      verifyActive: async () => {},
    },
    inspectRuntimeInputs: async (desired: AgentHostDesiredSnapshotV1) => inspectionFor(desired),
    mutationGuard: context.mutationGuard,
    fencedPublication: createAgentHostFencedDestructivePublication({ admissionLedger: context.admissionLedger,
      journalStore: createAgentHostDestructivePublicationJournalStore(), revisionStore: store, publicationControl }),
    operator: { uid: context.ownerUid, effectiveUser: 'authority-integration', invocationId: 'authority-integration' },
    clock: () => '2026-07-16T00:00:00.000Z',
  }
}

const output = await runAgentHostCommandEntry({ mode: '--locked', dependencyFactory })
process.stdout.write(output.line)
process.exitCode = output.exitCode
