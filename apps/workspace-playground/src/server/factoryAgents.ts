import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import {
  createConfiguredAgentHostAgentSpec,
  materializeAgentDirectory,
  TrustedAgentCompositionError,
  type AgentHostAgentSpec,
  type TrustedAgentInstructionAppendix,
} from '@hachej/boring-agent/server'
import type { Sha256Digest } from '@hachej/boring-agent/shared'

export type BoringFactoryRole = 'concierge' | 'triage' | 'steward' | 'worker' | 'reviewer'

interface SkillBinding {
  readonly name: string
  readonly digest: Sha256Digest
}

interface RoleBinding {
  readonly role: BoringFactoryRole
  readonly agentTypeId: string
  readonly skills: readonly SkillBinding[]
}

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')
const ROLE_BINDINGS: readonly RoleBinding[] = Object.freeze([
  {
    role: 'concierge',
    agentTypeId: 'boring-concierge',
    skills: [
      { name: 'feedback', digest: 'sha256:643fcf2e241ee50ca0ec11fdde8c1a556ac2c538f7c40a773bb2de36c9e3088e' },
      { name: 'triage', digest: 'sha256:1e0e60fde8b9d6b9ff2444dedec8c54b1800a0978ad5e4867f659d1a04a50ec2' },
      { name: 'handoff', digest: 'sha256:23c8bcce191a4ba2b0af5392aadfac1bc4999fd50f0c1bf797eed3611f1892a6' },
    ],
  },
  {
    role: 'triage',
    agentTypeId: 'boring-triage',
    skills: [
      { name: 'triage', digest: 'sha256:1e0e60fde8b9d6b9ff2444dedec8c54b1800a0978ad5e4867f659d1a04a50ec2' },
      { name: 'handoff', digest: 'sha256:23c8bcce191a4ba2b0af5392aadfac1bc4999fd50f0c1bf797eed3611f1892a6' },
    ],
  },
  {
    role: 'steward',
    agentTypeId: 'boring-steward',
    skills: [
      { name: 'plan', digest: 'sha256:aa09bb6495cc482818837b85817147a3a9ef76db3e4b0a0cf7f3653df0c1c393' },
      { name: 'handoff', digest: 'sha256:23c8bcce191a4ba2b0af5392aadfac1bc4999fd50f0c1bf797eed3611f1892a6' },
    ],
  },
  {
    role: 'worker',
    agentTypeId: 'boring-worker',
    skills: [
      { name: 'exec', digest: 'sha256:5ff799a8f7442762124f8bdd8cd60f14e26904369c18c2fef5b96286cc788859' },
      { name: 'handoff', digest: 'sha256:23c8bcce191a4ba2b0af5392aadfac1bc4999fd50f0c1bf797eed3611f1892a6' },
    ],
  },
  {
    role: 'reviewer',
    agentTypeId: 'boring-reviewer',
    skills: [
      { name: 'fresh-eyes', digest: 'sha256:7bd84dab860e99accfa351fadc0b97aec124d2c51f0c3f87de4a3f67d53bb655' },
      { name: 'handoff', digest: 'sha256:23c8bcce191a4ba2b0af5392aadfac1bc4999fd50f0c1bf797eed3611f1892a6' },
    ],
  },
].map((binding) => Object.freeze({
  ...binding,
  skills: Object.freeze(binding.skills.map((skill) => Object.freeze({ ...skill }))),
})))

export interface LoadBoringFactoryAgentsOptions {
  readonly preferredModels?: Partial<Record<BoringFactoryRole, string>>
}

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

async function canonicalSkillContent(root: string, skill: SkillBinding): Promise<string> {
  const field = `skills.${skill.name}`
  const candidate = resolve(root, '.agents', 'skills', skill.name, 'SKILL.md')
  try {
    const fileStat = await lstat(candidate)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new TrustedAgentCompositionError(field, 'canonical skill must be a regular non-symlink file')
    }
    const target = await realpath(candidate)
    if (!isInside(root, target)) {
      throw new TrustedAgentCompositionError(field, 'canonical skill resolves outside the admitted repository root')
    }
    return await readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof TrustedAgentCompositionError) throw error
    throw new TrustedAgentCompositionError(field, 'canonical skill is unavailable')
  }
}

async function instructionAppendices(root: string, skills: readonly SkillBinding[]): Promise<TrustedAgentInstructionAppendix[]> {
  const appendices: TrustedAgentInstructionAppendix[] = []
  for (const skill of skills) {
    appendices.push({
      name: skill.name,
      digest: skill.digest,
      content: await canonicalSkillContent(root, skill),
    })
  }
  return appendices
}

/** Repository-only dogfood fleet. Production apps own packaging and policy. */
export async function loadBoringFactoryAgents(
  options: LoadBoringFactoryAgentsOptions = {},
): Promise<readonly AgentHostAgentSpec[]> {
  let repositoryRoot: string
  try {
    repositoryRoot = await realpath(REPOSITORY_ROOT)
  } catch {
    throw new TrustedAgentCompositionError('repositoryRoot', 'admitted factory repository root is unavailable')
  }

  const agents: AgentHostAgentSpec[] = []
  for (const binding of ROLE_BINDINGS) {
    const source = await materializeAgentDirectory({
      directory: resolve(repositoryRoot, 'agents', 'boring', binding.role),
      expectedAgentTypeId: binding.agentTypeId,
    })
    agents.push(await createConfiguredAgentHostAgentSpec({
      source,
      policy: {
        instructionAppendices: await instructionAppendices(repositoryRoot, binding.skills),
        ...(options.preferredModels?.[binding.role]
          ? { preferredModel: options.preferredModels[binding.role] }
          : {}),
      },
    }))
  }
  return Object.freeze(agents)
}
