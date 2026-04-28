import type { ToolResult } from '../../../shared/tool'

export function makeError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

export function bytesWritten(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function normalizeLimit(
  raw: unknown,
  opts: { default: number; max: number },
): { limit: number; error?: string } {
  if (raw === undefined) {
    return { limit: opts.default }
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { limit: opts.default, error: 'limit must be a number when provided' }
  }

  const normalized = Math.trunc(raw)
  if (normalized <= 0) {
    return { limit: opts.default, error: 'limit must be >= 1 when provided' }
  }

  return { limit: Math.min(normalized, opts.max) }
}

export const decoder = new TextDecoder('utf-8', { fatal: false })

export function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export type FileChangeOp = 'write' | 'edit' | 'unlink' | 'rename' | 'mkdir'

export interface FileChangeMetadata {
  op: FileChangeOp
  path: string
  oldPath?: string
  timestamp: string
  size?: number
  /**
   * Distinguishes file:created from file:changed in the workspace bridge.
   * Universal field; edit ops set it true when emitted.
   */
  existsBefore?: boolean
}

export const DEFAULT_TOOL_LIMIT = 200
export const MAX_TOOL_LIMIT = 5_000
export const MAX_PATTERN_LENGTH = 256
