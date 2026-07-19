import { TASK_ERROR_CODES } from "../shared"
const DEFAULT_TEMPLATE = "docs/issues/{taskId}"
const MAX_PATH_LENGTH = 1024
const MAX_SEGMENT_LENGTH = 255
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const PLACEHOLDERS = new Set(["{adapterId}", "{taskId}", "{number}"])

export type TaskArtifactFolderErrorCode =
  | typeof TASK_ERROR_CODES.ARTIFACT_PATH_INVALID
  | typeof TASK_ERROR_CODES.ARTIFACT_PATH_CONFLICT
  | typeof TASK_ERROR_CODES.ARTIFACT_WORKSPACE_UNAVAILABLE
  | typeof TASK_ERROR_CODES.ARTIFACT_WORKSPACE_ERROR

export class TaskArtifactFolderError extends Error {
  constructor(readonly code: TaskArtifactFolderErrorCode, message: string, readonly status = 400) {
    super(message)
    this.name = "TaskArtifactFolderError"
  }
}

export interface TaskArtifactIdentity {
  adapterId: string
  taskId: string
  number: string
}

export interface TaskArtifactWorkspace {
  stat(path: string): Promise<{ kind: "file" | "dir" }>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown })?.code === TASK_ERROR_CODES.WORKSPACE_FILE_MISSING
}

function encodeSegment(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "Task artifact path placeholder is empty.")
  let encoded = ""
  for (const char of normalized) {
    if (/^[A-Za-z0-9_-]$/.test(char)) encoded += char
    else {
      const bytes = new TextEncoder().encode(char)
      encoded += [...bytes].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("")
    }
  }
  if (encoded.startsWith("-")) encoded = `_${encoded}`
  if (WINDOWS_RESERVED.test(encoded)) encoded = `_${encoded}`
  if (!encoded || encoded.length > MAX_SEGMENT_LENGTH) {
    throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "Task artifact path segment is too long.")
  }
  return encoded
}

function validateLiteralSegment(segment: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment === "." || segment === ".." || WINDOWS_RESERVED.test(segment) || segment.startsWith("-")) {
    throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "Task artifact path template contains an unsafe segment.")
  }
  return segment
}

export function taskArtifactPathTemplate(config: unknown): string {
  if (!config || typeof config !== "object" || Array.isArray(config)) return DEFAULT_TEMPLATE
  const value = (config as { artifactPathTemplate?: unknown }).artifactPathTemplate
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TEMPLATE
}

export function resolveTaskArtifactPath(template: string, identity: TaskArtifactIdentity): string {
  const normalized = template.trim()
  if (!normalized || normalized.length > MAX_PATH_LENGTH || normalized.includes("\0") || normalized.includes("\\") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "Task artifact path template must be a safe workspace-relative path.")
  }
  const values: Record<string, string> = {
    "{adapterId}": identity.adapterId,
    "{taskId}": identity.taskId,
    "{number}": identity.number,
  }
  const segments = normalized.split("/").map((segment) => {
    if (!segment) throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "Task artifact path template contains an empty segment.")
    if (PLACEHOLDERS.has(segment)) return encodeSegment(values[segment]!)
    if (segment.includes("{") || segment.includes("}")) {
      throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "Task artifact path template contains an unknown placeholder.")
    }
    return validateLiteralSegment(segment)
  })
  const path = segments.join("/")
  if (path.length > MAX_PATH_LENGTH) throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "Task artifact path is too long.")
  return path
}

export async function taskArtifactFolderStatus(workspace: TaskArtifactWorkspace, path: string): Promise<{ path: string; exists: boolean }> {
  try {
    const stat = await workspace.stat(path)
    if (stat.kind !== "dir") throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_CONFLICT, "Task artifact path exists but is not a folder.", 409)
    return { path, exists: true }
  } catch (error) {
    if (error instanceof TaskArtifactFolderError) throw error
    if (isMissing(error)) return { path, exists: false }
    throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_WORKSPACE_ERROR, "Task artifact folder could not be inspected.", 500)
  }
}

export async function createTaskArtifactFolder(workspace: TaskArtifactWorkspace, path: string): Promise<{ path: string; exists: true }> {
  const status = await taskArtifactFolderStatus(workspace, path)
  if (!status.exists) {
    try {
      await workspace.mkdir(path, { recursive: true })
    } catch {
      throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_WORKSPACE_ERROR, "Task artifact folder could not be created.", 500)
    }
  }
  return { path, exists: true }
}

export const DEFAULT_TASK_ARTIFACT_PATH_TEMPLATE = DEFAULT_TEMPLATE
