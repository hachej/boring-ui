import { compileAgentDirectory } from './compileAgentDirectory'
import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import type { AgentTool, JSONSchema, ToolReadinessRequirement } from '../../shared/tool'

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

export type AuthoredAgentToolCatalog = ReadonlyMap<string, AgentTool>

export interface MaterializeAgentDirectoryInput {
  directory: string
  expectedAgentTypeId?: string
  toolCatalog?: AuthoredAgentToolCatalog
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
const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/
const FIXED_TOOL_READINESS_REQUIREMENTS = new Set<ToolReadinessRequirement>([
  'workspace-fs',
  'sandbox-exec',
  'ui-bridge',
  'runtime-dependencies',
])

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

function materializationError(input: {
  code: AuthoredAgentMaterializationErrorCode
  field: string
  message: string
}): never {
  throw new AuthoredAgentMaterializationError(input)
}

function isToolReadinessRequirement(value: unknown): value is ToolReadinessRequirement {
  if (typeof value !== 'string') return false
  if (FIXED_TOOL_READINESS_REQUIREMENTS.has(value as ToolReadinessRequirement)) return true
  return /^runtime:[^\0-\x1f\x7f]+$/.test(value)
}

function isToolReadinessRequirementArray(value: unknown): value is ToolReadinessRequirement[] {
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value) || !isToolReadinessRequirement(value[index])) return false
  }
  return true
}

function assertAuthoredTool(value: unknown, field: string): AgentTool {
  if (typeof value !== 'object' || value === null) {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field,
      message: 'authored tool catalog entry is invalid',
    })
  }

  const tool = value as Partial<AgentTool>
  if (typeof tool.name !== 'string' || !TOOL_NAME_RE.test(tool.name)) {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: `${field}.name`,
      message: 'authored tool name is invalid',
    })
  }
  if (typeof tool.description !== 'string' || tool.description.trim().length === 0) {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: `${field}.description`,
      message: 'authored tool description is invalid',
    })
  }
  if (
    typeof tool.parameters !== 'object' ||
    tool.parameters === null ||
    Array.isArray(tool.parameters)
  ) {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: `${field}.parameters`,
      message: 'authored tool parameters schema is invalid',
    })
  }
  if (
    tool.readinessRequirements !== undefined &&
    !isToolReadinessRequirementArray(tool.readinessRequirements)
  ) {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: `${field}.readinessRequirements`,
      message: 'authored tool readiness requirements are invalid',
    })
  }
  if (typeof tool.execute !== 'function') {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field: `${field}.execute`,
      message: 'authored tool execute handler is invalid',
    })
  }

  return tool as AgentTool
}

function cloneAndFreezeJson(value: unknown, field: string, active = new WeakSet<object>()): unknown {
  if (typeof value !== 'object' || value === null) return value

  if (active.has(value)) {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
      field,
      message: 'authored tool parameters schema is invalid',
    })
  }
  active.add(value)
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => cloneAndFreezeJson(item, field, active)))
    }

    const copy: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      copy[key] = cloneAndFreezeJson(nestedValue, field, active)
    }
    return Object.freeze(copy)
  } finally {
    active.delete(value)
  }
}

function freezeAuthoredTool(tool: AgentTool, field: string): AgentTool {
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    ...(tool.promptSnippet === undefined ? {} : { promptSnippet: tool.promptSnippet }),
    ...(tool.readinessRequirements === undefined
      ? {}
      : { readinessRequirements: Object.freeze([...tool.readinessRequirements]) as ToolReadinessRequirement[] }),
    parameters: cloneAndFreezeJson(tool.parameters, `${field}.parameters`) as JSONSchema,
    execute: tool.execute,
  }) as AgentTool
}

function resolveDeclaredTools(input: {
  declaredToolRefs: readonly string[]
  toolCatalog?: AuthoredAgentToolCatalog
}): readonly AgentTool[] {
  if (input.declaredToolRefs.length === 0) return Object.freeze([] as AgentTool[])
  if (input.toolCatalog === undefined) {
    materializationError({
      code: ErrorCode.enum.AUTHORED_AGENT_CATALOG_REQUIRED,
      field: 'toolRefs',
      message: 'authored tool references require a trusted server catalog',
    })
  }

  const tools: AgentTool[] = []
  const resolvedNames = new Set<string>()
  input.declaredToolRefs.forEach((ref, index) => {
    const field = `toolRefs[${index}]`
    const catalogTool = input.toolCatalog!.get(ref)
    if (catalogTool === undefined) {
      materializationError({
        code: ErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNKNOWN,
        field,
        message: 'authored tool reference is not in the trusted catalog',
      })
    }

    const tool = freezeAuthoredTool(assertAuthoredTool(catalogTool, field), field)
    if (resolvedNames.has(tool.name)) {
      materializationError({
        code: ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION,
        field,
        message: 'authored tool catalog resolves duplicate tool names',
      })
    }
    resolvedNames.add(tool.name)
    tools.push(tool)
  })

  return Object.freeze(tools)
}

export async function materializeAgentDirectory(
  input: MaterializeAgentDirectoryInput,
): Promise<MaterializedAgentSourceV1> {
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
  const tools = resolveDeclaredTools({
    declaredToolRefs,
    toolCatalog: input.toolCatalog,
  })

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
    instructions,
    tools,
    declaredToolRefs,
  })
}
