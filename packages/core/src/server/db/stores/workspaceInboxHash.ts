import { createHash } from 'node:crypto'
import type { WorkspaceInboxItemInput } from '../../../shared/types.js'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function inboxIdempotencyHash(input: WorkspaceInboxItemInput): string {
  return createHash('sha256').update(stableJson(input)).digest('hex')
}
