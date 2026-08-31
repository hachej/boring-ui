import { createHash, randomBytes } from "node:crypto"

export interface RuntimeProjectionIdentity {
  readonly workspaceId: string
  readonly agentTypeId: string
  readonly sessionId: string
  readonly generationId: string
}

export interface RuntimeProjectionUpstreamLease {
  readonly url: string
  readonly expiresAt: string
  revoke(): Promise<void>
}

export interface RuntimeProjectionGrant {
  readonly leaseId: string
  readonly bootstrapPath: string
  readonly grant: string
  readonly expiresAt: string
  revoke(): Promise<void>
}

interface RevocableConnection {
  destroy(error?: Error): unknown
  once(event: "close", listener: () => void): unknown
}

interface ProjectionRecord {
  readonly leaseId: string
  readonly identity: RuntimeProjectionIdentity
  readonly upstream: RuntimeProjectionUpstreamLease
  readonly grantHash: string
  sessionHash: string
  readonly sockets: Set<RevocableConnection>
  grantConsumed: boolean
  revoked: boolean
}

const equalIdentity = (a: RuntimeProjectionIdentity, b: RuntimeProjectionIdentity) => (
  a.workspaceId === b.workspaceId
  && a.agentTypeId === b.agentTypeId
  && a.sessionId === b.sessionId
  && a.generationId === b.generationId
)
const opaque = () => randomBytes(32).toString("base64url")
const digest = (value: string) => createHash("sha256").update(value).digest("base64url")

/**
 * In-memory authority for sealed, same-origin runtime projections. Upstream
 * URLs and provider credentials never leave this object. Revocation is
 * synchronous for request admission and active sockets; provider cleanup is
 * observed asynchronously by the returned promise.
 */
export class RuntimeProjectionBroker {
  private readonly records = new Map<string, ProjectionRecord>()

  create(input: {
    readonly identity: RuntimeProjectionIdentity
    readonly upstream: RuntimeProjectionUpstreamLease
  }): RuntimeProjectionGrant {
    const expiry = Date.parse(input.upstream.expiresAt)
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new TypeError("projection expiry must be in the future")
    const leaseId = opaque()
    const grant = opaque()
    const session = opaque()
    const record: ProjectionRecord = {
      leaseId,
      identity: Object.freeze({ ...input.identity }),
      upstream: input.upstream,
      grantHash: digest(grant),
      sessionHash: digest(session),
      sockets: new Set(),
      grantConsumed: false,
      revoked: false,
    }
    this.records.set(leaseId, record)
    return Object.freeze({
      leaseId,
      bootstrapPath: `/api/v1/runtime-projection/bootstrap/${leaseId}`,
      grant,
      expiresAt: input.upstream.expiresAt,
      revoke: () => this.revoke(leaseId),
    })
  }

  consumeGrant(input: {
    readonly leaseId: string
    readonly grant: string
    readonly identity: RuntimeProjectionIdentity
  }): { readonly cookie: string; readonly location: string } | undefined {
    const record = this.authorizeRecord(input.leaseId, input.identity)
    if (!record || record.grantConsumed || digest(input.grant) !== record.grantHash) return undefined
    record.grantConsumed = true
    // The raw cookie is generated only here and replaced by its digest in the
    // record. Reconstruct a fresh session secret while preserving one-way storage.
    const cookie = opaque()
    record.sessionHash = digest(cookie)
    return {
      cookie: `boring_projection=${cookie}; HttpOnly; SameSite=Strict; Path=/api/v1/runtime-projection/view/${record.leaseId}/; Max-Age=${Math.max(1, Math.floor((Date.parse(record.upstream.expiresAt) - Date.now()) / 1000))}`,
      location: `/api/v1/runtime-projection/view/${record.leaseId}/`,
    }
  }

  authorize(input: {
    readonly leaseId: string
    readonly cookie: string | undefined
    readonly identity: RuntimeProjectionIdentity
  }): { readonly upstream: URL; readonly record: object } | undefined {
    const record = this.authorizeRecord(input.leaseId, input.identity)
    if (!record || !input.cookie || digest(input.cookie) !== record.sessionHash) return undefined
    return { upstream: new URL(record.upstream.url), record }
  }

  track(recordHandle: object, socket: RevocableConnection): () => void {
    const record = recordHandle as ProjectionRecord
    if (record.revoked) {
      socket.destroy()
      return () => undefined
    }
    record.sockets.add(socket)
    const remove = () => record.sockets.delete(socket)
    socket.once("close", remove)
    return remove
  }

  async revoke(leaseId: string): Promise<void> {
    const record = this.records.get(leaseId)
    if (!record || record.revoked) return
    record.revoked = true
    this.records.delete(leaseId)
    for (const socket of record.sockets) socket.destroy()
    record.sockets.clear()
    await record.upstream.revoke()
  }

  private authorizeRecord(leaseId: string, identity: RuntimeProjectionIdentity): ProjectionRecord | undefined {
    const record = this.records.get(leaseId)
    if (!record || record.revoked || Date.parse(record.upstream.expiresAt) <= Date.now()) return undefined
    return equalIdentity(record.identity, identity) ? record : undefined
  }
}

export function readProjectionCookie(header: string | undefined): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [name, ...value] = part.trim().split("=")
    if (name === "boring_projection") return value.join("=") || undefined
  }
  return undefined
}
