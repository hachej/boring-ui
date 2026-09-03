import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createConfiguredAgentHostAgentSpec,
  materializeAgentDirectory,
  type AgentHostAgentSpec,
  type TrustedAgentInstructionAppendix,
} from '@hachej/boring-agent/server'
import { createAgentAssetDigest } from '@hachej/boring-agent/shared'
import { FACTORY_LOOP_PLUGIN_ID } from './loopPlugin'
import { FACTORY_DELEGATE_PLUGIN_ID } from './delegatePlugin'
import { FACTORY_WORKER_AGENT_TYPE_ID } from './sandboxComposition'

export const FACTORY_ORCHESTRATOR_AGENT_TYPE_ID = 'boring-orchestrator'
export const FACTORY_REVIEWER_AGENT_TYPE_ID = 'boring-reviewer'

const seatSkills = {
  orchestrator: ['plan', 'feedback', 'owner-gate', 'handoff'],
  worker: ['exec', 'fresh-eyes', 'owner-gate', 'handoff'],
  reviewer: ['fresh-eyes'],
} as const

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
      plugins: [FACTORY_LOOP_PLUGIN_ID, 'boring-automation', FACTORY_DELEGATE_PLUGIN_ID],
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
