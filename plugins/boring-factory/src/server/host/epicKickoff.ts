import type { FactoryEpicEntry } from './epicRegistry'

export const FACTORY_DEFAULT_PLAN_BUDGET_MS = 20 * 60_000

export function buildEpicKickoffPrompt(
  entry: FactoryEpicEntry,
  requestText?: string,
  now: number = Date.now(),
): string {
  const ownerRequest = requestText?.trim() || `Plan the ${entry.featureName} epic from the request and repository context available in the worktree.`
  const sessionContext = entry.orchestratorSessionId ? ` Your session id is ${entry.orchestratorSessionId}.` : ''
  const planDeadlineAt = entry.planDeadlineAt ?? new Date(now + FACTORY_DEFAULT_PLAN_BUDGET_MS).toISOString()
  return [
    `Host context: epic ${entry.epicKey} ([${entry.featureName}]) worktree ${entry.worktree} branch ${entry.branch}.${sessionContext}`,
    'Owner request:',
    ownerRequest,
    `Materialize the full dependency-correct Bead graph with real br commands in ${entry.worktree} (an epic Bead plus every named slice, wired with real \`br dep add\` relations where dependencies exist). Every Bead and every br query must use \`--label epic:${entry.epicKey}\`. Then raise Gate 1 (plan approval) with ask_user no later than the host deadline ${planDeadlineAt} (BORING_FACTORY_PLAN_BUDGET_MS); do not skip it and do not treat this message as a pre-approval.`,
    'On approval, immediately start durable supervision with the supervise tool (op start, intervalMs 120000, a prompt naming factory_status and the recovery rule). Then dispatch Workers as Beads become ready: call dispatch_worker with the exact ready Bead as beadId. The host enforces concurrent-Worker and per-Bead dispatch caps. Keep supervising and polling factory_status until every non-epic Bead has a complete handoff comment. When factory_status reports stale claims, call recover_stale_claims. Do not stop supervision until then.',
    `Each Worker brief must preserve this host context and name its target Bead, verify that exact Bead through \`br ready --label epic:${entry.epicKey} --unassigned\`, claim it with \`--claim --actor <session id>\`, implement and stage only intended files in ${entry.worktree}, commit on ${entry.branch}, exact-SHA sandbox-test via the sandbox tools, obtain adversarial fresh_review of that SHA, push the epic branch, and record a complete Bead handoff (SHA, proof, review provenance). It must never merge or close its own Bead.`,
    'Report progress each round: which Beads are handed off, which are in flight, and on which Worker sessions. On changes/defer/reject at Gate 1: revise and re-raise, or stop and report; do not arm supervision or dispatch.',
  ].join('\n\n')
}
