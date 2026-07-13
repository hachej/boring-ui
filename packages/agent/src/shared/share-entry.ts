// Lane W same-workspace share-entry store (AR1-002, Decision 21-24, issue
// #632/#636 lane split). See docs/issues/391/runtime-refactor/work/
// AR1-shareable-artifacts/AR1-001-SPEC.md §3 and IMPLEMENTATION-GUARDRAILS.md
// (AR1 section) for the binding contract.
//
// Scope (binding, per the AR1 guardrail): the share-entry store ONLY —
// `{id, workspaceId, path, provenance}` plus the resolution helper that
// decides ok / not-found / tombstoned. No deep-link route, no MCP resource
// exposure, no expiry/revocation/capability-token machinery — Lane W has
// none of that: membership IS the access boundary and membership IS
// revocation (a later bead, AR1-003, adds the membership-gated `/a/<id>`
// route; AR1-004 adds MCP resource exposure). This module does not perform
// membership checks itself — a caller resolves and authorizes the
// `Workspace` for `entry.workspaceId` before calling {@link resolveShareEntry}.
//
// A workspace path is SERVER-INTERNAL and MUST NEVER appear in any handle,
// link, deep-link URL, error, or audit record (AR1-001-SPEC.md §1).
// `resolveShareEntry`'s `not_found` and `tombstoned` outcomes below are the
// one seam a future route/MCP resource bead consumes to render a response —
// neither carries a `path` field, by construction.

import { z } from 'zod'

import { ErrorCode } from './error-codes'
import { formatPath, type AgentSchemaIssue } from './schema-issue'
import type { Workspace } from './workspace'

const nonEmptyString = z.string().min(1)

// ---------------------------------------------------------------------------
// Opaque id
// ---------------------------------------------------------------------------

/**
 * A platform-owned opaque locator id: a bare surrogate key with no path or
 * scheme semantics whatsoever — no separators, no `..`, no `:`. This is what
 * makes `file:`, `http(s):`, absolute paths, and workspace-relative paths
 * structurally unrepresentable as a share `id`/`workspaceId`, not merely
 * discouraged by convention (mirrors the `OpaqueRefSchema` /
 * `isOpaqueLocatorId` precedent in `agent-definition.ts`/`agent-consumption.ts`
 * — same opacity discipline, applied to the Lane W share entry).
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

export const OpaqueShareLocatorIdSchema = z
  .string()
  .min(1, 'must be a non-empty opaque id')
  .max(256, 'must be at most 256 characters')
  .refine(isOpaqueLocatorId, 'must be an opaque platform-owned id (no path separators, no scheme, no traversal)')

/** Mints a fresh opaque share-entry id. Web Crypto only — no `node:*` (invariant). */
function mintShareEntryId(): string {
  return globalThis.crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export interface ShareEntryProvenance {
  producerPrincipalRef: string
  createdAt: string
}

export const ShareEntryProvenanceSchema = z
  .object({
    producerPrincipalRef: nonEmptyString,
    createdAt: nonEmptyString,
  })
  .strict() satisfies z.ZodType<ShareEntryProvenance, z.ZodTypeDef, unknown>

/**
 * Lane W same-workspace share entry (AR1-001-SPEC.md §3.1): a live reference
 * to a file in the SAME workspace the consumer already belongs to. No blob
 * capture — nothing crosses a workspace boundary. `path` is SERVER-INTERNAL
 * and MUST NOT be emitted in any URL/API/audit surface a later bead builds.
 */
export interface ShareEntryV1 {
  schemaVersion: 1
  id: string
  workspaceId: string
  /** SERVER-INTERNAL live path; never emitted in URL/API/audit. */
  path: string
  provenance: ShareEntryProvenance
}

export const ShareEntryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: OpaqueShareLocatorIdSchema,
    workspaceId: OpaqueShareLocatorIdSchema,
    path: nonEmptyString,
    provenance: ShareEntryProvenanceSchema,
  })
  .strict() satisfies z.ZodType<ShareEntryV1, z.ZodTypeDef, unknown>

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Refusal codes for Lane W share resolution (AR1-001-SPEC.md §3.3/§5). Scoped
 * like `AgentConsumptionErrorCode` — canonical, but intentionally outside the
 * public {@link ErrorCode}/`ERROR_CODES` registry until a runtime route/MCP
 * resource actually surfaces these over an API boundary (AR1-003/AR1-004).
 * These are the ONLY two AR1-specific codes for Lane W: "Access denial is
 * the existing generic membership denial, not an AR1 code" (spec §3.3) —
 * this module does not invent a third.
 */
export const ShareEntryErrorCode = z.enum(['AR1_SHARE_NOT_FOUND', 'AR1_SHARE_TOMBSTONED'])

export type ShareEntryErrorCode = z.infer<typeof ShareEntryErrorCode>

/**
 * Input-validation failures for {@link ShareEntryStore.create}. Deliberately
 * NOT an `AR1_*` code (the spec's §5 table names exactly two Lane W codes for
 * resolution outcomes; this reuses the existing generic `CONFIG_INVALID`
 * taxonomy for malformed create-input, the same way `SchemaValidationError`
 * subclasses elsewhere in this package do).
 */
const ShareEntryValidationCode = z.enum(['SHARE_ENTRY_INPUT_INVALID'])
type ShareEntryValidationCode = z.infer<typeof ShareEntryValidationCode>

export class ShareEntryValidationError extends Error {
  readonly code = ErrorCode.enum.CONFIG_INVALID
  readonly field: string

  constructor(issue: AgentSchemaIssue<ShareEntryValidationCode>) {
    super(issue.message)
    this.name = 'ShareEntryValidationError'
    this.field = issue.field
  }
}

function assertValidCreateInput(raw: CreateShareEntryInput): void {
  const result = CreateShareEntryInputSchema.safeParse(raw)
  if (result.success) return
  const issue = result.error.issues[0]
  const field = formatPath(issue.path)
  throw new ShareEntryValidationError({
    code: ShareEntryValidationCode.enum.SHARE_ENTRY_INPUT_INVALID,
    field,
    message: field === '<root>' ? issue.message : `${field} ${issue.message}`,
  })
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface CreateShareEntryInput {
  workspaceId: string
  /** SERVER-INTERNAL live path. Never persist/return this in a public surface. */
  path: string
  provenance: {
    producerPrincipalRef: string
    /** Defaults to the store's creation time when omitted. */
    createdAt?: string
  }
}

const CreateShareEntryInputSchema = z
  .object({
    workspaceId: OpaqueShareLocatorIdSchema,
    path: nonEmptyString,
    provenance: z
      .object({
        producerPrincipalRef: nonEmptyString,
        createdAt: nonEmptyString.optional(),
      })
      .strict(),
  })
  .strict()

export interface ShareEntryStore {
  /** Validates `input`, mints a fresh opaque `id`, and persists the entry. */
  create(input: CreateShareEntryInput): Promise<ShareEntryV1>
  get(id: string): Promise<ShareEntryV1 | null>
  delete(id: string): Promise<void>
  /** Lists entries scoped to one workspace (never leaks across workspaces). */
  list(workspaceId: string): Promise<ShareEntryV1[]>
}

/**
 * In-memory reference implementation. Lane W has no durability requirement
 * beyond "the repo's existing persistence seam" named by this bead (a simple
 * keyed-record store, mirroring `SandboxHandleStore`/`SessionStore` in this
 * same package) — a durable adapter is a swap-in behind the same interface
 * when a later bead needs one; this store does not invent a new store
 * technology.
 */
export class InMemoryShareEntryStore implements ShareEntryStore {
  private readonly entries = new Map<string, ShareEntryV1>()

  async create(input: CreateShareEntryInput): Promise<ShareEntryV1> {
    assertValidCreateInput(input)
    const entry: ShareEntryV1 = {
      schemaVersion: 1,
      id: mintShareEntryId(),
      workspaceId: input.workspaceId,
      path: input.path,
      provenance: {
        producerPrincipalRef: input.provenance.producerPrincipalRef,
        createdAt: input.provenance.createdAt ?? new Date().toISOString(),
      },
    }
    this.entries.set(entry.id, entry)
    return entry
  }

  async get(id: string): Promise<ShareEntryV1 | null> {
    return this.entries.get(id) ?? null
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async list(workspaceId: string): Promise<ShareEntryV1[]> {
    return Array.from(this.entries.values()).filter((entry) => entry.workspaceId === workspaceId)
  }
}

// ---------------------------------------------------------------------------
// Resolution (live-reference + tombstone rendering, spec §3.2/§3.3)
// ---------------------------------------------------------------------------

/** Redacted, path-free projection of a tombstoned entry (spec §3.3/§1: no path in any error surface). */
export interface ShareEntryTombstone {
  id: string
  workspaceId: string
  provenance: ShareEntryProvenance
}

export type ShareEntryResolution =
  | { status: 'ok'; entry: ShareEntryV1 }
  | { status: 'not_found'; code: typeof ShareEntryErrorCode.enum.AR1_SHARE_NOT_FOUND }
  | {
      status: 'tombstoned'
      code: typeof ShareEntryErrorCode.enum.AR1_SHARE_TOMBSTONED
      tombstone: ShareEntryTombstone
    }

/**
 * Resolves a share entry against the CURRENT state of the workspace file
 * (live-reference semantics, spec §3.2 — deliberately not a snapshot). The
 * caller must already have resolved and authorized `workspace` for
 * `entry.workspaceId`; this function performs no membership check itself
 * (spec §3.3: "Access denial is the existing generic membership denial, not
 * an AR1 code").
 *
 * - No such entry -> `not_found` (`AR1_SHARE_NOT_FOUND`).
 * - Entry exists but the target file is gone -> `tombstoned`
 *   (`AR1_SHARE_TOMBSTONED`), carrying provenance + last-known metadata and
 *   NEVER the path (never a bare 404, never source state).
 * - Entry exists and the target file stats successfully -> `ok`, with the
 *   full (server-internal) entry for the caller to act on.
 *
 * Any `workspace.stat` rejection (not just a "does not exist" error) is
 * treated as "target gone" — the spec's fail-safe is to render a tombstone,
 * never a bare 404; a later bead may narrow this to distinguish stat
 * failure causes if that proves necessary.
 */
export async function resolveShareEntry(
  store: ShareEntryStore,
  id: string,
  workspace: Workspace,
): Promise<ShareEntryResolution> {
  const entry = await store.get(id)
  if (!entry) {
    return { status: 'not_found', code: ShareEntryErrorCode.enum.AR1_SHARE_NOT_FOUND }
  }
  try {
    await workspace.stat(entry.path)
  } catch {
    return {
      status: 'tombstoned',
      code: ShareEntryErrorCode.enum.AR1_SHARE_TOMBSTONED,
      tombstone: {
        id: entry.id,
        workspaceId: entry.workspaceId,
        provenance: entry.provenance,
      },
    }
  }
  return { status: 'ok', entry }
}
