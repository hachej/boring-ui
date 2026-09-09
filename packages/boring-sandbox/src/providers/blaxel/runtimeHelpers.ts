import { posix } from 'node:path'

import { validatePath } from '../node-workspace/paths'
import { BLAXEL_WORKSPACE_ROOT } from './config'

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function toBlaxelPath(relPath: string): string {
  return validatePath(BLAXEL_WORKSPACE_ROOT, relPath)
}

export function normalizeBlaxelCwd(cwd: string | undefined): string {
  const requested = cwd ?? BLAXEL_WORKSPACE_ROOT
  if (!posix.isAbsolute(requested)) {
    throw new Error(`Blaxel sandbox cwd must be absolute: ${requested}`)
  }
  const normalized = posix.normalize(requested)
  if (
    normalized !== BLAXEL_WORKSPACE_ROOT
    && !normalized.startsWith(`${BLAXEL_WORKSPACE_ROOT}/`)
  ) {
    throw new Error(`Blaxel sandbox cwd must stay under ${BLAXEL_WORKSPACE_ROOT}: ${requested}`)
  }
  return normalized
}

export function capUtf8Outputs(
  stdoutText: string,
  stderrText: string,
  maxBytes: number,
): { stdout: Uint8Array; stderr: Uint8Array; truncated: boolean } {
  const encoder = new TextEncoder()
  const stdoutBytes = encoder.encode(stdoutText)
  const stderrBytes = encoder.encode(stderrText)
  const normalizedMax = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0
  const retainedStdout = stdoutBytes.subarray(0, normalizedMax)
  const stderrBudget = Math.max(0, normalizedMax - retainedStdout.byteLength)
  const retainedStderr = stderrBytes.subarray(0, stderrBudget)
  return {
    stdout: retainedStdout,
    stderr: retainedStderr,
    truncated: stdoutBytes.byteLength + stderrBytes.byteLength > normalizedMax,
  }
}

let processCounter = 0
export function createBlaxelProcessName(prefix = 'boring'): string {
  processCounter = (processCounter + 1) % 1_000_000
  return `${prefix}-${Date.now().toString(36)}-${processCounter.toString(36)}`
}
