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
const ROLE_BINDING_DEFINITIONS = [
  {
    role: 'concierge',
    agentTypeId: 'boring-concierge',
    skills: [
      { name: 'feedback', digest: 'sha256:707ae8fd12ace225be7d6de8c345c7d73cf9aa07763f138419f6d6b26b92a9af' },
      { name: 'triage', digest: 'sha256:c9931f981b0d2d55415026c25bc27dec3e24fd310bee405360eba57d6cf58766' },
      { name: 'handoff', digest: 'sha256:d3bd45bb74632e8388bc4a9e37febbf9d7332107fe1eff4047e91df23e7a7e17' },
    ],
  },
  {
    role: 'triage',
    agentTypeId: 'boring-triage',
    skills: [
      { name: 'triage', digest: 'sha256:c9931f981b0d2d55415026c25bc27dec3e24fd310bee405360eba57d6cf58766' },
      { name: 'handoff', digest: 'sha256:d3bd45bb74632e8388bc4a9e37febbf9d7332107fe1eff4047e91df23e7a7e17' },
    ],
  },
  {
    role: 'steward',
    agentTypeId: 'boring-steward',
    skills: [
      { name: 'plan', digest: 'sha256:ba6e76d7cdd8ce2966ca38e66942f62bf882e56fca4cadd9ca360ee175f384ac' },
      { name: 'handoff', digest: 'sha256:d3bd45bb74632e8388bc4a9e37febbf9d7332107fe1eff4047e91df23e7a7e17' },
    ],
  },
  {
    role: 'worker',
    agentTypeId: 'boring-worker',
    skills: [
      { name: 'exec', digest: 'sha256:8ea7731c7c9206fd106397bacd3f3eb6e6c786c605ab8123a070577794526bb4' },
      { name: 'handoff', digest: 'sha256:d3bd45bb74632e8388bc4a9e37febbf9d7332107fe1eff4047e91df23e7a7e17' },
    ],
  },
  {
    role: 'reviewer',
    agentTypeId: 'boring-reviewer',
    skills: [
      { name: 'fresh-eyes', digest: 'sha256:58f6cfb66cc2a31238e5c033f42b69b7fbd6089d06c9f6d5108caa7035e5f565' },
      { name: 'handoff', digest: 'sha256:d3bd45bb74632e8388bc4a9e37febbf9d7332107fe1eff4047e91df23e7a7e17' },
    ],
  },
] as const satisfies readonly RoleBinding[]
const ROLE_BINDINGS: readonly RoleBinding[] = Object.freeze(ROLE_BINDING_DEFINITIONS.map((binding) => Object.freeze({
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
      directory: resolve(repositoryRoot, '.agents', 'personas', binding.role),
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
