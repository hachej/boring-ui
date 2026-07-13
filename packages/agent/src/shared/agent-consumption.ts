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

import { Sha256DigestSchema, type Sha256Digest } from './agent-definition'
import { AgentConsumptionErrorCode } from './error-codes'
import { SchemaValidationError, formatPath, type AgentSchemaIssue, type AgentSchemaValidationResult } from './schema-issue'

const nonEmptyString = z.string().min(1)

/**
 * A platform-owned opaque locator id: unlike {@link OpaqueRefSchema} in
 * agent-definition.ts (which permits `/` for namespaced agent/definition
 * refs), a locator id is a bare surrogate key with no path or scheme
 * semantics whatsoever — no separators, no `..`, no `:`. This is what
 * makes `file:`, `http(s):`, absolute paths, and workspace-relative paths
 * structurally unrepresentable as a `workspaceId`/`fileId`, not merely
 * discouraged by convention.
 */
function isOpaqueLocatorId(value: string): boolean {
  return (
    value.trim() === value &&
    !/[\0-\x1f\x7f]/.test(value) &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes(':') &&
    value !== '.' &&
    value !== '..'
  )
}

const OpaqueLocatorIdSchema = z
  .string()
  .min(1, 'must be a non-empty opaque id')
  .max(256, 'must be at most 256 characters')
  .refine(isOpaqueLocatorId, 'must be an opaque platform-owned id (no path separators, scheme, or "..")')

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

// ---------------------------------------------------------------------------
// Artifact locator authority (AC1-T2, Decision 22 §"typed artifact authority")
// ---------------------------------------------------------------------------
//
// `ArtifactRef` no longer carries a generic `uri: string` (that shape was an
// SSRF/path-leak vector: any caller-controlled scheme — `file:`, `http(s):`,
// an absolute path, a workspace-relative path — could reach storage/network
// effects before a boundary ever inspected it). An `ArtifactLocator` instead
// carries only platform-owned opaque ids, media metadata, and a required
// digest for kinds whose bytes are immutable; a URI is derived from it only
// by the authorized edge adapter (HTTP/MCP), never accepted as input.
//
// V1 (this discriminated union's own version, not `AgentTask.schemaVersion`)
// supports exactly one concrete locator kind: the same-workspace file link
// that AR1's accepted "same-workspace lane" already owns. Do NOT add a
// generic URL/URI variant here — that reintroduces the vector this type
// exists to close. The cross-workspace `ArtifactTransferHandle` (AR1 Lane X)
// is deliberately out of scope: it is a separate typed protocol-data part,
// never an `ArtifactLocator`, and is not built until a real cross-workspace
// consumer exists (see IMPLEMENTATION-GUARDRAILS.md AR1 section).

export const ARTIFACT_LOCATOR_KINDS = ['workspace-file'] as const

export type ArtifactLocatorKind = (typeof ARTIFACT_LOCATOR_KINDS)[number]

/** A same-workspace file, addressed only by platform-owned opaque ids + a content digest. Never a path or URI. */
export interface WorkspaceFileLocator {
  kind: 'workspace-file'
  workspaceId: string
  fileId: string
  digest: Sha256Digest
}

export const WorkspaceFileLocatorSchema = z
  .object({
    kind: z.literal('workspace-file'),
    workspaceId: OpaqueLocatorIdSchema,
    fileId: OpaqueLocatorIdSchema,
    digest: Sha256DigestSchema,
  })
  .strict() satisfies z.ZodType<WorkspaceFileLocator, z.ZodTypeDef, unknown>

export type ArtifactLocator = WorkspaceFileLocator

export const ArtifactLocatorSchema: z.ZodType<ArtifactLocator, z.ZodTypeDef, unknown> =
  z.discriminatedUnion('kind', [WorkspaceFileLocatorSchema])

/** A reference to an artifact produced by a task (bytes live elsewhere; this is the pointer). */
export interface ArtifactRef {
  artifactId: string
  name?: string
  mimeType: string
  locator: ArtifactLocator
}

export const ArtifactRefSchema = z
  .object({
    artifactId: nonEmptyString,
    name: z.string().optional(),
    mimeType: nonEmptyString,
    locator: ArtifactLocatorSchema,
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

/**
 * schemaVersion '2' (AC1-T2): the published strict task schema was already
 * calling itself version 1 while carrying the generic `ArtifactRef.uri`
 * authority this module now replaces — that is a published-schema
 * correction, not a cosmetic bump, so it is published under a new version
 * per Decision 22 (schema versioning is permitted once external bindings
 * exist; M2 is the first). `AgentTask` (this canonical type) is v2-only.
 * A schemaVersion '1' payload is never accepted here — see
 * {@link parseAgentTaskEdgeCompat} for the edge-only compatibility path.
 */
export const AGENT_TASK_SCHEMA_VERSION = '2' as const

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
  schemaVersion: typeof AGENT_TASK_SCHEMA_VERSION
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
    schemaVersion: z.literal(AGENT_TASK_SCHEMA_VERSION),
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
// Edge-only schemaVersion '1' compatibility (AC1-T2)
// ---------------------------------------------------------------------------
//
// A legacy schemaVersion '1' payload carries the retired generic
// `ArtifactRef.uri: string` authority. Per Decision 22 / this bead, no
// generic URL variant is ever added to `ArtifactLocator`, so there is no
// legitimate translation from an arbitrary v1 `uri` to a typed v2 locator —
// EVERY schemaVersion '1' artifact is refused here, before any
// storage/network effect, regardless of scheme (`file:`, `http(s):`, an
// absolute path, a workspace-relative path, or anything else). This parser
// exists only so an edge that still receives legacy payloads can recognize
// and refuse them with a stable code instead of dereferencing the uri; it is
// never used internally and `AgentTask` (schemaVersion '2') is the only
// canonical in-process shape.

const LegacyArtifactRefSchema = z
  .object({
    artifactId: nonEmptyString,
    name: z.string().optional(),
    mimeType: nonEmptyString,
    uri: nonEmptyString,
  })
  .strict()

const LegacyPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('file'), file: LegacyArtifactRefSchema }).strict(),
  z.object({ type: z.literal('data'), mimeType: nonEmptyString, data: z.unknown() }).strict(),
])

const LegacyAgentMessageSchema = z
  .object({
    role: z.enum(['consumer', 'agent']),
    parts: z.array(LegacyPartSchema),
    ts: nonEmptyString,
  })
  .strict()

const LegacyAgentTaskSchema = z
  .object({
    id: nonEmptyString,
    contextId: nonEmptyString,
    state: TaskStateSchema,
    messages: z.array(LegacyAgentMessageSchema),
    artifacts: z.array(LegacyArtifactRefSchema),
    principal: PrincipalRefSchema,
    actor: AgentRefSchema.optional(),
    schemaVersion: z.literal('1'),
    createdAt: nonEmptyString,
    updatedAt: nonEmptyString,
  })
  .strict()

function collectLegacyArtifactUris(raw: z.infer<typeof LegacyAgentTaskSchema>): string[] {
  const uris: string[] = []
  for (const artifact of raw.artifacts) uris.push(artifact.uri)
  for (const message of raw.messages) {
    for (const part of message.parts) {
      if (part.type === 'file') uris.push(part.file.uri)
    }
  }
  return uris
}

/**
 * Edge-only v1/v2 acceptance boundary. A well-formed schemaVersion '2'
 * payload is accepted as the canonical {@link AgentTask}. A well-formed
 * schemaVersion '1' payload is always refused with
 * `AGENT_CONSUMPTION_LEGACY_ARTIFACT_REJECTED` — before any of its artifact
 * uris are inspected for a scheme, resolved, or dereferenced — because no
 * generic uri has a legitimate `ArtifactLocator` translation. Anything else
 * falls through to the ordinary v2 schema-mismatch issues.
 */
export function parseAgentTaskEdgeCompat(
  raw: unknown,
): AgentSchemaValidationResult<AgentTask, AgentConsumptionErrorCode> {
  const v2 = AgentTaskSchema.safeParse(raw)
  if (v2.success) return { valid: true, value: v2.data }

  const legacy = LegacyAgentTaskSchema.safeParse(raw)
  if (legacy.success) {
    const uris = collectLegacyArtifactUris(legacy.data)
    const issues: AgentSchemaIssue<AgentConsumptionErrorCode>[] =
      uris.length > 0
        ? uris.map((uri, index) => ({
            code: AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_LEGACY_ARTIFACT_REJECTED,
            field: `artifacts[${index}].uri`,
            message: `schemaVersion '1' artifact uri '${uri}' has no typed ArtifactLocator translation and is refused before any storage/network effect`,
          }))
        : [
            {
              code: AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_LEGACY_ARTIFACT_REJECTED,
              field: 'schemaVersion',
              message: "schemaVersion '1' is no longer accepted; publish schemaVersion '2' with a typed ArtifactLocator",
            },
          ]
    return { valid: false, issues }
  }

  return { valid: false, issues: schemaMismatchIssues(v2.error.issues) }
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
