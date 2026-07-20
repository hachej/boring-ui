import { z } from 'zod'

import { canonicalStringify, sha256, type Sha256Digest } from './digest'
import {
  AgentDefinitionErrorCode,
  AgentDeploymentErrorCode,
} from './error-codes'
import {
  SchemaValidationError,
  formatPath,
  mapZodIssues,
  type AgentSchemaIssue,
  type AgentSchemaValidationResult,
} from './schema-issue'

export type { Sha256Digest }
export type { AgentSchemaIssue, AgentSchemaValidationResult }

export interface AgentDefinition {
  schemaVersion: 1
  definitionId: string
  version: string
  label?: string
  description?: string
  instructionsRef: string
}

export interface AgentDefinitionReference {
  definitionId: string
  version: string
  digest: Sha256Digest
}

export interface AgentDeployment {
  deploymentId: string
  version: string
  agentId: string
  definition: AgentDefinitionReference
}

export interface AgentDefinitionDigestAsset {
  path: string
  digest: Sha256Digest
  content: string
}

export type CompiledAgentDefinition = {
  readonly [Key in keyof AgentDefinition]: AgentDefinition[Key] extends
    | readonly string[]
    | undefined
    ? readonly string[] | undefined
    : AgentDefinition[Key]
}

export interface CompiledAgentBundle {
  readonly definition: CompiledAgentDefinition
  readonly definitionDigest: Sha256Digest
  readonly assets: readonly Readonly<AgentDefinitionDigestAsset>[]
}

const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/

function hasWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function isOpaqueRef(value: string): boolean {
  return (
    hasWellFormedUnicode(value) &&
    value.trim() === value &&
    !/[\0-\x1f\x7f]/.test(value)
  )
}

function isSafeAssetPath(value: string): boolean {
  const segments = value.split('/')
  return (
    hasWellFormedUnicode(value) &&
    value.normalize('NFC') === value &&
    !/[\0-\x1f\x7f]/.test(value) &&
    !value.includes('\\') &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/.test(value) &&
    !value.startsWith('./') &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}

export const OpaqueRefSchema = z
  .string()
  .min(1, 'must be a non-empty reference')
  .max(256, 'must be at most 256 characters')
  .refine(isOpaqueRef, 'must be a non-empty reference')

const ReferenceArraySchema = z.array(OpaqueRefSchema).superRefine((refs, ctx) => {
  const seen = new Set<string>()
  refs.forEach((ref, index) => {
    if (seen.has(ref)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: 'must not contain duplicate references',
      })
    }
    seen.add(ref)
  })
})

const LABEL_MAX_LENGTH = 128
const DESCRIPTION_MAX_LENGTH = 1_024

function isSafeDisplayText(value: string): boolean {
  return (
    hasWellFormedUnicode(value) &&
    value.trim() === value &&
    !/[\0-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(value)
  )
}

const LabelSchema = z
  .string()
  .min(1, 'must not be empty')
  .max(LABEL_MAX_LENGTH, `must be at most ${LABEL_MAX_LENGTH} characters`)
  .refine(isSafeDisplayText, 'must be trimmed and contain no control characters')

const DescriptionSchema = z
  .string()
  .min(1, 'must not be empty')
  .max(DESCRIPTION_MAX_LENGTH, `must be at most ${DESCRIPTION_MAX_LENGTH} characters`)
  .refine(isSafeDisplayText, 'must be trimmed and contain no control characters')

const SafeAssetPathSchema = z
  .string()
  .min(1)
  .refine(isSafeAssetPath, 'must be a safe relative asset path')

export const Sha256DigestSchema = z
  .string()
  .regex(SHA256_DIGEST_RE, 'must be a lowercase sha256 digest')
  .transform((value) => value as Sha256Digest)

const AgentDefinitionInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    definitionId: OpaqueRefSchema,
    version: OpaqueRefSchema,
    label: LabelSchema.optional(),
    description: DescriptionSchema.optional(),
    instructionsRef: SafeAssetPathSchema,
    // Empty legacy arrays remain parseable only so old declarative directories
    // fail with a targeted migration error when they still select behavior.
    capabilityRequirements: ReferenceArraySchema.optional(),
    toolRefs: ReferenceArraySchema.optional(),
    skillRefs: ReferenceArraySchema.optional(),
    mcpServerRefs: ReferenceArraySchema.optional(),
  })
  .strict()

const LEGACY_REFERENCE_FIELDS = [
  'capabilityRequirements',
  'toolRefs',
  'skillRefs',
  'mcpServerRefs',
] as const

const AgentDefinitionReferenceSchema = z
  .object({
    definitionId: OpaqueRefSchema,
    version: OpaqueRefSchema,
    digest: Sha256DigestSchema,
  })
  .strict()

const AgentDeploymentSchema = z
  .object({
    deploymentId: OpaqueRefSchema,
    version: OpaqueRefSchema,
    agentId: OpaqueRefSchema,
    definition: AgentDefinitionReferenceSchema,
  })
  .strict()

const AgentDefinitionDigestAssetSchema = z.object({
  path: SafeAssetPathSchema,
  digest: Sha256DigestSchema,
  content: z.string().refine(hasWellFormedUnicode, 'must contain well-formed Unicode'),
}).strict()

export function validateAgentDefinition(
  raw: unknown,
): AgentSchemaValidationResult<AgentDefinition, AgentDefinitionErrorCode> {
  const result = AgentDefinitionInputSchema.safeParse(raw)
  if (!result.success) {
    return {
      valid: false,
      issues: mapZodIssues(
        result.error.issues,
        AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
        AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
      ),
    }
  }

  for (const field of LEGACY_REFERENCE_FIELDS) {
    if ((result.data[field]?.length ?? 0) > 0) {
      return {
        valid: false,
        issues: [{
          code: AgentDefinitionErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
          field,
          message: `${field} cannot select behavior; configure trusted host plugins instead`,
        }],
      }
    }
  }

  return {
    valid: true,
    value: {
      schemaVersion: result.data.schemaVersion,
      definitionId: result.data.definitionId,
      version: result.data.version,
      ...(result.data.label === undefined ? {} : { label: result.data.label }),
      ...(result.data.description === undefined ? {} : { description: result.data.description }),
      instructionsRef: result.data.instructionsRef,
    },
  }
}

export function validateAgentDeployment(
  raw: unknown,
): AgentSchemaValidationResult<AgentDeployment, AgentDeploymentErrorCode> {
  const result = AgentDeploymentSchema.safeParse(raw)
  if (!result.success) {
    return {
      valid: false,
      issues: mapZodIssues(
        result.error.issues,
        AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_INVALID,
        AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_UNSUPPORTED_FIELD,
      ),
    }
  }
  return { valid: true, value: result.data }
}

export async function createAgentAssetDigest(content: string): Promise<Sha256Digest> {
  if (!hasWellFormedUnicode(content)) {
    throw new AgentDefinitionValidationError({
      code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
      field: 'content',
      message: 'content must contain well-formed Unicode',
    })
  }
  return sha256(content)
}

export class AgentDefinitionValidationError extends SchemaValidationError<AgentDefinitionErrorCode> {
  constructor(issue: AgentSchemaIssue<AgentDefinitionErrorCode>) {
    super(issue)
    this.name = 'AgentDefinitionValidationError'
  }
}

export class AgentDeploymentValidationError extends SchemaValidationError<AgentDeploymentErrorCode> {
  constructor(issue: AgentSchemaIssue<AgentDeploymentErrorCode>) {
    super(issue)
    this.name = 'AgentDeploymentValidationError'
  }
}

async function validatedDefinitionAssets(
  definition: CompiledAgentDefinition,
  assets: readonly AgentDefinitionDigestAsset[],
): Promise<AgentDefinitionDigestAsset[]> {
  if (!Array.isArray(assets)) {
    throw new AgentDefinitionValidationError({
      code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
      field: 'assets',
      message: 'assets must be an array',
    })
  }
  const canonicalAssets: AgentDefinitionDigestAsset[] = []
  for (const [index, input] of assets.entries()) {
    const result = AgentDefinitionDigestAssetSchema.safeParse(input)
    if (!result.success) {
      const issue = mapZodIssues(
        result.error.issues,
        AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
        AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
      )[0]
      throw new AgentDefinitionValidationError({
        ...issue,
        field: `assets[${index}].${issue.field}`,
      })
    }
    if (await createAgentAssetDigest(result.data.content) !== result.data.digest) {
      throw new AgentDefinitionValidationError({
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
        field: 'assets.digest',
        message: `asset digest does not match UTF-8 content: ${result.data.path}`,
      })
    }
    canonicalAssets.push(result.data)
  }

  canonicalAssets.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
  for (let index = 1; index < canonicalAssets.length; index += 1) {
    if (canonicalAssets[index - 1].path === canonicalAssets[index].path) {
      throw new AgentDefinitionValidationError({
        code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
        field: 'assets.path',
        message: `duplicate asset path: ${canonicalAssets[index].path}`,
      })
    }
  }
  if (!canonicalAssets.some((asset) => asset.path === definition.instructionsRef)) {
    throw new AgentDefinitionValidationError({
      code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
      field: 'instructionsRef',
      message: 'instructionsRef must name an included verified asset',
    })
  }
  return canonicalAssets
}

export async function createAgentDefinitionDigest(input: {
  definition: CompiledAgentDefinition
  assets: readonly AgentDefinitionDigestAsset[]
}): Promise<Sha256Digest> {
  const validated = validateAgentDefinition(input.definition)
  if (!validated.valid) throw new AgentDefinitionValidationError(validated.issues[0])
  const assets = await validatedDefinitionAssets(validated.value, input.assets)
  return sha256(canonicalStringify({ definition: validated.value, assets }))
}

export async function createAgentDeploymentDigest(
  deployment: AgentDeployment,
): Promise<Sha256Digest> {
  const validated = validateAgentDeployment(deployment)
  if (!validated.valid) throw new AgentDeploymentValidationError(validated.issues[0])
  return sha256(canonicalStringify(validated.value))
}
