import { compileAgentDirectory } from './compileAgentDirectory'
import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import type { AgentTool } from '../../shared/tool'

export type AuthoredAgentMaterializationErrorCode = Extract<
  AgentErrorCode,
  | 'AUTHORED_AGENT_ID_INVALID'
  | 'AUTHORED_AGENT_TYPE_MISMATCH'
  | 'AUTHORED_AGENT_CATALOG_REQUIRED'
  | 'AUTHORED_AGENT_REFERENCE_UNKNOWN'
  | 'AUTHORED_AGENT_REFERENCE_UNSUPPORTED'
  | 'AUTHORED_AGENT_TOOL_INVALID'
  | 'AUTHORED_AGENT_TOOL_COLLISION'
>

export type MaterializedAgentSourceV1 = Readonly<{
  schemaVersion: 1
  agentTypeId: string
  version: string
  label?: string
  instructions: string
  tools: readonly AgentTool[]
  declaredToolRefs: readonly string[]
}>

export interface MaterializeAgentDirectoryInput {
  directory: string
  expectedAgentTypeId?: string
  toolCatalog?: ReadonlyMap<string, AgentTool>
}

export class AuthoredAgentMaterializationError extends Error {
  readonly code: AuthoredAgentMaterializationErrorCode
  readonly field?: string

  constructor(input: {
    code: AuthoredAgentMaterializationErrorCode
    field?: string
    message: string
  }) {
    super(input.message)
    this.name = 'AuthoredAgentMaterializationError'
    this.code = input.code
    if (input.field !== undefined) this.field = input.field
  }
}

const AGENT_TYPE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/

function assertAgentTypeId(field: string, value: string): void {
  if (!AGENT_TYPE_ID_RE.test(value)) {
    throw new AuthoredAgentMaterializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_ID_INVALID,
      field,
      message: `${field} must match ^[a-z][a-z0-9-]{0,62}$`,
    })
  }
}

function assertNoUnsupportedRefs(field: string, refs: readonly string[] | undefined): void {
  if (refs !== undefined && refs.length > 0) {
    throw new AuthoredAgentMaterializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
      field,
      message: `${field} are not supported by authored agent materialization v1`,
    })
  }
}

export async function materializeAgentDirectory(
  input: MaterializeAgentDirectoryInput,
): Promise<MaterializedAgentSourceV1> {
  void input.toolCatalog
  const bundle = await compileAgentDirectory(input.directory)
  const { definition } = bundle

  assertAgentTypeId('definitionId', definition.definitionId)
  if (input.expectedAgentTypeId !== undefined) {
    assertAgentTypeId('expectedAgentTypeId', input.expectedAgentTypeId)
    if (definition.definitionId !== input.expectedAgentTypeId) {
      throw new AuthoredAgentMaterializationError({
        code: ErrorCode.enum.AUTHORED_AGENT_TYPE_MISMATCH,
        field: 'expectedAgentTypeId',
        message: 'expected agent type does not match definitionId',
      })
    }
  }

  assertNoUnsupportedRefs('capabilityRequirements', definition.capabilityRequirements)
  assertNoUnsupportedRefs('skillRefs', definition.skillRefs)
  assertNoUnsupportedRefs('mcpServerRefs', definition.mcpServerRefs)

  const declaredToolRefs = Object.freeze([...(definition.toolRefs ?? [])])
  if (declaredToolRefs.length > 0) {
    throw new AuthoredAgentMaterializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_CATALOG_REQUIRED,
      field: 'toolRefs',
      message: 'authored tool references require a trusted server catalog',
    })
  }

  const instructions = bundle.assets.find(
    (asset) => asset.path === definition.instructionsRef,
  )?.content
  if (instructions === undefined) {
    throw Object.assign(new Error('compiled agent instructions asset is missing'), {
      code: ErrorCode.enum.INTERNAL_ERROR,
      field: 'instructionsRef',
    })
  }

  const tools = Object.freeze([] as AgentTool[])
  return Object.freeze({
    schemaVersion: 1,
    agentTypeId: definition.definitionId,
    version: definition.version,
    ...(definition.label === undefined ? {} : { label: definition.label }),
    instructions,
    tools,
    declaredToolRefs,
  })
}
