import { z } from 'zod'

import {
  AgentDefinitionValidationError,
  AgentDeploymentValidationError,
  OpaqueRefSchema,
  Sha256DigestSchema,
  createAgentAssetDigest,
  createAgentDefinitionDigest,
  createAgentDeploymentDigest,
  validateAgentDeployment,
  type AgentDeployment,
  type CompiledAgentBundle,
  type Sha256Digest,
} from '../../shared/agent-definition'
import { canonicalStringify } from '../../shared/digest'
import {
  AgentDefinitionErrorCode,
  AgentDeploymentErrorCode,
} from '../../shared/error-codes'

const AuthorizedAgentDeploymentBindingSchema = z
  .object({
    workspaceId: OpaqueRefSchema,
    defaultDeploymentId: OpaqueRefSchema,
    workspaceCompositionDigest: Sha256DigestSchema,
  })

const RESOLVED_AGENT_DIGEST_DOMAIN = 'boring-agent/resolved-agent:v1'

const ResolvedAgentDigestInputSchema = z.object({
  workspaceId: OpaqueRefSchema,
  defaultDeploymentId: OpaqueRefSchema,
  workspaceCompositionDigest: Sha256DigestSchema,
  definitionDigest: Sha256DigestSchema,
  deploymentDigest: Sha256DigestSchema,
}).strict()

export interface ResolvedAgentDigestInput {
  readonly workspaceId: string
  readonly defaultDeploymentId: string
  readonly workspaceCompositionDigest: Sha256Digest
  readonly definitionDigest: Sha256Digest
  readonly deploymentDigest: Sha256Digest
}

export async function createResolvedAgentDigest(input: ResolvedAgentDigestInput): Promise<Sha256Digest> {
  const parsed = ResolvedAgentDigestInputSchema.safeParse(input)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    const digestField = typeof field === 'string' ? field : 'workspaceId'
    throw invalidDeployment(digestField, `${digestField} is invalid`)
  }
  return createAgentAssetDigest(canonicalStringify({ domain: RESOLVED_AGENT_DIGEST_DOMAIN, ...parsed.data }))
}

export interface ResolvedAgent {
  readonly workspace: Readonly<{
    workspaceId: string
    defaultDeploymentId: string
    compositionDigest: Sha256Digest
  }>
  readonly deployment: Readonly<{
    deploymentId: string
    version: string
    agentId: string
    digest: Sha256Digest
  }>
  readonly definition: Readonly<{
    definitionId: string
    version: string
    digest: Sha256Digest
    instructionsRef: string
  }>
  readonly instructions: Readonly<{
    ref: string
    content: string
  }>
  readonly resolvedDigest: Sha256Digest
}

function invalidDefinition(field: string, message: string): AgentDefinitionValidationError {
  return new AgentDefinitionValidationError({
    code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    field,
    message,
  })
}

function invalidDeployment(field: string, message: string): AgentDeploymentValidationError {
  return new AgentDeploymentValidationError({
    code: AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_INVALID,
    field,
    message,
  })
}

function parseBinding(raw: unknown): z.infer<typeof AuthorizedAgentDeploymentBindingSchema> {
  const parsed = AuthorizedAgentDeploymentBindingSchema.safeParse(raw)
  if (parsed.success) return parsed.data

  const issue = parsed.error.issues[0]
  const field = issue.path[0]
  const bindingField = typeof field === 'string' ? field : 'workspaceId'
  throw invalidDeployment(bindingField, `${bindingField} ${issue.message}`)
}

function assertEqual(
  actual: string,
  expected: string,
  field: string,
): void {
  if (actual !== expected) {
    throw invalidDeployment(field, `${field} does not match the compiled agent bundle`)
  }
}

export async function resolveAgentDeployment(
  bundle: CompiledAgentBundle,
  deployment: AgentDeployment,
  authorizedBinding: unknown,
): Promise<ResolvedAgent> {
  const binding = parseBinding(authorizedBinding)
  const definitionDigest = await createAgentDefinitionDigest({
    definition: bundle.definition,
    assets: bundle.assets,
  })
  if (definitionDigest !== bundle.definitionDigest) {
    throw invalidDefinition(
      'definitionDigest',
      'definitionDigest does not match the compiled agent bundle',
    )
  }

  const validatedDeployment = validateAgentDeployment(deployment)
  if (!validatedDeployment.valid) {
    throw new AgentDeploymentValidationError(validatedDeployment.issues[0])
  }
  const deploymentSnapshot = validatedDeployment.value
  const deploymentDigest = await createAgentDeploymentDigest(deploymentSnapshot)
  assertEqual(
    deploymentSnapshot.definition.definitionId,
    bundle.definition.definitionId,
    'definition.definitionId',
  )
  assertEqual(
    deploymentSnapshot.definition.version,
    bundle.definition.version,
    'definition.version',
  )
  assertEqual(deploymentSnapshot.definition.digest, definitionDigest, 'definition.digest')
  if (deploymentSnapshot.agentId !== 'default') {
    throw invalidDeployment('agentId', 'agentId must be default in schema version 1')
  }
  if (binding.defaultDeploymentId !== deploymentSnapshot.deploymentId) {
    throw invalidDeployment(
      'defaultDeploymentId',
      'defaultDeploymentId does not match the resolved deployment',
    )
  }

  const instructions = bundle.assets.find(
    (asset) => asset.path === bundle.definition.instructionsRef,
  )
  if (instructions === undefined) {
    throw invalidDefinition(
      'instructionsRef',
      'instructionsRef must name an included verified asset',
    )
  }

  const resolvedDigest = await createResolvedAgentDigest({
    workspaceId: binding.workspaceId,
    defaultDeploymentId: binding.defaultDeploymentId,
    workspaceCompositionDigest: binding.workspaceCompositionDigest,
    definitionDigest,
    deploymentDigest,
  })

  const workspace = Object.freeze({
    workspaceId: binding.workspaceId,
    defaultDeploymentId: binding.defaultDeploymentId,
    compositionDigest: binding.workspaceCompositionDigest,
  })
  const resolvedDeployment = Object.freeze({
    deploymentId: deploymentSnapshot.deploymentId,
    version: deploymentSnapshot.version,
    agentId: deploymentSnapshot.agentId,
    digest: deploymentDigest,
  })
  const definition = Object.freeze({
    definitionId: bundle.definition.definitionId,
    version: bundle.definition.version,
    digest: definitionDigest,
    instructionsRef: bundle.definition.instructionsRef,
  })
  const resolvedInstructions = Object.freeze({
    ref: bundle.definition.instructionsRef,
    content: instructions.content,
  })

  return Object.freeze({
    workspace,
    deployment: resolvedDeployment,
    definition,
    instructions: resolvedInstructions,
    resolvedDigest,
  })
}
