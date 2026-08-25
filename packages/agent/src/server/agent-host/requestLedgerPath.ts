import { join } from 'node:path'

import { getEnv } from '../config/env'

/** Host-owned durable session root env var (AGENTS.md rule 9). */
const SESSION_ROOT_ENV = 'BORING_AGENT_SESSION_ROOT'

/** Ledger file name inside a host-owned root. */
const HOST_LEDGER_FILENAME = '.agent-request-ledger.sqlite'

/** Legacy in-workspace ledger location used by the standalone/workspace hosts. */
const LEGACY_WORKSPACE_BORING_DIR_SEGMENTS = ['.boring', 'agent-request-ledger.sqlite'] as const

/**
 * Compatibility location a host falls back to when it has neither an explicit
 * ledger path nor a host-owned session root.
 *
 * Hosts historically disagreed on this tail, so it is the *only* part of the
 * chain that is parameterized. Everything before it is identical for every
 * host and is owned solely by {@link resolveRequestLedgerPath}.
 */
export type LegacyRequestLedgerLocation =
  /** `<workspaceRoot>/.boring/agent-request-ledger.sqlite` (standalone + workspace hosts). */
  | { readonly layout: 'workspace-boring-dir'; readonly workspaceRoot: string }
  /** `<workspaceRoot>/.agent-request-ledger.sqlite` (core workspace host). */
  | { readonly layout: 'workspace-host-file'; readonly workspaceRoot: string }

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function legacyPath(location: LegacyRequestLedgerLocation): string {
  return location.layout === 'workspace-boring-dir'
    ? join(location.workspaceRoot, ...LEGACY_WORKSPACE_BORING_DIR_SEGMENTS)
    : join(location.workspaceRoot, HOST_LEDGER_FILENAME)
}

export interface ResolveRequestLedgerPathInput {
  /** Explicit host-configured ledger file. Wins over every fallback. */
  readonly requestLedgerPath?: string
  /** Host-owned session root supplied by the caller, if any. */
  readonly sessionRoot?: string
  /**
   * Also accept `BORING_AGENT_SESSION_ROOT` as a host-owned root when the
   * caller supplied no `sessionRoot`. Hosts that already fold that env var
   * into their own session-root chain omit this.
   */
  readonly acceptSessionRootEnv?: boolean
  /**
   * Last-resort compatibility location. Omit for hosts that must fail closed
   * instead of inventing an in-workspace ledger; they get `undefined`.
   */
  readonly legacy?: LegacyRequestLedgerLocation
}

/**
  * Resolve the durable request ledger file for an agent host.
 *
 * **Ledger cutover note:** adopting BORING_AGENT_SESSION_ROOT (or an
 * explicit requestLedgerPath) after running with the legacy in-workspace
 * location RELOCATES the sqlite ledger. Effect-idempotency keys recorded
 * at the legacy path are stranded there; retries that span the upgrade
 * may be re-admitted once against the new ledger. Copy or drain the
 * legacy file as part of the cutover if exactly-once effects must
 * survive it.
 *
 * The request ledger is host application state, not workspace content, so the
 * chain prefers host-owned storage: explicit option, then the caller's
 * `sessionRoot` (optionally `BORING_AGENT_SESSION_ROOT`), and only then the
 * host's legacy in-workspace location.
 *
 * This is the sole owner of that chain: no host may re-encode any part of it.
 */
export function resolveRequestLedgerPath(
  input: ResolveRequestLedgerPathInput & { readonly legacy: LegacyRequestLedgerLocation },
): string
export function resolveRequestLedgerPath(input: ResolveRequestLedgerPathInput): string | undefined
export function resolveRequestLedgerPath(input: ResolveRequestLedgerPathInput): string | undefined {
  const explicit = normalizeOptionalPath(input.requestLedgerPath)
  if (explicit) return explicit
  const hostRoot = normalizeOptionalPath(input.sessionRoot)
    ?? (input.acceptSessionRootEnv ? normalizeOptionalPath(getEnv(SESSION_ROOT_ENV)) : undefined)
  if (hostRoot) return join(hostRoot, HOST_LEDGER_FILENAME)
  return input.legacy ? legacyPath(input.legacy) : undefined
}
