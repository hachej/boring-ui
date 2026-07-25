import { compileAgentDirectory } from './compileAgentDirectory'
import { AgentDefinitionValidationError } from '../../shared/agent-definition'
import {
  AgentDefinitionErrorCode,
  ErrorCode,
  type ErrorCode as AgentErrorCode,
} from '../../shared/error-codes'

export type AuthoredAgentMaterializationErrorCode = Extract<
  AgentErrorCode,
  | 'AUTHORED_AGENT_ID_INVALID'
  | 'AUTHORED_AGENT_TYPE_MISMATCH'
  | 'AUTHORED_AGENT_REFERENCE_UNSUPPORTED'
>

export type AuthoredAgentSourceV1 = Readonly<{
  schemaVersion: 1
  agentTypeId: string
  version: string
  label?: string
  description?: string
  instructions: string
}>

export interface MaterializeAgentDirectoryInput {
  directory: string
  expectedAgentTypeId?: string
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

/**
 * Loads declarative authored identity, safe metadata, and instructions.
 * Executable behavior is selected only by trusted host/plugin policy.
 */
export async function materializeAgentDirectory(
  input: MaterializeAgentDirectoryInput,
): Promise<AuthoredAgentSourceV1> {
  let bundle: Awaited<ReturnType<typeof compileAgentDirectory>>
  try {
    bundle = await compileAgentDirectory(input.directory)
  } catch (error) {
    if (
      error instanceof AgentDefinitionValidationError &&
      error.validationCode === AgentDefinitionErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED
    ) {
      throw new AuthoredAgentMaterializationError({
        code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
        field: error.field,
        message: error.message,
      })
    }
    throw error
  }
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

  const instructions = bundle.assets.find(
    (asset) => asset.path === definition.instructionsRef,
  )?.content
  if (instructions === undefined) {
    throw Object.assign(new Error('compiled agent instructions asset is missing'), {
      code: ErrorCode.enum.INTERNAL_ERROR,
      field: 'instructionsRef',
    })
  }

  return Object.freeze({
    schemaVersion: 1,
    agentTypeId: definition.definitionId,
    version: definition.version,
    ...(definition.label === undefined ? {} : { label: definition.label }),
    ...(definition.description === undefined ? {} : { description: definition.description }),
    instructions,
  })
}
