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
  orchestrator: ['plan', 'feedback', 'owner-gate', 'handoff', 'show-me'],
  worker: ['exec', 'fresh-eyes', 'handoff'],
  reviewer: ['fresh-eyes'],
} as const

/**
 * Host appendix naming which host tool implements which step of the canonical `exec`/`plan`/
 * `owner-gate` skill text above (already reconciled with this Factory's topology: one shared
 * epic branch, one epic PR owned by the Orchestrator/owner, Workers that never gate or merge).
 * This appendix adds nothing the skills don't already say — it only binds tool names.
 */
const FACTORY_PRECEDENCE_CONTENT = {
  worker: [
    'The `exec` skill above is this seat\'s full loop (pull, claim, commit, push, sandbox-test,',
    '`fresh_review`, Bead-comment handoff — never a PR, never `ask_user`, never merge). The host',
    'tool that runs your adversarial review is `fresh_review`; the tools that run your exact-SHA',
    'tests/builds are `sandbox` and `sandbox_bash`.',
  ].join(' '),
  orchestrator: [
    'The `plan` and `owner-gate` skills above are this seat\'s full loop (Bead graph, Gate 1,',
    'dispatch, Gate 2, never merge). The host tools implementing those steps: `dispatch_worker`',
    '(the plan block\'s "dispatch Workers" step — start a fresh Worker session), `factory_status`',
    '(read epic Bead/git/session state before every gate or recovery decision), `supervise`',
    '(arm the durable tick that replaces held-open sessions/timers), and `demo_sandbox` (Gate 2\'s',
    'exact-SHA live demo). Use each exactly where its matching skill step names it.',
    'The `show-me` skill above is mandatory, not optional, at both gates: Gate 1 carries the',
    'show-me plan artifact and Gate 2\'s PR body carries a `## Show me` section, per',
    '`owner-gate`\'s SKILL.md.',
  ].join(' '),
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

/** `BORING_FACTORY_FEATURE_NAME` when set, else the epic key's words title-cased. */
export function deriveFeatureName(epicKey: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BORING_FACTORY_FEATURE_NAME?.trim()
  if (configured) return configured
  const words = epicKey.split(/[-_/]+/).filter((word) => word.length > 0)
  if (words.length === 0) return epicKey
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function epicBindingContent(seat: keyof typeof seatSkills, epicKey: string, featureName: string): string {
  const shared = `This session is bound by the host to epic \`${epicKey}\` (**${featureName}**): its shared worktree is the current workspace root, its branch is the epic branch, and its Beads carry the label \`epic:${epicKey}\`.`
  if (seat === 'orchestrator') {
    return [
      shared,
      `Every Bead you create for this epic MUST be created with \`--labels epic:${epicKey}\` (add \`--parent <epic bead id>\` when you create an epic bead first) and titled per docs/procedures/naming-conventions.md, i.e. \`[${featureName}] <verb phrase>\` (\`[${featureName}] Epic\` for the epic Bead itself); inspect this epic only with \`br ready --label epic:${epicKey}\` / \`br list --label epic:${epicKey}\`; never dispatch, inspect or supervise Beads without that label.`,
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

async function epicBindingAppendix(seat: keyof typeof seatSkills, epicKey: string, featureName: string): Promise<TrustedAgentInstructionAppendix> {
  const content = epicBindingContent(seat, epicKey, featureName)
  return { name: 'epic-binding', content, digest: await createAgentAssetDigest(content) }
}

async function createSeat(input: {
  repositoryRoot: string
  seat: keyof typeof seatSkills
  agentTypeId: string
  plugins: readonly string[]
  preferredModel?: string
  epicKey: string
  featureName: string
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
        await epicBindingAppendix(input.seat, input.epicKey, input.featureName),
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
  /** Feature name per docs/procedures/naming-conventions.md; see `deriveFeatureName`. */
  readonly featureName: string
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
      featureName: options.featureName,
    }),
    createSeat({
      repositoryRoot,
      seat: 'worker',
      agentTypeId: FACTORY_WORKER_AGENT_TYPE_ID,
      plugins: ['sandbox', FACTORY_DELEGATE_PLUGIN_ID],
      preferredModel: options.worker,
      epicKey: options.epicKey,
      featureName: options.featureName,
    }),
    createSeat({
      repositoryRoot,
      seat: 'reviewer',
      agentTypeId: FACTORY_REVIEWER_AGENT_TYPE_ID,
      plugins: [],
      preferredModel: options.reviewer,
      epicKey: options.epicKey,
      featureName: options.featureName,
    }),
  ])
}
