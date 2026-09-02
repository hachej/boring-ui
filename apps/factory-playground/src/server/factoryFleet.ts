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
import { FACTORY_WORKER_AGENT_TYPE_ID } from './sandboxComposition'

export const FACTORY_ORCHESTRATOR_AGENT_TYPE_ID = 'boring-orchestrator'

const seatSkills = {
  orchestrator: ['plan', 'feedback', 'owner-gate', 'handoff'],
  worker: ['exec', 'fresh-eyes', 'owner-gate', 'handoff'],
} as const

async function loadAppendices(repositoryRoot: string, names: readonly string[]): Promise<TrustedAgentInstructionAppendix[]> {
  return await Promise.all(names.map(async (name) => {
    const content = await readFile(resolve(repositoryRoot, '.agents/skills', name, 'SKILL.md'), 'utf8')
    return { name, content, digest: await createAgentAssetDigest(content) }
  }))
}

async function createSeat(input: {
  repositoryRoot: string
  seat: keyof typeof seatSkills
  agentTypeId: string
  plugins: readonly string[]
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
      instructionAppendices: await loadAppendices(input.repositoryRoot, seatSkills[input.seat]),
      plugins: input.plugins.map((name) => ({ name })),
    },
  })
}

/** Load canonical persona and skill sources from this checkout; no packaged or vendored copies. */
export async function loadNativeFactoryFleet(repositoryRoot: string): Promise<readonly AgentHostAgentSpec[]> {
  return await Promise.all([
    createSeat({
      repositoryRoot,
      seat: 'orchestrator',
      agentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      plugins: [FACTORY_LOOP_PLUGIN_ID, 'boring-automation'],
    }),
    createSeat({
      repositoryRoot,
      seat: 'worker',
      agentTypeId: FACTORY_WORKER_AGENT_TYPE_ID,
      plugins: ['sandbox'],
    }),
  ])
}
