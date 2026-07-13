// Agent-consumption contract types (AC1, Decision 22, issue #636).
//
// Types + zod schemas + pure validators for the task lifecycle that lets one
// agent be consumed by another (or by a human, via a binding). Semantics
// deliberately mirror A2A v1.0 so a future A2A binding is a thin adapter —
// see docs/DECISIONS.md #22 and
// docs/issues/391/runtime-refactor/IMPLEMENTATION-GUARDRAILS.md (AC1
// section) for the binding contract.
//
// Scope (binding, per the AC1 guardrail): types + validators ONLY. No
// dispatcher, no persistence, no routes, no task queue/broker. Concrete
// guard values (depth limit, input-required timeout) are NOT frozen here —
// they are ratified in the AC1 consumer-backed spec; this module exposes a
// configurable `ConsumptionGuards` type and a validator, not constants.

import { z } from 'zod'

import { AgentConsumptionErrorCode } from './error-codes'
import { SchemaValidationError, formatPath, type AgentSchemaIssue, type AgentSchemaValidationResult } from './schema-issue'

const nonEmptyString = z.string().min(1)

// ---------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------

export const TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
] as const

export type TaskState = (typeof TASK_STATES)[number]

export const TaskStateSchema = z.enum(TASK_STATES)

/**
 * Legal task-state transitions. Mirrors A2A v1.0 task lifecycle semantics:
 * `submitted` starts work, or is refused/withdrawn at intake (`rejected`/
 * `canceled`) before work begins; `working` settles into a terminal outcome
 * or pauses for input; `input-required` resumes into `working`, or is
 * `canceled` — the outcome the `inputRequiredTimeoutMs` guard drives when
 * the consumer never answers; every terminal state (`completed`/`failed`/
 * `canceled`/`rejected`) is final.
 */
const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  submitted: ['working', 'rejected', 'canceled'],
  working: ['input-required', 'completed', 'failed', 'canceled', 'rejected'],
  'input-required': ['working', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
  rejected: [],
}

export function isValidTaskTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

/** Throws {@link AgentConsumptionValidationError} (AGENT_CONSUMPTION_INVALID_TRANSITION) when illegal. */
export function assertValidTransition(from: TaskState, to: TaskState): void {
  if (!isValidTaskTransition(from, to)) {
    throw new AgentConsumptionValidationError({
      code: AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_INVALID_TRANSITION,
      field: 'state',
      message: `invalid task state transition: '${from}' -> '${to}'`,
    })
  }
}

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

/** The originating user + workspace a task is scoped to (audit: who asked). */
export interface PrincipalRef {
  userId: string
  workspaceId: string
}

export const PrincipalRefSchema = z
  .object({
    userId: nonEmptyString,
    workspaceId: nonEmptyString,
  })
  .strict() satisfies z.ZodType<PrincipalRef, z.ZodTypeDef, unknown>

/** An acting agent identity, recorded as `actor` for audit/provenance (who did it). */
export interface AgentRef {
  agentId: string
  deploymentId?: string
}

export const AgentRefSchema = z
  .object({
    agentId: nonEmptyString,
    deploymentId: nonEmptyString.optional(),
  })
  .strict() satisfies z.ZodType<AgentRef, z.ZodTypeDef, unknown>

export function agentRefEquals(a: AgentRef, b: AgentRef): boolean {
  return a.agentId === b.agentId && (a.deploymentId ?? null) === (b.deploymentId ?? null)
}

/** A reference to an artifact produced by a task (bytes live elsewhere; this is the pointer). */
export interface ArtifactRef {
  artifactId: string
  name?: string
  mimeType: string
  uri: string
}

export const ArtifactRefSchema = z
  .object({
    artifactId: nonEmptyString,
    name: z.string().optional(),
    mimeType: nonEmptyString,
    uri: nonEmptyString,
  })
  .strict() satisfies z.ZodType<ArtifactRef, z.ZodTypeDef, unknown>

// ---------------------------------------------------------------------------
// Messages / parts
// ---------------------------------------------------------------------------

export interface TextPart {
  type: 'text'
  text: string
}

export interface FilePart {
  type: 'file'
  file: ArtifactRef
}

export interface DataPart {
  type: 'data'
  mimeType: string
  // `z.unknown()` infers as `unknown | undefined` on an object field, so this
  // stays optional to match the schema's inferred type exactly.
  data?: unknown
}

export type Part = TextPart | FilePart | DataPart

export const PartSchema: z.ZodType<Part, z.ZodTypeDef, unknown> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('file'), file: ArtifactRefSchema }).strict(),
  z.object({ type: z.literal('data'), mimeType: nonEmptyString, data: z.unknown() }).strict(),
])

export interface AgentMessage {
  role: 'consumer' | 'agent'
  parts: Part[]
  ts: string
}

export const AgentMessageSchema = z
  .object({
    role: z.enum(['consumer', 'agent']),
    parts: z.array(PartSchema),
    ts: nonEmptyString,
  })
  .strict() satisfies z.ZodType<AgentMessage, z.ZodTypeDef, unknown>

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface AgentTask {
  id: string
  contextId: string
  state: TaskState
  messages: AgentMessage[]
  artifacts: ArtifactRef[]
  /** Originating user + workspace this task is scoped to. */
  principal: PrincipalRef
  /** Acting agent, recorded for audit/provenance. Absent for a human-driven task. */
  actor?: AgentRef
  schemaVersion: '1'
  createdAt: string
  updatedAt: string
}

export const AgentTaskSchema = z
  .object({
    id: nonEmptyString,
    contextId: nonEmptyString,
    state: TaskStateSchema,
    messages: z.array(AgentMessageSchema),
    artifacts: z.array(ArtifactRefSchema),
    principal: PrincipalRefSchema,
    actor: AgentRefSchema.optional(),
    schemaVersion: z.literal('1'),
    createdAt: nonEmptyString,
    updatedAt: nonEmptyString,
  })
  .strict() satisfies z.ZodType<AgentTask, z.ZodTypeDef, unknown>

function schemaMismatchIssues(issues: z.ZodIssue[]): AgentSchemaIssue<AgentConsumptionErrorCode>[] {
  return issues.map((issue) => {
    const field = formatPath(issue.path)
    return {
      code: AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_SCHEMA_MISMATCH,
      field,
      message: field === '<root>' ? issue.message : `${field} ${issue.message}`,
    }
  })
}

export function validateAgentTask(
  raw: unknown,
): AgentSchemaValidationResult<AgentTask, AgentConsumptionErrorCode> {
  const result = AgentTaskSchema.safeParse(raw)
  if (!result.success) {
    return { valid: false, issues: schemaMismatchIssues(result.error.issues) }
  }
  return { valid: true, value: result.data }
}

export class AgentConsumptionValidationError extends SchemaValidationError<AgentConsumptionErrorCode> {
  constructor(issue: AgentSchemaIssue<AgentConsumptionErrorCode>) {
    super(issue)
    this.name = 'AgentConsumptionValidationError'
  }
}

// ---------------------------------------------------------------------------
// Consumption guards (depth + cycle + input-required timeout)
// ---------------------------------------------------------------------------

/**
 * Configurable guard values. Deliberately NOT frozen as constants here —
 * per Decision 22 / the AC1 guardrail, concrete numbers (suggested: depth 3,
 * 24h input-required timeout) are ratified in the AC1 consumer-backed spec,
 * not in the contracts layer.
 */
export interface ConsumptionGuards {
  /** Max delegation chain length before a further hop is refused. */
  maxDepth: number
  /** How long a task may sit in `input-required` before it is canceled. */
  inputRequiredTimeoutMs: number
}

export const ConsumptionGuardsSchema = z
  .object({
    maxDepth: z.number().int().positive(),
    inputRequiredTimeoutMs: z.number().int().positive(),
  })
  .strict() satisfies z.ZodType<ConsumptionGuards, z.ZodTypeDef, unknown>

export function validateConsumptionGuards(
  raw: unknown,
): AgentSchemaValidationResult<ConsumptionGuards, AgentConsumptionErrorCode> {
  const result = ConsumptionGuardsSchema.safeParse(raw)
  if (!result.success) {
    return { valid: false, issues: schemaMismatchIssues(result.error.issues) }
  }
  return { valid: true, value: result.data }
}

/**
 * True when appending `next` to `chain` would revisit an agent (deployment)
 * already present in the delegation chain — including the same-pair
 * oscillation case (A -> B -> A), which is caught because A already
 * appears in the chain by the time B considers delegating back to it.
 */
export function detectConsumptionCycle(chain: readonly AgentRef[], next: AgentRef): boolean {
  return chain.some((ref) => agentRefEquals(ref, next))
}

/** Throws {@link AgentConsumptionValidationError} (AGENT_CONSUMPTION_CYCLE_DETECTED) when a cycle is detected. */
export function assertNoConsumptionCycle(chain: readonly AgentRef[], next: AgentRef): void {
  if (detectConsumptionCycle(chain, next)) {
    const label = next.deploymentId ? `${next.agentId}@${next.deploymentId}` : next.agentId
    throw new AgentConsumptionValidationError({
      code: AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_CYCLE_DETECTED,
      field: 'actor',
      message: `consumption cycle detected: agent '${label}' already present in the delegation chain`,
    })
  }
}

/** True when the chain has room for one more hop under `guards.maxDepth`. */
export function isWithinConsumptionDepth(
  chain: readonly AgentRef[],
  guards: ConsumptionGuards,
): boolean {
  return chain.length < guards.maxDepth
}

/** Throws {@link AgentConsumptionValidationError} (AGENT_CONSUMPTION_DEPTH_EXCEEDED) when the depth guard is exceeded. */
export function assertWithinConsumptionDepth(
  chain: readonly AgentRef[],
  guards: ConsumptionGuards,
): void {
  if (!isWithinConsumptionDepth(chain, guards)) {
    throw new AgentConsumptionValidationError({
      code: AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_DEPTH_EXCEEDED,
      field: 'depth',
      message: `consumption depth exceeded: chain length ${chain.length} >= max depth ${guards.maxDepth}`,
    })
  }
}
