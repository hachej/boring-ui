import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type {
  SandboxProviderV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'
import type { Entry, ExecResult, Stat } from '../shared/index'

const LEASE_HANDLE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export const SANDBOX_LEASE_ERROR_CODES = Object.freeze({
  INVALID_LEASE_REQUEST: 'invalid-lease-request',
  LEASE_NOT_FOUND: 'lease-not-found',
  LEASE_EXPIRED: 'lease-expired',
  BINARY_UPLOAD_UNSUPPORTED: 'binary-upload-unsupported',
} as const)

export type SandboxLeaseErrorCode =
  (typeof SANDBOX_LEASE_ERROR_CODES)[keyof typeof SANDBOX_LEASE_ERROR_CODES]

/** A host-issued capability; callers never receive a provider or filesystem root. */
export interface SandboxLease {
  readonly handle: string
  readonly expiresAt: number
}

export type RunSandboxInput =
  | {
    op: 'exec'
    ownerId: string
    lease: string
    command: string
    timeoutMs?: number
    maxOutputBytes?: number
  }
  | { op: 'read'; ownerId: string; lease: string; path: string }
  | { op: 'write'; ownerId: string; lease: string; path: string; content: string }
  | { op: 'list'; ownerId: string; lease: string; path?: string }
  | { op: 'stat'; ownerId: string; lease: string; path?: string }
  | {
    op: 'upload'
    ownerId: string
    lease: string
    path: string
    content: Uint8Array
    /** Explicitly choose overwrite rather than silently replacing verification artifacts. */
    overwrite: boolean
  }
  | { op: 'release'; ownerId: string; lease: string }

export type RunSandboxResult =
  | { op: 'exec'; result: ExecResult }
  | { op: 'read'; content: string }
  | { op: 'write'; ok: true }
  | { op: 'list'; entries: Entry[] }
  | { op: 'stat'; stat: Stat }
  | { op: 'upload'; ok: true }
  | { op: 'release'; released: true }

export interface SandboxLeaseServiceOptions {
  /** Host-owned root used only to construct provider create contexts. Never accepted by runSandbox. */
  workspaceRoot: string
  provider: SandboxProviderV1
  ttlMs: number
  now?: () => number
  createHandle?: () => string
}

interface ActiveLease extends SandboxLease {
  readonly ownerId: string
  readonly pair: WorkspaceSandboxPairV1
}

export class SandboxLeaseError extends Error {
  constructor(
    readonly code: SandboxLeaseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SandboxLeaseError'
  }
}

/**
 * Host-owned, disposable sandbox leases for verification work.
 *
 * This deliberately has no provider configuration, credential, or host-path
 * inputs on its operation surface. Each call is scoped by both host-authenticated
 * owner and an opaque lease handle.
 */
export class SandboxLeaseService {
  private readonly leases = new Map<string, ActiveLease>()
  private readonly now: () => number
  private readonly createHandle: () => string

  constructor(private readonly options: SandboxLeaseServiceOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'ttlMs must be greater than zero')
    }
    this.now = options.now ?? Date.now
    this.createHandle = options.createHandle ?? randomUUID
  }

  async acquire(ownerId: string): Promise<SandboxLease> {
    this.assertOwner(ownerId)
    const handle = this.nextHandle()
    const pair = await this.options.provider.create({
      workspaceRoot: join(this.options.workspaceRoot, handle),
      sessionId: handle,
    })
    const lease: ActiveLease = {
      handle,
      ownerId,
      pair,
      expiresAt: this.now() + this.options.ttlMs,
    }
    this.leases.set(handle, lease)
    return { handle, expiresAt: lease.expiresAt }
  }

  /** The sole caller-facing operation surface for a leased verification sandbox. */
  async runSandbox(input: RunSandboxInput): Promise<RunSandboxResult> {
    const lease = await this.requireLease(input.ownerId, input.lease)
    switch (input.op) {
      case 'exec':
        return {
          op: 'exec',
          // Intentionally omit cwd and env: they would be runtime redirection inputs.
          result: await lease.pair.sandbox.exec(input.command, {
            timeoutMs: input.timeoutMs,
            maxOutputBytes: input.maxOutputBytes,
          }),
        }
      case 'read':
        return { op: 'read', content: await lease.pair.workspace.readFile(assertWorkspacePath(input.path)) }
      case 'write':
        await lease.pair.workspace.writeFile(assertWorkspacePath(input.path), input.content)
        return { op: 'write', ok: true }
      case 'list':
        return { op: 'list', entries: await lease.pair.workspace.readdir(assertWorkspacePath(input.path ?? '.', true)) }
      case 'stat':
        return { op: 'stat', stat: await lease.pair.workspace.stat(assertWorkspacePath(input.path ?? '.', true)) }
      case 'upload':
        await this.upload(lease, input)
        return { op: 'upload', ok: true }
      case 'release':
        await this.disposeLease(lease)
        return { op: 'release', released: true }
    }
  }

  /** Host scheduler hook: dispose expired leases before or between Worker runs. */
  async reapExpired(): Promise<number> {
    const expired = [...this.leases.values()].filter((lease) => lease.expiresAt <= this.now())
    for (const lease of expired) await this.disposeLease(lease)
    return expired.length
  }

  async dispose(): Promise<void> {
    for (const lease of [...this.leases.values()]) await this.disposeLease(lease)
  }

  private async upload(
    lease: ActiveLease,
    input: Extract<RunSandboxInput, { op: 'upload' }>,
  ): Promise<void> {
    const path = assertWorkspacePath(input.path)
    if (input.overwrite) {
      if (!lease.pair.workspace.writeBinaryFile) {
        throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.BINARY_UPLOAD_UNSUPPORTED, 'sandbox workspace does not support binary uploads')
      }
      await lease.pair.workspace.writeBinaryFile(path, input.content)
      return
    }
    if (!lease.pair.workspace.createBinaryFile) {
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.BINARY_UPLOAD_UNSUPPORTED, 'sandbox workspace does not support exclusive binary uploads')
    }
    await lease.pair.workspace.createBinaryFile(path, input.content)
  }

  private async requireLease(ownerId: string, handle: string): Promise<ActiveLease> {
    this.assertOwner(ownerId)
    const lease = this.leases.get(handle)
    // Do not let a caller distinguish an unknown handle from another owner's handle.
    if (!lease || lease.ownerId !== ownerId) {
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND, 'sandbox lease is unavailable')
    }
    if (lease.expiresAt <= this.now()) {
      await this.disposeLease(lease)
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED, 'sandbox lease has expired')
    }
    return lease
  }

  private async disposeLease(lease: ActiveLease): Promise<void> {
    // Keep the lease addressable when provider cleanup fails so release/reaping
    // can retry instead of losing the only handle to a live remote resource.
    await lease.pair.dispose()
    this.leases.delete(lease.handle)
  }

  private assertOwner(ownerId: string): void {
    if (ownerId.trim().length === 0) {
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'ownerId is required')
    }
  }

  private nextHandle(): string {
    const handle = this.createHandle()
    if (!LEASE_HANDLE_PATTERN.test(handle) || this.leases.has(handle)) {
      throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'lease handle generator returned an invalid handle')
    }
    return handle
  }
}

/** Convenience name for future Worker tool catalogs; it exposes no provider controls. */
export async function runSandbox(
  service: SandboxLeaseService,
  input: RunSandboxInput,
): Promise<RunSandboxResult> {
  return await service.runSandbox(input)
}

function assertWorkspacePath(value: string, allowRoot = false): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')) {
    throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'workspace path must be a non-empty POSIX relative path')
  }
  if (allowRoot && value === '.') return value
  if (value === '.' || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'workspace path must not be a root or absolute path')
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'workspace path traversal is not allowed')
  }
  return value
}
