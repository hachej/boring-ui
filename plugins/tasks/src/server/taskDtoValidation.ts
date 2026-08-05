import type {
  BoringTaskCard,
  BoringTaskDetail,
  BoringTaskMetadataItem,
  BoringTaskPullRequestRef,
  BoringTaskRelation,
} from "../shared"

export const TASK_DETAIL_LIMITS = Object.freeze({
  id: 256,
  title: 512,
  preview: 512,
  label: 128,
  metadataValue: 2_048,
  section: 256 * 1024,
  metadataCount: 64,
  relationCount: 512,
  totalBytes: 1024 * 1024,
})

export class TaskDetailValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaskDetailValidationError"
  }
}

function boundedString(value: unknown, field: string, max: number, options: { optional?: boolean } = {}): string | undefined {
  if (value === undefined && options.optional) return undefined
  if (typeof value !== "string" || (!options.optional && value.length === 0) || value.length > max) {
    throw new TaskDetailValidationError(`${field} is invalid`)
  }
  return value
}

function pullRequestBounds(value: BoringTaskPullRequestRef, index: number): BoringTaskPullRequestRef {
  if (!value || typeof value !== "object") throw new TaskDetailValidationError(`task.pullRequests.${index} is invalid`)
  const url = boundedString(value.url, `task.pullRequests.${index}.url`, TASK_DETAIL_LIMITS.metadataValue, { optional: true })
  const state = boundedString(value.state, `task.pullRequests.${index}.state`, TASK_DETAIL_LIMITS.id, { optional: true })
  return {
    id: boundedString(value.id, `task.pullRequests.${index}.id`, TASK_DETAIL_LIMITS.id)!,
    number: boundedString(value.number, `task.pullRequests.${index}.number`, TASK_DETAIL_LIMITS.id)!,
    title: boundedString(value.title, `task.pullRequests.${index}.title`, TASK_DETAIL_LIMITS.title)!,
    ...(url !== undefined ? { url } : {}),
    ...(state !== undefined ? { state } : {}),
  }
}

function cardBounds(card: BoringTaskCard): BoringTaskCard {
  if (!card || typeof card !== "object") throw new TaskDetailValidationError("task is invalid")
  const description = boundedString(card.description, "task.description", TASK_DETAIL_LIMITS.preview, { optional: true })
  const priority = boundedString(card.priority, "task.priority", TASK_DETAIL_LIMITS.id, { optional: true })
  const issueType = boundedString(card.issueType, "task.issueType", TASK_DETAIL_LIMITS.id, { optional: true })
  const assignee = boundedString(card.assignee, "task.assignee", TASK_DETAIL_LIMITS.id, { optional: true })
  const url = boundedString(card.url, "task.url", TASK_DETAIL_LIMITS.metadataValue, { optional: true })

  let tags: string[] | undefined
  if (card.tags !== undefined) {
    if (!Array.isArray(card.tags)) throw new TaskDetailValidationError("task.tags is invalid")
    tags = card.tags.map((tag, index) => boundedString(tag, `task.tags.${index}`, TASK_DETAIL_LIMITS.label)!)
  }

  let epic: BoringTaskCard["epic"]
  if (card.epic !== undefined) {
    if (!card.epic || typeof card.epic !== "object") throw new TaskDetailValidationError("task.epic is invalid")
    const epicUrl = boundedString(card.epic.url, "task.epic.url", TASK_DETAIL_LIMITS.metadataValue, { optional: true })
    epic = {
      id: boundedString(card.epic.id, "task.epic.id", TASK_DETAIL_LIMITS.id)!,
      title: boundedString(card.epic.title, "task.epic.title", TASK_DETAIL_LIMITS.title)!,
      ...(epicUrl !== undefined ? { url: epicUrl } : {}),
    }
  }

  let pullRequests: BoringTaskPullRequestRef[] | undefined
  if (card.pullRequests !== undefined) {
    if (!Array.isArray(card.pullRequests)) throw new TaskDetailValidationError("task.pullRequests is invalid")
    pullRequests = card.pullRequests.map(pullRequestBounds)
  }

  return {
    id: boundedString(card.id, "task.id", TASK_DETAIL_LIMITS.id)!,
    number: boundedString(card.number, "task.number", TASK_DETAIL_LIMITS.id)!,
    title: boundedString(card.title, "task.title", TASK_DETAIL_LIMITS.title)!,
    statusId: boundedString(card.statusId, "task.statusId", TASK_DETAIL_LIMITS.id)!,
    adapterId: boundedString(card.adapterId, "task.adapterId", TASK_DETAIL_LIMITS.id)!,
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(issueType !== undefined ? { issueType } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(epic !== undefined ? { epic } : {}),
    ...(pullRequests !== undefined ? { pullRequests } : {}),
    ...(url !== undefined ? { url } : {}),
  }
}

function metadataBounds(item: BoringTaskMetadataItem, index: number): BoringTaskMetadataItem {
  if (!item || typeof item !== "object") throw new TaskDetailValidationError(`detail.metadata.${index} is invalid`)
  return {
    id: boundedString(item.id, `detail.metadata.${index}.id`, TASK_DETAIL_LIMITS.id)!,
    label: boundedString(item.label, `detail.metadata.${index}.label`, TASK_DETAIL_LIMITS.label)!,
    value: boundedString(item.value, `detail.metadata.${index}.value`, TASK_DETAIL_LIMITS.metadataValue)!,
  }
}

function relationBounds(relation: BoringTaskRelation, index: number): BoringTaskRelation {
  if (!relation || typeof relation !== "object") throw new TaskDetailValidationError(`detail.relations.${index} is invalid`)
  const directions = new Set(["parent", "child", "blocked-by", "blocks", "related"])
  if (!directions.has(relation.direction)) throw new TaskDetailValidationError(`detail.relations.${index}.direction is invalid`)
  const title = boundedString(relation.title, `detail.relations.${index}.title`, TASK_DETAIL_LIMITS.title, { optional: true })
  const status = boundedString(relation.status, `detail.relations.${index}.status`, TASK_DETAIL_LIMITS.id, { optional: true })
  const nativeType = boundedString(relation.nativeType, `detail.relations.${index}.nativeType`, TASK_DETAIL_LIMITS.id, { optional: true })
  return {
    id: boundedString(relation.id, `detail.relations.${index}.id`, TASK_DETAIL_LIMITS.id)!,
    direction: relation.direction,
    ...(title !== undefined ? { title } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(nativeType !== undefined ? { nativeType } : {}),
  }
}

function compareRelation(left: BoringTaskRelation, right: BoringTaskRelation): number {
  if (left.direction !== right.direction) return left.direction < right.direction ? -1 : 1
  if (left.id !== right.id) return left.id < right.id ? -1 : 1
  const leftType = left.nativeType ?? ""
  const rightType = right.nativeType ?? ""
  return leftType === rightType ? 0 : leftType < rightType ? -1 : 1
}

export function validateTaskDetail(detail: BoringTaskDetail): BoringTaskDetail {
  if (!detail || typeof detail !== "object") throw new TaskDetailValidationError("detail is invalid")
  if (!Array.isArray(detail.metadata) || detail.metadata.length > TASK_DETAIL_LIMITS.metadataCount) {
    throw new TaskDetailValidationError("detail.metadata is invalid")
  }
  if (!Array.isArray(detail.relations) || detail.relations.length > TASK_DETAIL_LIMITS.relationCount) {
    throw new TaskDetailValidationError("detail.relations is invalid")
  }

  const body = boundedString(detail.body, "detail.body", TASK_DETAIL_LIMITS.section, { optional: true })
  const acceptanceCriteria = boundedString(detail.acceptanceCriteria, "detail.acceptanceCriteria", TASK_DETAIL_LIMITS.section, { optional: true })
  const notes = boundedString(detail.notes, "detail.notes", TASK_DETAIL_LIMITS.section, { optional: true })
  const updatedAt = boundedString(detail.updatedAt, "detail.updatedAt", TASK_DETAIL_LIMITS.id, { optional: true })
  const metadata = detail.metadata.map(metadataBounds)
  const relationMap = new Map<string, BoringTaskRelation>()
  for (const [index, raw] of detail.relations.entries()) {
    const relation = relationBounds(raw, index)
    const key = `${relation.direction}\u0000${relation.id}\u0000${relation.nativeType ?? ""}`
    if (!relationMap.has(key)) relationMap.set(key, relation)
  }
  const relations = [...relationMap.values()].sort(compareRelation)
  const projected: BoringTaskDetail = {
    task: cardBounds(detail.task),
    metadata,
    relations,
    ...(body !== undefined ? { body } : {}),
    ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  }

  let encoded: Uint8Array
  try {
    encoded = new TextEncoder().encode(JSON.stringify(projected))
  } catch {
    throw new TaskDetailValidationError("detail is not JSON-safe")
  }
  if (encoded.byteLength > TASK_DETAIL_LIMITS.totalBytes) {
    throw new TaskDetailValidationError("detail exceeds total byte limit")
  }
  return projected
}
