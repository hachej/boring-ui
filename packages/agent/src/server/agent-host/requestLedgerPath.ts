import { join } from 'node:path'

import { getEnv } from '../config/env'

/** Host-owned durable session root env var (AGENTS.md rule 9). */
const SESSION_ROOT_ENV = 'BORING_AGENT_SESSION_ROOT'

/** Ledger file name inside a host-owned root; matches `createCoreWorkspaceAgentServer`. */
const HOST_LEDGER_FILENAME = '.agent-request-ledger.sqlite'

/**
 * Legacy in-workspace ledger location. Kept as the documented compatibility
 * fallback for hosts that configure neither an explicit ledger path nor a
 * host-owned session root.
 */
const LEGACY_WORKSPACE_LEDGER_SEGMENTS = ['.boring', 'agent-request-ledger.sqlite'] as const

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export interface ResolveRequestLedgerPathInput {
  /** Explicit host-configured ledger file. Wins over every fallback. */
  readonly requestLedgerPath?: string
  /** Host-owned session root supplied by the caller, if any. */
  readonly sessionRoot?: string
  /** User workspace root. Used only by the legacy compatibility fallback. */
  readonly workspaceRoot: string
}

/**
 * Resolve the durable request ledger file for an agent host.
 *
 * The request ledger is host application state, not workspace content, so the
 * chain prefers host-owned storage: explicit option, then the caller's
 * `sessionRoot` or `BORING_AGENT_SESSION_ROOT`, and only then the legacy
 * `<workspaceRoot>/.boring/agent-request-ledger.sqlite` location.
 */
export function resolveRequestLedgerPath(input: ResolveRequestLedgerPathInput): string {
  const explicit = normalizeOptionalPath(input.requestLedgerPath)
  if (explicit) return explicit
  const hostRoot = normalizeOptionalPath(input.sessionRoot)
    ?? normalizeOptionalPath(getEnv(SESSION_ROOT_ENV))
  if (hostRoot) return join(hostRoot, HOST_LEDGER_FILENAME)
  return join(input.workspaceRoot, ...LEGACY_WORKSPACE_LEDGER_SEGMENTS)
}
