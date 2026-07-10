import { z } from 'zod'

export type Sha256Digest = `sha256:${string}`

export interface AgentDefinition {
  schemaVersion: 1
  definitionId: string
  version: string
  label?: string
  instructionsRef: string
  capabilityRequirements?: string[]
  toolRefs?: string[]
  skillRefs?: string[]
  mcpServerRefs?: string[]
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

export type AgentDefinitionErrorCode =
  | 'AGENT_DEFINITION_INVALID'
  | 'AGENT_DEFINITION_UNSUPPORTED_FIELD'

export type AgentDeploymentErrorCode =
  | 'AGENT_DEPLOYMENT_INVALID'
  | 'AGENT_DEPLOYMENT_UNSUPPORTED_FIELD'

export interface AgentSchemaIssue<Code extends string> {
  code: Code
  field: string
  message: string
}

export type AgentSchemaValidationResult<T, Code extends string> =
  | { valid: true; value: T }
  | { valid: false; issues: AgentSchemaIssue<Code>[] }

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

const OpaqueRefSchema = z
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

const SafeAssetPathSchema = z
  .string()
  .min(1)
  .refine(isSafeAssetPath, 'must be a safe relative asset path')

const Sha256DigestSchema = z
  .string()
  .regex(SHA256_DIGEST_RE, 'must be a lowercase sha256 digest')
  .transform((value) => value as Sha256Digest)

const AgentDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    definitionId: OpaqueRefSchema,
    version: OpaqueRefSchema,
    label: z.string().refine(hasWellFormedUnicode, 'must contain well-formed Unicode').optional(),
    instructionsRef: SafeAssetPathSchema,
    capabilityRequirements: ReferenceArraySchema.optional(),
    toolRefs: ReferenceArraySchema.optional(),
    skillRefs: ReferenceArraySchema.optional(),
    mcpServerRefs: ReferenceArraySchema.optional(),
  })
  .strict()

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

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '<root>'
  return path.reduce<string>(
    (result, part) =>
      typeof part === 'number'
        ? `${result}[${part}]`
        : result.length === 0
          ? String(part)
          : `${result}.${String(part)}`,
    '',
  )
}

function mapZodIssues<Code extends string>(
  issues: z.ZodIssue[],
  invalidCode: Code,
  unsupportedCode: Code,
): AgentSchemaIssue<Code>[] {
  return issues.flatMap((issue) => {
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      const parent = formatPath(issue.path)
      return [...issue.keys].sort().map((key) => ({
        code: unsupportedCode,
        field: parent === '<root>' ? key : `${parent}.${key}`,
        message: `${key} is not supported by schema version 1`,
      }))
    }
    const field = formatPath(issue.path)
    return [{
      code: invalidCode,
      field,
      message: field === '<root>' ? issue.message : `${field} ${issue.message}`,
    }]
  })
}

export function validateAgentDefinition(
  raw: unknown,
): AgentSchemaValidationResult<AgentDefinition, AgentDefinitionErrorCode> {
  const result = AgentDefinitionSchema.safeParse(raw)
  if (!result.success) {
    return {
      valid: false,
      issues: mapZodIssues(
        result.error.issues,
        'AGENT_DEFINITION_INVALID',
        'AGENT_DEFINITION_UNSUPPORTED_FIELD',
      ),
    }
  }
  return { valid: true, value: result.data }
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
        'AGENT_DEPLOYMENT_INVALID',
        'AGENT_DEPLOYMENT_UNSUPPORTED_FIELD',
      ),
    }
  }
  return { valid: true, value: result.data }
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError('Cannot canonicalize undefined')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    .join(',')}}`
}

async function sha256(value: string): Promise<Sha256Digest> {
  const hash = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  const hex = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `sha256:${hex}`
}

export class AgentDefinitionValidationError extends Error {
  readonly code = 'CONFIG_INVALID' as const
  readonly field: string
  readonly validationCode: AgentDefinitionErrorCode

  constructor(issue: AgentSchemaIssue<AgentDefinitionErrorCode>) {
    super(issue.message)
    this.name = 'AgentDefinitionValidationError'
    this.field = issue.field
    this.validationCode = issue.code
  }
}

export class AgentDeploymentValidationError extends Error {
  readonly code = 'CONFIG_INVALID' as const
  readonly field: string
  readonly validationCode: AgentDeploymentErrorCode

  constructor(issue: AgentSchemaIssue<AgentDeploymentErrorCode>) {
    super(issue.message)
    this.name = 'AgentDeploymentValidationError'
    this.field = issue.field
    this.validationCode = issue.code
  }
}

async function validatedDefinitionAssets(
  definition: AgentDefinition,
  assets: readonly AgentDefinitionDigestAsset[],
): Promise<AgentDefinitionDigestAsset[]> {
  if (!Array.isArray(assets)) {
    throw new AgentDefinitionValidationError({
      code: 'AGENT_DEFINITION_INVALID',
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
        'AGENT_DEFINITION_INVALID',
        'AGENT_DEFINITION_UNSUPPORTED_FIELD',
      )[0]
      throw new AgentDefinitionValidationError({
        ...issue,
        field: `assets[${index}].${issue.field}`,
      })
    }
    if (await sha256(result.data.content) !== result.data.digest) {
      throw new AgentDefinitionValidationError({
        code: 'AGENT_DEFINITION_INVALID',
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
        code: 'AGENT_DEFINITION_INVALID',
        field: 'assets.path',
        message: `duplicate asset path: ${canonicalAssets[index].path}`,
      })
    }
  }
  if (!canonicalAssets.some((asset) => asset.path === definition.instructionsRef)) {
    throw new AgentDefinitionValidationError({
      code: 'AGENT_DEFINITION_INVALID',
      field: 'instructionsRef',
      message: 'instructionsRef must name an included verified asset',
    })
  }
  return canonicalAssets
}

export async function createAgentDefinitionDigest(input: {
  definition: AgentDefinition
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
