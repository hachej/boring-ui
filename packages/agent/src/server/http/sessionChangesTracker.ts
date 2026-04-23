export type SessionFileChangeOp =
  | 'write'
  | 'edit'
  | 'unlink'
  | 'rename'
  | 'mkdir'

export interface SessionFileChange {
  op: SessionFileChangeOp
  path: string
  oldPath?: string
  size?: number
  timestamp: string
}

export interface SessionChangesTracker {
  record(sessionId: string, change: SessionFileChange): void
  list(sessionId: string): SessionFileChange[]
  clear(sessionId: string): void
}

export class InMemorySessionChangesTracker implements SessionChangesTracker {
  private static readonly MAX_CHANGES_PER_SESSION = 1000
  private readonly bySession = new Map<string, SessionFileChange[]>()

  record(sessionId: string, change: SessionFileChange): void {
    const existing = this.bySession.get(sessionId)
    if (existing) {
      existing.push(change)
      if (existing.length > InMemorySessionChangesTracker.MAX_CHANGES_PER_SESSION) {
        existing.splice(
          0,
          existing.length - InMemorySessionChangesTracker.MAX_CHANGES_PER_SESSION,
        )
      }
      return
    }
    this.bySession.set(sessionId, [change])
  }

  list(sessionId: string): SessionFileChange[] {
    return [...(this.bySession.get(sessionId) ?? [])]
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId)
  }
}

const VALID_OPS: ReadonlySet<SessionFileChangeOp> = new Set([
  'write',
  'edit',
  'unlink',
  'rename',
  'mkdir',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseFileChangeChunk(
  chunk: unknown,
): SessionFileChange | null {
  if (!isRecord(chunk) || chunk.type !== 'data-file-changed') {
    return null
  }

  const data = chunk.data
  if (!isRecord(data)) {
    return null
  }

  const op = data.op
  if (typeof op !== 'string' || !VALID_OPS.has(op as SessionFileChangeOp)) {
    return null
  }

  const path = data.path
  if (typeof path !== 'string' || path.length === 0) {
    return null
  }

  const change: SessionFileChange = {
    op: op as SessionFileChangeOp,
    path,
    timestamp:
      typeof data.timestamp === 'string' && data.timestamp.length > 0
        ? data.timestamp
        : new Date().toISOString(),
  }

  if (typeof data.oldPath === 'string' && data.oldPath.length > 0) {
    change.oldPath = data.oldPath
  }

  if (
    typeof data.size === 'number' &&
    Number.isFinite(data.size) &&
    data.size >= 0
  ) {
    change.size = data.size
  }

  return change
}
