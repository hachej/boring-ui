import {
  BORING_TASK_ERROR_DEFINITIONS,
  type BoringTaskBoardConfig,
  type BoringTaskCard,
  type BoringTaskDetail,
  type BoringTaskErrorCode,
  type BoringTaskMetadataItem,
  type BoringTaskRelation,
} from "../shared"
import { BEADS_SHOW_BATCH_LIMIT, BeadsOperationError, isValidBeadId, type BeadsOperations } from "./beadsOperations"
import type { BoringTaskSourceRuntime } from "./sourceRuntime"
import { TaskDetailValidationError, validateTaskDetail } from "./taskDtoValidation"
import { TaskSourceServiceError } from "./taskSourceService"

export const BEADS_SOURCE_ID = "beads:workspace"
export const SUPPORTED_BEADS_VERSION = "0.2.16"

const VERSION_LIMITS = { timeoutMs: 5_000, maxOutputBytes: 64 * 1024 } as const
const LIST_LIMITS = { timeoutMs: 20_000, maxOutputBytes: 8 * 1024 * 1024 } as const
const DETAIL_LIMITS = { timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 } as const

const BOARD_CONFIG: BoringTaskBoardConfig = {
  adapterId: BEADS_SOURCE_ID,
  columns: [
    { id: "open", title: "Open", acceptsDrop: false },
    { id: "in-progress", title: "In progress", acceptsDrop: false },
    { id: "blocked", title: "Blocked", acceptsDrop: false },
    { id: "deferred", title: "Deferred", acceptsDrop: false },
    { id: "ready-for-human", title: "Ready for human", acceptsDrop: false },
    { id: "closed", title: "Closed", acceptsDrop: false },
    { id: "other", title: "Other", acceptsDrop: false },
  ],
}

function serviceError(code: BoringTaskErrorCode, message: string): TaskSourceServiceError {
  const definition = BORING_TASK_ERROR_DEFINITIONS[code]
  return new TaskSourceServiceError(definition.status, code, message, definition.retryable)
}

function operationError(cause: unknown): TaskSourceServiceError {
  if (!(cause instanceof BeadsOperationError)) {
    return serviceError("TASK_BEADS_COMMAND_FAILED", "Beads read command failed.")
  }
  switch (cause.kind) {
    case "binary-not-found": return serviceError("TASK_BEADS_BINARY_NOT_FOUND", "Beads CLI is not installed.")
    case "timeout": return serviceError("TASK_BEADS_TIMEOUT", "Beads read timed out.")
    case "output-too-large": return serviceError("TASK_BEADS_OUTPUT_TOO_LARGE", "Beads output exceeded the safe limit.")
    case "not-found": return serviceError("TASK_BEADS_NOT_FOUND", "Bead not found.")
    case "store-not-found": return serviceError("TASK_BEADS_STORE_NOT_FOUND", "Beads store is not initialized.")
    case "store-unhealthy": return serviceError("TASK_BEADS_STORE_UNHEALTHY", "Beads store is unhealthy.")
    case "runtime-unavailable": return serviceError("TASK_BEADS_RUNTIME_UNAVAILABLE", "Beads is unavailable in this Workspace runtime.")
    default: return serviceError("TASK_BEADS_COMMAND_FAILED", "Beads read command failed.")
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serviceError("TASK_BEADS_INVALID_RESPONSE", `Beads returned an invalid ${field}.`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw serviceError("TASK_BEADS_INVALID_RESPONSE", `Beads returned an invalid ${field}.`)
  }
  return value
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || value.length > max) {
    throw serviceError("TASK_BEADS_INVALID_RESPONSE", `Beads returned an invalid ${field}.`)
  }
  return value
}

function parseJson(stdout: string, maxBytes: number): unknown {
  if (new TextEncoder().encode(stdout).byteLength > maxBytes) {
    throw serviceError("TASK_BEADS_OUTPUT_TOO_LARGE", "Beads output exceeded the safe limit.")
  }
  try {
    return JSON.parse(stdout) as unknown
  } catch {
    throw serviceError("TASK_BEADS_INVALID_JSON", "Beads returned invalid JSON.")
  }
}

function compactPreview(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length <= 512 ? compact : `${compact.slice(0, 511)}…`
}

function statusId(nativeStatus: string): string {
  switch (nativeStatus) {
    case "open": return "open"
    case "in_progress": return "in-progress"
    case "blocked": return "blocked"
    case "deferred": return "deferred"
    case "ready_for_human": return "ready-for-human"
    case "closed": return "closed"
    default: return "other"
  }
}

interface NativeRelationRef {
  id: string
  title?: string
  status?: string
  nativeType?: string
}

function relationRef(value: unknown, field: string): NativeRelationRef {
  const item = record(value, field)
  const id = requiredString(item.id, `${field}.id`, 256)
  if (!isValidBeadId(id)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", `Beads returned an invalid ${field} ID.`)
  return {
    id,
    ...(optionalString(item.title, `${field}.title`, 512) !== undefined ? { title: item.title as string } : {}),
    ...(optionalString(item.status, `${field}.status`, 256) !== undefined ? { status: item.status as string } : {}),
    ...(optionalString(item.dependency_type ?? item.native_type ?? item.type, `${field}.dependency_type`, 256) !== undefined
      ? { nativeType: (item.dependency_type ?? item.native_type ?? item.type) as string }
      : {}),
  }
}

function relationRefs(value: unknown, field: string): NativeRelationRef[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", `Beads returned an invalid ${field}.`)
  return value.map((item, index) => relationRef(item, `${field}.${index}`))
}

function nativeParent(issue: Record<string, unknown>, dependencies: NativeRelationRef[]): NativeRelationRef | undefined {
  if (typeof issue.parent === "string") {
    if (!isValidBeadId(issue.parent)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid parent ID.")
    return dependencies.find((item) => item.id === issue.parent) ?? { id: issue.parent }
  }
  if (issue.parent !== undefined && issue.parent !== null) return relationRef(issue.parent, "parent")
  return dependencies.find((item) => item.nativeType === "parent-child")
}

function mapCard(raw: unknown): BoringTaskCard {
  const issue = record(raw, "issue")
  const id = requiredString(issue.id, "issue.id", 256)
  if (!isValidBeadId(id)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid issue ID.")
  const title = requiredString(issue.title, "issue.title", 512)
  const nativeStatus = requiredString(issue.status, "issue.status", 256)
  const description = compactPreview(optionalString(issue.description, "issue.description", 256 * 1024))
  let tags: string[] | undefined
  if (issue.labels !== undefined && issue.labels !== null) {
    if (!Array.isArray(issue.labels)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned invalid labels.")
    tags = issue.labels.map((label, index) => requiredString(label, `issue.labels.${index}`, 128))
  }
  let priority: string | undefined
  if (issue.priority !== undefined && issue.priority !== null) {
    if (!Number.isSafeInteger(issue.priority) || (issue.priority as number) < 0 || (issue.priority as number) > 99) {
      throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid priority.")
    }
    priority = `P${issue.priority}`
  }
  const issueType = optionalString(issue.issue_type, "issue.issue_type", 256)
  const assignee = optionalString(issue.assignee, "issue.assignee", 256)
  const dependencies = relationRefs(issue.dependencies, "dependencies")
  const parent = nativeParent(issue, dependencies)

  return {
    id,
    number: id,
    title,
    statusId: statusId(nativeStatus),
    adapterId: BEADS_SOURCE_ID,
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(issueType !== undefined ? { issueType } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(parent ? { epic: { id: parent.id, title: parent.title ?? parent.id } } : {}),
  }
}

function safeRepositoryName(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) return undefined
  return value
}

function metadata(issue: Record<string, unknown>, card: BoringTaskCard): BoringTaskMetadataItem[] {
  const items: BoringTaskMetadataItem[] = []
  const add = (id: string, label: string, value: unknown, max = 2_048) => {
    if (value === undefined || value === null) return
    const rendered = typeof value === "number" && Number.isFinite(value) ? String(value) : optionalString(value, id, max)
    if (rendered !== undefined && rendered.length > 0) items.push({ id, label, value: rendered })
  }
  add("priority", "Priority", card.priority, 256)
  add("issue-type", "Issue type", card.issueType, 256)
  add("assignee", "Assignee", card.assignee, 256)
  add("created-at", "Created", issue.created_at, 256)
  add("created-by", "Created by", issue.created_by, 256)
  add("closed-at", "Closed", issue.closed_at, 256)
  add("close-reason", "Close reason", issue.close_reason)
  const externalReference = typeof issue.external_ref === "string" && /^https?:\/\/[^\s]+$/.test(issue.external_ref)
    ? issue.external_ref
    : undefined
  add("external-reference", "External reference", externalReference)
  add("source-repository", "Source repository", safeRepositoryName(issue.source_repo), 128)
  return items
}

function mapRelations(issue: Record<string, unknown>): BoringTaskRelation[] {
  const dependencies = relationRefs(issue.dependencies, "dependencies")
  const parent = nativeParent(issue, dependencies)
  const relations: BoringTaskRelation[] = []
  const add = (ref: NativeRelationRef, direction: BoringTaskRelation["direction"], nativeType = ref.nativeType) => {
    relations.push({
      id: ref.id,
      direction,
      ...(ref.title !== undefined ? { title: ref.title } : {}),
      ...(ref.status !== undefined ? { status: ref.status } : {}),
      ...(nativeType !== undefined ? { nativeType } : {}),
    })
  }
  if (parent) add(parent, "parent", parent.nativeType ?? "parent-child")
  for (const dependency of dependencies) {
    if (parent && dependency.id === parent.id && dependency.nativeType === "parent-child") add(dependency, "parent")
    else add(dependency, "blocked-by")
  }
  for (const child of relationRefs(issue.children, "children")) add(child, "child")
  for (const dependent of relationRefs(issue.dependents, "dependents")) add(dependent, "blocks")
  for (const related of relationRefs(issue.related, "related")) add(related, "related")
  const discovered = issue.discovered_from === undefined || issue.discovered_from === null
    ? []
    : Array.isArray(issue.discovered_from)
      ? relationRefs(issue.discovered_from, "discovered_from")
      : [relationRef(issue.discovered_from, "discovered_from")]
  for (const related of discovered) add(related, "related", related.nativeType ?? "discovered-from")
  return relations
}

function mapDetail(raw: unknown): BoringTaskDetail {
  const issue = record(raw, "issue")
  const task = mapCard(issue)
  const detail: BoringTaskDetail = {
    task,
    metadata: metadata(issue, task),
    relations: mapRelations(issue),
    ...(optionalString(issue.description, "issue.description", 256 * 1024) !== undefined ? { body: issue.description as string } : {}),
    ...(optionalString(issue.acceptance_criteria, "issue.acceptance_criteria", 256 * 1024) !== undefined
      ? { acceptanceCriteria: issue.acceptance_criteria as string }
      : {}),
    ...(optionalString(issue.notes, "issue.notes", 256 * 1024) !== undefined ? { notes: issue.notes as string } : {}),
    ...(optionalString(issue.updated_at, "issue.updated_at", 256) !== undefined ? { updatedAt: issue.updated_at as string } : {}),
  }
  try {
    return validateTaskDetail(detail)
  } catch (cause) {
    if (cause instanceof TaskDetailValidationError) {
      throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid detail response.")
    }
    throw cause
  }
}

/**
 * `br list --json` carries only `dependency_count` — never the dependency
 * edges themselves — so parent/epic assignment (`nativeParent`) would always
 * be empty from the list call alone. Hydrate the edges with batched pinned
 * `br show` calls, restricted to issues that report at least one dependency
 * and that the list call did not already ship edges for.
 */
async function fetchDependencyEdges(
  operations: BeadsOperations | undefined,
  issues: readonly Record<string, unknown>[],
): Promise<Map<string, unknown>> {
  const edges = new Map<string, unknown>()
  const ids = issues
    .filter((issue) =>
      issue.dependencies === undefined
      && typeof issue.id === "string"
      && isValidBeadId(issue.id)
      && Number.isSafeInteger(issue.dependency_count)
      && (issue.dependency_count as number) > 0)
    .map((issue) => issue.id as string)
  for (let start = 0; start < ids.length; start += BEADS_SHOW_BATCH_LIMIT) {
    const chunk = ids.slice(start, start + BEADS_SHOW_BATCH_LIMIT)
    const parsed = parseJson(
      await read(operations, ["show", "--json", "--no-auto-flush", "--no-auto-import", "--no-db", "--", ...chunk], LIST_LIMITS),
      LIST_LIMITS.maxOutputBytes,
    )
    if (!Array.isArray(parsed)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid show response.")
    for (const raw of parsed) {
      const issue = record(raw, "issue")
      const id = requiredString(issue.id, "issue.id", 256)
      if (issue.dependencies !== undefined && issue.dependencies !== null) edges.set(id, issue.dependencies)
    }
  }
  return edges
}

async function read(operations: BeadsOperations | undefined, args: readonly string[], limits: typeof VERSION_LIMITS | typeof LIST_LIMITS | typeof DETAIL_LIMITS): Promise<string> {
  if (!operations) throw serviceError("TASK_BEADS_RUNTIME_UNAVAILABLE", "Beads is unavailable in this Workspace runtime.")
  try {
    return (await operations.runRead(args, limits)).stdout
  } catch (cause) {
    throw operationError(cause)
  }
}

export function createBeadsTaskSource(options: { operations?: BeadsOperations; sourceId?: string } = {}): BoringTaskSourceRuntime {
  const sourceId = options.sourceId ?? BEADS_SOURCE_ID
  let versionCheck: Promise<void> | undefined
  const ensureVersion = () => {
    if (!versionCheck) {
      const attempt = read(options.operations, ["--version"], VERSION_LIMITS).then((stdout) => {
        if (stdout.trim() !== `br ${SUPPORTED_BEADS_VERSION}`) {
          throw serviceError("TASK_BEADS_VERSION_UNSUPPORTED", `Beads ${SUPPORTED_BEADS_VERSION} is required.`)
        }
      })
      versionCheck = attempt.catch((cause) => {
        versionCheck = undefined
        throw cause
      })
    }
    return versionCheck
  }

  return {
    summary: () => ({
      id: sourceId,
      label: "Beads",
      description: "Workspace execution graph (read-only)",
      capabilities: { move: false, delete: false, detail: true },
    }),
    getBoardConfig: () => ({ ...BOARD_CONFIG, adapterId: sourceId }),
    async listTasks() {
      await ensureVersion()
      const parsed = parseJson(await read(options.operations, ["list", "--all", "--json", "--no-auto-flush", "--no-auto-import", "--no-db"], LIST_LIMITS), LIST_LIMITS.maxOutputBytes)
      const root = record(parsed, "list response")
      if (!Array.isArray(root.issues)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid list response.")
      const issues = root.issues.map((issue) => record(issue, "issue"))
      const edges = await fetchDependencyEdges(options.operations, issues)
      const seen = new Set<string>()
      return issues.map((issue) => {
        const dependencies = typeof issue.id === "string" ? edges.get(issue.id) : undefined
        const card = mapCard(issue.dependencies === undefined && dependencies !== undefined ? { ...issue, dependencies } : issue)
        if (seen.has(card.id)) throw serviceError("TASK_BEADS_DUPLICATE_ID", "Beads returned duplicate issue IDs.")
        seen.add(card.id)
        return { ...card, adapterId: sourceId }
      })
    },
    async getTask(_ctx, input) {
      if (!isValidBeadId(input.taskId)) throw serviceError("TASK_BEADS_ID_INVALID", "Bead ID is invalid.")
      await ensureVersion()
      const parsed = parseJson(await read(options.operations, ["show", "--json", "--no-auto-flush", "--no-auto-import", "--no-db", "--", input.taskId], DETAIL_LIMITS), DETAIL_LIMITS.maxOutputBytes)
      if (!Array.isArray(parsed)) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid detail response.")
      if (parsed.length === 0) throw serviceError("TASK_BEADS_NOT_FOUND", "Bead not found.")
      if (parsed.length !== 1) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned an invalid detail response.")
      const detail = mapDetail(parsed[0])
      if (detail.task.id !== input.taskId) throw serviceError("TASK_BEADS_INVALID_RESPONSE", "Beads returned the wrong issue.")
      return { ...detail, task: { ...detail.task, adapterId: sourceId } }
    },
  }
}
