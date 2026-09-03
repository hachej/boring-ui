import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createConfiguredAgentHostAgentSpec,
  materializeAgentDirectory,
  type AgentHostAgentSpec,
  type TrustedAgentInstructionAppendix,
} from '@hachej/boring-agent/server'
import { createAgentAssetDigest } from '@hachej/boring-agent/shared'
import { FACTORY_DELEGATE_PLUGIN_ID } from './delegatePlugin'
import { FACTORY_SUPERVISION_PLUGIN_ID } from './supervisionPlugin'
import { FACTORY_DEMO_PLUGIN_ID } from './demoPlugin'
import { FACTORY_WORKER_AGENT_TYPE_ID } from './sandboxComposition'

export const FACTORY_ORCHESTRATOR_AGENT_TYPE_ID = 'boring-orchestrator'
export const FACTORY_REVIEWER_AGENT_TYPE_ID = 'boring-reviewer'

const seatSkills = {
  orchestrator: ['plan', 'feedback', 'owner-gate', 'handoff'],
  worker: ['exec', 'fresh-eyes', 'handoff'],
  reviewer: ['fresh-eyes'],
} as const

/**
 * Host appendix reconciling the canonical `exec`/`owner-gate` skill blocks (authored for
 * per-Bead PRs and blocking `ask_user` gates) with this Factory's actual topology: one shared
 * epic branch, one epic PR owned by the Orchestrator/owner, and Workers that never gate or merge.
 */
const FACTORY_PRECEDENCE_CONTENT = {
  worker: [
    'In this Factory the epic branch is the only branch and the epic PR belongs to the',
    'Orchestrator/owner, never to you. You do not open PRs and you do not run `ask_user`',
    'owner gates; the `owner-gate` skill block does not apply to this seat. Your handoff is',
    'a Bead comment recording the exact SHA, your proof, the sandbox release, and the',
    '`fresh_review` provenance. Push the epic branch immediately after each commit and before creating a sandbox (remote sandboxes fetch the pushed SHA). Never close or merge',
    'anything.',
  ].join(' '),
  orchestrator: [
    "The plan block's `/skill:exec` handoff is replaced by `dispatch_worker`: dispatch a fresh " +
      'Worker session instead of executing or delegating through the skill transport. You never ' +
      'merge the epic branch.',
    'Gate 1 (plan approval): after materializing the Bead graph you MUST raise `ask_user` in the ' +
      "owner's Inbox before arming supervision or dispatching, per `owner-gate`. Title " +
      '`[br-<epic bead id or first bead id>] Plan approval: <epic title>`. Context: the goal in ' +
      'one line, the Bead list (id, title, dependency order), the proof commands, risks/rollback, ' +
      'and what happens on approve (durable supervision armed + Worker dispatch begins). Schema: ' +
      'radio `decision` (approve/changes/defer/reject) plus an optional notes textarea, exactly as ' +
      '`owner-gate` prescribes. Skip this gate ONLY when the owner\'s request text literally says ' +
      '"Gate 1 pre-approved". On changes/defer/reject: revise the plan or stop; never arm ' +
      'supervision or dispatch.',
    'Gate 2 (merge approval): raise it once `factory_status` shows every epic Bead handed off — a ' +
      'handoff comment naming the SHA, sandbox proof and a `fresh_review` approve on each, local ' +
      'HEAD equal to remote HEAD, and no ready/unassigned Beads left. First (a) open the epic PR ' +
      'yourself with `gh pr create --base main --head <epic branch> --title "[br-<epic>] <title>" ' +
      '--body-file <file>`, body = the Owner Review card from `docs/procedures/owner-review-card.md` ' +
      'filled in (Bead/PR/issue, What changed/why, Risk/rollback, Proof/review links incl. ' +
      '`fresh_review` provenance, Artifact = the demo URL, Please test steps, Decision line) ' +
      'followed by a `## Handover` section (SHA, branch, Worker sessions, reviewer sessions, ' +
      'sandbox receipts); if a PR already exists for the branch (`gh pr view <branch>`), edit its ' +
      'body instead of opening a second one. Then (b) start a demo with `demo_sandbox` (op start) ' +
      'serving the feature from the exact SHA and wait for `ready: true`. Then (c) raise ' +
      '`ask_user`: title `[br-<epic>] Merge approval: <title>`, context = the PR URL, head SHA, ' +
      'the demo URL and how long it lives, please-test steps, and the handover lines; same radio ' +
      '`decision` schema as Gate 1. (d) On approve: do NOT merge — comment on the PR that the ' +
      'owner approved at that SHA and report. On changes: create follow-up Beads labelled ' +
      '`epic:<key>` and dispatch a Worker. Never merge, either way.',
  ].join('\n\n'),
} as const

async function factoryPrecedenceAppendix(seat: 'worker' | 'orchestrator'): Promise<TrustedAgentInstructionAppendix> {
  const content = FACTORY_PRECEDENCE_CONTENT[seat]
  return { name: 'factory-precedence', content, digest: await createAgentAssetDigest(content) }
}

async function loadAppendices(repositoryRoot: string, names: readonly string[]): Promise<TrustedAgentInstructionAppendix[]> {
  return await Promise.all(names.map(async (name) => {
    const content = await readFile(resolve(repositoryRoot, '.agents/skills', name, 'SKILL.md'), 'utf8')
    return { name, content, digest: await createAgentAssetDigest(content) }
  }))
}

function epicBindingContent(seat: keyof typeof seatSkills, epicKey: string): string {
  const shared = `This session is bound by the host to epic \`${epicKey}\`: its shared worktree is the current workspace root, its branch is the epic branch, and its Beads carry the label \`epic:${epicKey}\`.`
  if (seat === 'orchestrator') {
    return [
      shared,
      `Every Bead you create for this epic MUST be created with \`--labels epic:${epicKey}\` (add \`--parent <epic bead id>\` when you create an epic bead first); inspect this epic only with \`br ready --label epic:${epicKey}\` / \`br list --label epic:${epicKey}\`; never dispatch, inspect or supervise Beads without that label.`,
      'Recovery: run `factory_status` on every supervision tick. A Bead that is `in_progress` whose ' +
        'assignee session is `unknown` or `exists-idle` with no handoff comment and no new commit on ' +
        'the epic branch is STALE: release it with `br update <id> --assignee "" --status open --actor ' +
        '<your session id>`, add a Bead comment `recovered stale claim from <old session>`, then start a ' +
        'fresh Worker with `dispatch_worker`. Never release a Bead whose assignee session is ' +
        '`exists-busy`. Uncommitted edits left in the shared worktree by a dead Worker are handed to the ' +
        'next Worker in its brief, never reverted by you.',
    ].join('\n\n')
  }
  if (seat === 'reviewer') {
    return [
      shared,
      `You review only Beads labelled \`epic:${epicKey}\`; report, never edit.`,
    ].join('\n\n')
  }
  return [
    shared,
    `Discover work ONLY with \`br ready --label epic:${epicKey} --unassigned\`; claim exactly one result with \`br update <id> --claim --actor <your session id>\`; if that command returns nothing, stop and report "no ready Bead for epic ${epicKey}" instead of running a broader \`br ready\`. Never claim a Bead lacking that label.`,
    'If the shared worktree already holds uncommitted changes for your Bead from a previous ' +
      'Worker, inspect them, adopt what is correct, finish the work, and say so in the handoff; ' +
      'never revert them wholesale.',
  ].join('\n\n')
}

async function epicBindingAppendix(seat: keyof typeof seatSkills, epicKey: string): Promise<TrustedAgentInstructionAppendix> {
  const content = epicBindingContent(seat, epicKey)
  return { name: 'epic-binding', content, digest: await createAgentAssetDigest(content) }
}

async function createSeat(input: {
  repositoryRoot: string
  seat: keyof typeof seatSkills
  agentTypeId: string
  plugins: readonly string[]
  preferredModel?: string
  epicKey: string
}): Promise<AgentHostAgentSpec> {
  const directory = resolve(input.repositoryRoot, '.agents/personas', input.seat)
  const source = await materializeAgentDirectory({
    directory,
    manifest: 'package.json',
    expectedAgentTypeId: input.agentTypeId,
  })
  return await createConfiguredAgentHostAgentSpec({
    source,
    policy: {
      instructionSources: [{ role: 'persona', absolutePath: resolve(directory, 'instructions.md') }],
      instructionAppendices: [
        ...await loadAppendices(input.repositoryRoot, seatSkills[input.seat]),
        ...(input.seat === 'worker' || input.seat === 'orchestrator' ? [await factoryPrecedenceAppendix(input.seat)] : []),
        await epicBindingAppendix(input.seat, input.epicKey),
      ],
      plugins: input.plugins.map((name) => ({ name })),
      preferredModel: input.preferredModel,
    },
  })
}

/** Load canonical persona and skill sources from this checkout; no packaged or vendored copies. */
export interface FactoryFleetOptions {
  readonly orchestrator?: string
  readonly worker?: string
  readonly reviewer?: string
  readonly epicKey: string
}

export async function loadNativeFactoryFleet(
  repositoryRoot: string,
  options: FactoryFleetOptions,
): Promise<readonly AgentHostAgentSpec[]> {
  return await Promise.all([
    createSeat({
      repositoryRoot,
      seat: 'orchestrator',
      agentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      plugins: [FACTORY_SUPERVISION_PLUGIN_ID, FACTORY_DEMO_PLUGIN_ID, 'boring-automation', FACTORY_DELEGATE_PLUGIN_ID],
      preferredModel: options.orchestrator,
      epicKey: options.epicKey,
    }),
    createSeat({
      repositoryRoot,
      seat: 'worker',
      agentTypeId: FACTORY_WORKER_AGENT_TYPE_ID,
      plugins: ['sandbox', FACTORY_DELEGATE_PLUGIN_ID],
      preferredModel: options.worker,
      epicKey: options.epicKey,
    }),
    createSeat({
      repositoryRoot,
      seat: 'reviewer',
      agentTypeId: FACTORY_REVIEWER_AGENT_TYPE_ID,
      plugins: [],
      preferredModel: options.reviewer,
      epicKey: options.epicKey,
    }),
  ])
}
