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

type AuthoredToolSnapshot = Readonly<{
  name: string
  description: string
  promptSnippet?: string
  readinessRequirements?: ToolReadinessRequirement[]
  parameters: JSONSchema
  execute: AgentTool['execute']
}>

function invalidTool(field: string, message: string): never {
  materializationError({
    code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
    field,
    message,
  })
}

function ownDataValue(source: object, property: string, field: string, required: boolean): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, property)
  } catch {
    invalidTool(field, 'authored tool catalog entry is invalid')
  }
  if (descriptor === undefined) {
    if (required) invalidTool(field, 'authored tool catalog entry is invalid')
    return undefined
  }
  if (!('value' in descriptor)) invalidTool(field, 'authored tool catalog entry is invalid')
  return descriptor.value
}

function copyToolReadinessRequirements(value: unknown, field: string): ToolReadinessRequirement[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) invalidTool(field, 'authored tool readiness requirements are invalid')

  const requirements: ToolReadinessRequirement[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalidTool(field, 'authored tool readiness requirements are invalid')
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, index)
    } catch {
      invalidTool(field, 'authored tool readiness requirements are invalid')
    }
    if (descriptor === undefined || !('value' in descriptor)) {
      invalidTool(field, 'authored tool readiness requirements are invalid')
    }
    if (!isToolReadinessRequirement(descriptor.value)) {
      invalidTool(field, 'authored tool readiness requirements are invalid')
    }
    requirements[index] = descriptor.value
  }
  return requirements
}

function assertAuthoredTool(value: unknown, field: string): AuthoredToolSnapshot {
  if (typeof value !== 'object' || value === null) {
    invalidTool(field, 'authored tool catalog entry is invalid')
  }

  const name = ownDataValue(value, 'name', `${field}.name`, true)
  if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) {
    invalidTool(`${field}.name`, 'authored tool name is invalid')
  }

  const description = ownDataValue(value, 'description', `${field}.description`, true)
  if (typeof description !== 'string' || description.trim().length === 0) {
    invalidTool(`${field}.description`, 'authored tool description is invalid')
  }

  const promptSnippet = ownDataValue(value, 'promptSnippet', `${field}.promptSnippet`, false)
  if (promptSnippet !== undefined && typeof promptSnippet !== 'string') {
    invalidTool(`${field}.promptSnippet`, 'authored tool prompt snippet is invalid')
  }

  const parameters = ownDataValue(value, 'parameters', `${field}.parameters`, true)
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    invalidTool(`${field}.parameters`, 'authored tool parameters schema is invalid')
  }

  const readinessRequirements = copyToolReadinessRequirements(
    ownDataValue(value, 'readinessRequirements', `${field}.readinessRequirements`, false),
    `${field}.readinessRequirements`,
  )

  const execute = ownDataValue(value, 'execute', `${field}.execute`, true)
  if (typeof execute !== 'function') {
    invalidTool(`${field}.execute`, 'authored tool execute handler is invalid')
  }

  return {
    name,
    description,
    ...(promptSnippet === undefined ? {} : { promptSnippet }),
    ...(readinessRequirements === undefined ? {} : { readinessRequirements }),
    parameters: parameters as JSONSchema,
    execute: execute as AgentTool['execute'],
  }
}

function invalidParameters(field: string): never {
  materializationError({
    code: ErrorCode.enum.AUTHORED_AGENT_TOOL_INVALID,
    field,
    message: 'authored tool parameters schema is invalid',
  })
}

function isPlainJsonObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length
}

function ownKeysForJson(value: object, field: string): string[] {
  let ownKeys: (string | symbol)[]
  try {
    ownKeys = Reflect.ownKeys(value)
  } catch {
    invalidParameters(field)
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) invalidParameters(field)
  return ownKeys as string[]
}

function ownDataDescriptorForJson(value: object, key: string, field: string): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    invalidParameters(field)
  }
  if (descriptor === undefined || !('value' in descriptor)) invalidParameters(field)
  return descriptor
}

function cloneAndFreezeJson(value: unknown, field: string, active = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : invalidParameters(field)
  if (typeof value !== 'object') invalidParameters(field)

  if (active.has(value)) invalidParameters(field)
  active.add(value)
  try {
    const ownStringKeys = ownKeysForJson(value, field)

    if (Array.isArray(value)) {
      const length = value.length
      for (let index = 0; index < length; index += 1) {
        if (!Object.hasOwn(value, index)) invalidParameters(field)
      }
      for (const key of ownStringKeys) {
        if (key !== 'length' && !isArrayIndexKey(key, length)) invalidParameters(field)
      }
      const copy: unknown[] = new Array(length)
      for (let index = 0; index < length; index += 1) {
        const descriptor = ownDataDescriptorForJson(value, String(index), field)
        copy[index] = cloneAndFreezeJson(descriptor.value, field, active)
      }
      return Object.freeze(copy)
    }

    if (!isPlainJsonObject(value)) invalidParameters(field)

    const copy = Object.create(null) as Record<string, unknown>
    for (const key of ownStringKeys) {
      const descriptor = ownDataDescriptorForJson(value, key, field)
      Object.defineProperty(copy, key, {
        value: cloneAndFreezeJson(descriptor.value, field, active),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return Object.freeze(copy)
  } finally {
    active.delete(value)
  }
}

function freezeReadinessRequirements(requirements: readonly ToolReadinessRequirement[]): ToolReadinessRequirement[] {
  const copy: ToolReadinessRequirement[] = new Array(requirements.length)
  for (let index = 0; index < requirements.length; index += 1) {
    copy[index] = requirements[index]!
  }
  return Object.freeze(copy) as ToolReadinessRequirement[]
}

function freezeAuthoredTool(tool: AuthoredToolSnapshot, field: string): AgentTool {
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    ...(tool.promptSnippet === undefined ? {} : { promptSnippet: tool.promptSnippet }),
    ...(tool.readinessRequirements === undefined
      ? {}
      : { readinessRequirements: freezeReadinessRequirements(tool.readinessRequirements) }),
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
