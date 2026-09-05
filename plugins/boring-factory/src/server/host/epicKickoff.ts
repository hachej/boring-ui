import type { FactoryEpicEntry } from './epicRegistry'

export function buildEpicKickoffPrompt(entry: FactoryEpicEntry, requestText?: string): string {
  const ownerRequest = requestText?.trim() || `Plan the ${entry.featureName} epic from the request and repository context available in the worktree.`
  const sessionContext = entry.orchestratorSessionId ? ` Your session id is ${entry.orchestratorSessionId}.` : ''
  return [
    `Host context: epic ${entry.epicKey} ([${entry.featureName}]) worktree ${entry.worktree} branch ${entry.branch}.${sessionContext}`,
    'Owner request:',
    ownerRequest,
    `Materialize the full dependency-correct Bead graph with real br commands in ${entry.worktree} (an epic Bead plus every named slice, wired with real \`br dep add\` relations where dependencies exist). Every Bead and every br query must use \`--label epic:${entry.epicKey}\`. Then raise Gate 1 (plan approval) now with ask_user, per the factory-precedence appendix — do not skip it and do not treat this message as a pre-approval.`,
    'On approval, immediately start durable supervision with the supervise tool (op start, intervalMs 120000, a prompt naming factory_status and the recovery rule). Then dispatch Workers as Beads become ready: use dispatch_worker for each ready, unclaimed, dependency-unblocked Bead, up to 2 concurrently. Keep supervising and polling factory_status until every non-epic Bead has a complete handoff comment. Do not stop supervision until then.',
    `Each Worker brief must preserve this host context, use the pull protocol (\`br ready --label epic:${entry.epicKey} --unassigned\`, then claim one with \`--claim --actor <session id>\`), implement and stage only intended files in ${entry.worktree}, commit on ${entry.branch}, exact-SHA sandbox-test via the sandbox tools, obtain adversarial fresh_review of that SHA, push the epic branch, and record a complete Bead handoff (SHA, proof, review provenance). It must never merge or close its own Bead. Do not name a specific Bead in the brief — the Worker claims whichever ready Bead it picks up.`,
    'Report progress each round: which Beads are handed off, which are in flight, and on which Worker sessions. On changes/defer/reject at Gate 1: revise and re-raise, or stop and report; do not arm supervision or dispatch.',
  ].join('\n\n')
}
