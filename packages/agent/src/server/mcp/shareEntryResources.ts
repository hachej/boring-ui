// AR1-004: minimal MCP server resource support for Lane W share entries.
//
// This is the first `listResources`/`readResource` surface in this package
// (`managedAgentMcpServer.ts` otherwise only registers tools) and it is
// mounted on the SAME managed-agent MCP server/transport process — no
// second MCP runtime owner is introduced (AR1-001-SPEC.md §3.4, bead
// wt-391-forward-eq8). Resources exposed = share entries for the
// AUTHENTICATED workspace only, reusing the same session/workspace
// resolution seam the tools already use; there is no separate auth
// mechanism here.
//
// Outcome discipline mirrors the AR1-003 deep-link route: `readResource`
// NEVER throws a protocol-level error for the three Lane W outcomes
// (ok / not_found / tombstoned) — all three are returned as an in-band
// `ReadResourceResult` so a stable, path-free, non-member-indistinguishable
// outcome is always observable by the caller. Only genuinely exceptional
// conditions (oversize target, non-UTF-8 content, a read race) surface as a
// thrown `ManagedAgentMcpError`, reusing the existing generic
// `MCP_AGENT_ARTIFACT_*` codes — Lane W does not invent a third AR1 code
// (spec §3.3: "Access denial is the existing generic membership denial, not
// an AR1 code").

import type { McpServer, ReadResourceTemplateCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ListResourcesResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'

import { sha256Bytes } from '../../shared/digest'
import { ErrorCode } from '../../shared/error-codes'
import { resolveShareEntry, type ShareEntryStore, type ShareEntryV1 } from '../../shared/share-entry'
import type { SessionCtx } from '../../shared/session'
import type { Stat, Workspace } from '../../shared/workspace'
import { ManagedAgentMcpError, type ManagedAgentDelegateRequestContext } from './managedAgentDelegate'

/** Byte cap for a single share resource read, mirroring the delegate-artifact delivery cap. */
const MAX_SHARE_READ_BYTES = 256 * 1024

const SHARE_RESOURCE_URI_TEMPLATE = 'share:///{id}'

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true })

export interface ShareEntryMcpResourceOptions {
  /** Lane W (AR1-002) opaque share-entry store — the single source of truth for entries. */
  store: ShareEntryStore
  /** Resolves the authenticated SessionCtx for a resource request (list or read). */
  resolveSessionCtx(request: ManagedAgentDelegateRequestContext): SessionCtx | Promise<SessionCtx>
  /** Resolves the authorized Workspace to read share targets from, for a given SessionCtx. */
  resolveWorkspace(ctx: SessionCtx): Workspace | Promise<Workspace>
}

interface McpResourceExtra {
  sessionId?: string
  authInfo?: unknown
}

/** Builds the opaque share resource URI for a given share-entry id. */
export function shareResourceUri(id: string): string {
  return `share:///${encodeURIComponent(id)}`
}

/**
 * Registers `listResources`/`readResource` for Lane W share entries on an
 * already-constructed managed-agent `McpServer`. A no-op call site (host
 * omits `shareEntryStore`) leaves Lane W unmounted — see
 * `managedAgentMcpServer.ts`'s optional wiring.
 */
export function registerShareEntryResources(server: McpServer, options: ShareEntryMcpResourceOptions): void {
  const template = new ResourceTemplate(SHARE_RESOURCE_URI_TEMPLATE, {
    list: async (extra) => listShareResources(options, requestContextFromResourceExtra(extra)),
  })

  const readCallback: ReadResourceTemplateCallback = async (uri, variables, extra) =>
    readShareResource(options, variables.id, requestContextFromResourceExtra(extra))

  server.registerResource(
    'share',
    template,
    {
      title: 'Lane W share entry',
      description: 'Same-workspace shareable file reference (AR1). Resolves live, never a blob snapshot.',
    },
    readCallback,
  )
}

function requestContextFromResourceExtra(extra: McpResourceExtra | undefined): ManagedAgentDelegateRequestContext {
  return {
    sessionId: extra?.sessionId,
    authInfo: extra?.authInfo,
  }
}

async function listShareResources(
  options: ShareEntryMcpResourceOptions,
  request: ManagedAgentDelegateRequestContext,
): Promise<ListResourcesResult> {
  const ctx = await options.resolveSessionCtx(request)
  if (!ctx.workspaceId) return { resources: [] }
  const entries = await options.store.list(ctx.workspaceId)
  return {
    resources: entries.map((entry) => ({
      uri: shareResourceUri(entry.id),
      name: entry.id,
    })),
  }
}

async function readShareResource(
  options: ShareEntryMcpResourceOptions,
  rawId: string | string[] | undefined,
  request: ManagedAgentDelegateRequestContext,
): Promise<ReadResourceResult> {
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : undefined
  if (!id) return notFoundResult(shareResourceUri(''))

  const uri = shareResourceUri(id)
  const ctx = await options.resolveSessionCtx(request)
  if (!ctx.workspaceId) return notFoundResult(uri)

  // Membership check happens BEFORE any workspace stat/read: a non-member
  // request must be indistinguishable from a nonexistent id (no existence
  // oracle across workspaces), and must never stat a path string against
  // the wrong workspace.
  const entry = await options.store.get(id)
  if (!entry || entry.workspaceId !== ctx.workspaceId) {
    return notFoundResult(uri)
  }

  const workspace = await options.resolveWorkspace(ctx)
  const resolution = await resolveShareEntry(options.store, id, workspace)
  if (resolution.status === 'not_found') return notFoundResult(uri)
  if (resolution.status === 'tombstoned') {
    return tombstoneResult(uri, resolution.tombstone)
  }
  return readShareEntryContents(uri, resolution.entry, workspace)
}

function notFoundResult(uri: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          status: 'not_found',
          error: { code: ErrorCode.enum.AR1_SHARE_NOT_FOUND, message: 'share not found' },
        }),
      },
    ],
  }
}

function tombstoneResult(uri: string, tombstone: { id: string; workspaceId: string; provenance: ShareEntryV1['provenance'] }): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          status: 'tombstoned',
          error: { code: ErrorCode.enum.AR1_SHARE_TOMBSTONED, message: 'share target is gone' },
          id: tombstone.id,
          workspaceId: tombstone.workspaceId,
          provenance: tombstone.provenance,
        }),
      },
    ],
  }
}

async function readShareEntryContents(uri: string, entry: ShareEntryV1, workspace: Workspace): Promise<ReadResourceResult> {
  const before = await statShareTarget(workspace, entry.path)
  assertShareTargetStat(before)
  assertWithinCap(before.size)
  if (!workspace.readBinaryFile) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE,
      'share target bytes are unavailable through the authorized workspace',
    )
  }
  const bytes = await workspace.readBinaryFile(entry.path)
  const after = await statShareTarget(workspace, entry.path)
  assertShareTargetStat(after)
  if (!sameStat(before, after) || bytes.byteLength !== before.size) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE, 'share target changed while it was being read')
  }
  assertWithinCap(bytes.byteLength)

  const text = decodeUtf8(bytes)
  const digest = await sha256Bytes(bytes)

  return {
    contents: [
      {
        uri,
        mimeType: 'text/plain',
        text,
        _meta: {
          status: 'ok',
          digest,
          byteSize: bytes.byteLength,
          provenance: entry.provenance,
        },
      },
    ],
  }
}

async function statShareTarget(workspace: Workspace, path: string): Promise<Stat> {
  try {
    return await workspace.stat(path)
  } catch {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE, 'share target is unavailable')
  }
}

function assertShareTargetStat(stat: Stat): void {
  if (stat.kind !== 'file') {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'share target must be a file')
  }
  if (!Number.isFinite(stat.size) || stat.size < 0) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'share target size is invalid')
  }
}

function assertWithinCap(byteSize: number): void {
  if (byteSize > MAX_SHARE_READ_BYTES) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.MCP_AGENT_ARTIFACT_TOO_LARGE,
      `share target must be ${MAX_SHARE_READ_BYTES} bytes or fewer`,
    )
  }
}

function sameStat(left: Stat, right: Stat): boolean {
  return left.kind === right.kind && left.size === right.size && left.mtimeMs === right.mtimeMs
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return strictUtf8Decoder.decode(bytes)
  } catch {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'share target must be well-formed UTF-8')
  }
}
