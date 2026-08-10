import { createAgentAssetDigest, type Sha256Digest } from '../../shared/agent-definition'
import { ErrorCode } from '../../shared/error-codes'
import type { JsonValue } from '../../shared/gateway/types'
import type { AgentInstructionFileRef, ConfiguredAgentHostAgentSpec } from '../agent-host/types'
import type { AuthoredAgentSourceV1 } from './materializeAgentDirectory'

const APPENDIX_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/

export interface TrustedAgentInstructionAppendix {
  readonly name: string
  readonly content: string
  readonly digest: Sha256Digest
}

export interface TrustedAuthoredAgentPolicy {
  readonly fallbackLabel?: string
  /**
   * Workspace-relative authored instruction sources for this agent, supplied
   * by the trusted composer that actually knows where they live.
   */
  readonly instructionFiles?: readonly AgentInstructionFileRef[]
  readonly instructionAppendices?: readonly TrustedAgentInstructionAppendix[]
  readonly plugins?: readonly {
    readonly name: string
    readonly config?: JsonValue
  }[]
  readonly preferredModel?: string
}

export interface CreateConfiguredAgentHostAgentSpecInput {
  readonly source: AuthoredAgentSourceV1
  readonly policy?: TrustedAuthoredAgentPolicy
}

export class TrustedAgentCompositionError extends Error {
  readonly code = ErrorCode.enum.CONFIG_INVALID
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'TrustedAgentCompositionError'
    this.field = field
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function instructionBlock(appendix: TrustedAgentInstructionAppendix): string {
  return [
    `<!-- boring-skill:start name=${appendix.name} digest=${appendix.digest} -->`,
    appendix.content,
    `<!-- boring-skill:end name=${appendix.name} -->`,
  ].join('\n')
}

function frozenJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenJson))
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, frozenJson(entry)]),
    ))
  }
  return value
}

async function validateAppendices(
  appendices: readonly TrustedAgentInstructionAppendix[],
): Promise<readonly TrustedAgentInstructionAppendix[]> {
  const seen = new Set<string>()
  const validated: TrustedAgentInstructionAppendix[] = []
  for (const [index, appendix] of appendices.entries()) {
    const field = `policy.instructionAppendices[${index}]`
    if (!APPENDIX_NAME_RE.test(appendix.name)) {
      throw new TrustedAgentCompositionError(`${field}.name`, 'instruction appendix name is invalid')
    }
    if (seen.has(appendix.name)) {
      throw new TrustedAgentCompositionError(`${field}.name`, 'instruction appendix name is duplicated')
    }
    if (appendix.content.trim().length === 0) {
      throw new TrustedAgentCompositionError(`${field}.content`, 'instruction appendix content is empty')
    }
    if (await createAgentAssetDigest(appendix.content) !== appendix.digest) {
      throw new TrustedAgentCompositionError(`${field}.digest`, 'instruction appendix digest does not match content')
    }
    seen.add(appendix.name)
    validated.push(Object.freeze({ ...appendix }))
  }
  return Object.freeze(validated)
}

/**
 * Maps identity-only authored data into AgentHost configuration. Every behavior
 * input is supplied separately by trusted host composition.
 */
export async function createConfiguredAgentHostAgentSpec(
  input: CreateConfiguredAgentHostAgentSpecInput,
): Promise<ConfiguredAgentHostAgentSpec> {
  const policy = input.policy ?? {}
  const label = nonEmpty(input.source.label) ?? nonEmpty(policy.fallbackLabel)
  if (!label) {
    throw new TrustedAgentCompositionError('policy.fallbackLabel', 'configured agent label is required')
  }
  const appendices = await validateAppendices(policy.instructionAppendices ?? [])
  const instructions = [
    input.source.instructions,
    ...appendices.map(instructionBlock),
  ].join('\n\n')
  const plugins = policy.plugins?.map((plugin) => Object.freeze({
    name: plugin.name,
    ...(plugin.config === undefined ? {} : { config: frozenJson(plugin.config) }),
  }))
  const preferredModel = nonEmpty(policy.preferredModel)
  const instructionFiles = policy.instructionFiles?.length
    ? Object.freeze(policy.instructionFiles.map((file) => Object.freeze({ ...file })))
    : undefined

  return Object.freeze({
    agentTypeId: input.source.agentTypeId,
    definition: Object.freeze({
      instructions,
      label,
      version: input.source.version,
    }),
    ...(instructionFiles ? { instructionFiles } : {}),
    ...(plugins?.length ? { plugins: Object.freeze(plugins) } : {}),
    ...(preferredModel ? { model: Object.freeze({ preferred: preferredModel }) } : {}),
  })
}
