import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";
import { remoteWorkerRequestDigestV1 } from "../../remote-worker/requestDigest";
import type { TrustedWorkspaceMountSource } from "./dockerArgv";
import { runscRuntimeError } from "./errors";
import { validateCanonicalQuotaWorkspaceId, validateQuotaWorkspaceId } from "./quota";
export interface SessionCreateStateInputV1 {
  readonly sandboxId?: string; readonly clientLeaseId: string; readonly workspaceId: string;
  readonly workspaceMountSource?: TrustedWorkspaceMountSource; readonly image: string;
  readonly idleTtlMs?: number; readonly hardLifetimeMs?: number;
}
export interface SessionLeaseStateV1 {
  readonly sandboxId: string; readonly leaseExpiresAtMs: number; readonly hardExpiresAtMs: number; readonly newlyAllocated?: boolean;
}
export interface SessionIdentityRecordV1 {
  readonly sandboxId: string; readonly clientLeaseId: string; readonly createDigest: `sha256:${string}`;
  readonly workspaceId: string; readonly ownsWorkspaceMountSource: boolean; leaseExpiresAtMs: number;
  readonly hardExpiresAtMs: number; timer: ReturnType<typeof setTimeout>; readonly invocations: { clear(): void }; readonly retirement?: unknown;
}
export function compositeSessionKey(workspaceId: string, opaqueId: string): string { return `${workspaceId}\u0000${opaqueId}`; }
export function safeOpaqueId(value: string, label: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) return value;
  throw runscRuntimeError(REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    `remote-worker ${label} is invalid`);
}
function normalizeCreateInput(input: SessionCreateStateInputV1, multiRoot: boolean, sandboxId: string) {
  safeOpaqueId(sandboxId, "sandbox id"); safeOpaqueId(input.clientLeaseId, "client lease id");
  const workspaceId = multiRoot ? validateCanonicalQuotaWorkspaceId(input.workspaceId) : validateQuotaWorkspaceId(input.workspaceId);
  const normalized = { ...input, sandboxId, workspaceId };
  const digest = remoteWorkerRequestDigestV1({
    sandboxId: normalized.sandboxId, clientLeaseId: normalized.clientLeaseId, workspaceId,
    workspaceMountSource: normalized.workspaceMountSource, image: normalized.image,
    idleTtlMs: normalized.idleTtlMs, hardLifetimeMs: normalized.hardLifetimeMs,
  });
  return {
    input: normalized, workspaceId, digest,
    createKey: multiRoot ? compositeSessionKey(workspaceId, normalized.clientLeaseId) : normalized.clientLeaseId,
    sessionKey: multiRoot ? compositeSessionKey(workspaceId, normalized.sandboxId) : normalized.sandboxId,
  };
}
type SessionStateErrorV1 = "unavailable" | "composite-authority" | "not-found" |
  "workspace-mismatch" | "conflict" | "incomplete-cleanup";
export function sessionStateError(kind: SessionStateErrorV1): never {
  const values = {
    unavailable: [REMOTE_WORKER_ERROR_CODES_V1.unavailable, "remote-worker runtime is unavailable"],
    "composite-authority": [REMOTE_WORKER_ERROR_CODES_V1.requestInvalid, "remote-worker workspace authority is required"],
    "not-found": [REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound, "remote-worker sandbox was not found"],
    "workspace-mismatch": [REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch, "remote-worker sandbox binding does not match the authorized workspace"],
    conflict: [REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict, "remote-worker idempotency key conflicts with an existing request"],
    "incomplete-cleanup": [REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup, "remote-worker invocation cleanup could not be proven"],
  } as const;
  const [code, message] = values[kind];
  throw runscRuntimeError(code, message);
}
export class RunscSessionStateV1<RecordV1 extends SessionIdentityRecordV1> {
  readonly sessions = new Map<string, RecordV1>(); readonly leaseBindings = new Map<string, RecordV1>();
  private readonly legacyWorkspaceBindings = new Map<string, RecordV1>();
  private readonly pendingLegacyWorkspaces = new Set<string>(); private readonly pendingSessionKeys = new Set<string>();
  private readonly pendingCreates = new Map<string, { digest: `sha256:${string}`; sandboxId: string; promise: Promise<SessionLeaseStateV1> }>();
  private activeCreates = 0;
  create(input: SessionCreateStateInputV1, multiRoot: boolean, maxConcurrentCreates: number,
    allocateSandboxId: () => string, createNew: (input: SessionCreateStateInputV1 & { sandboxId: string }, digest: `sha256:${string}`) => Promise<SessionLeaseStateV1>,
  ): Promise<SessionLeaseStateV1> {
    safeOpaqueId(input.clientLeaseId, "client lease id");
    const workspaceId = multiRoot ? validateCanonicalQuotaWorkspaceId(input.workspaceId) : validateQuotaWorkspaceId(input.workspaceId);
    const createKey = multiRoot ? compositeSessionKey(workspaceId, input.clientLeaseId) : input.clientLeaseId;
    const existing = this.leaseBindings.get(createKey); const pending = this.pendingCreates.get(createKey);
    const sandboxId = input.sandboxId ?? existing?.sandboxId ?? pending?.sandboxId ?? allocateSandboxId();
    const normalized = normalizeCreateInput(input, multiRoot, sandboxId);
    if (existing) {
      if (existing.createDigest !== normalized.digest) sessionStateError("conflict");
      if (existing.retirement) sessionStateError("incomplete-cleanup");
      return Promise.resolve(this.lease(existing, false));
    }
    if (pending) {
      if (pending.digest !== normalized.digest) sessionStateError("conflict");
      return pending.promise.then((lease) => multiRoot ? { ...lease, newlyAllocated: false } : lease);
    }
    if (this.sessions.has(normalized.sessionKey) || this.pendingSessionKeys.has(normalized.sessionKey))
      sessionStateError("conflict");
    if (!multiRoot && (this.legacyWorkspaceBindings.has(normalized.workspaceId) ||
      this.pendingLegacyWorkspaces.has(normalized.workspaceId))) sessionStateError("conflict");
    if (this.activeCreates >= maxConcurrentCreates) {
      throw runscRuntimeError(REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
        "remote-worker create concurrency is exhausted");
    }
    this.activeCreates += 1;
    this.pendingSessionKeys.add(normalized.sessionKey);
    if (!multiRoot) this.pendingLegacyWorkspaces.add(normalized.workspaceId);
    const operation = createNew(normalized.input, normalized.digest);
    this.pendingCreates.set(normalized.createKey, { digest: normalized.digest, sandboxId, promise: operation });
    const finish = (): void => {
      this.activeCreates -= 1; this.pendingCreates.delete(normalized.createKey);
      this.pendingSessionKeys.delete(normalized.sessionKey); this.pendingLegacyWorkspaces.delete(normalized.workspaceId);
    };
    void operation.then(finish, finish);
    return operation;
  }
  findSession(sandboxId: string, workspaceId: string, multiRoot: boolean): RecordV1 | undefined {
    safeOpaqueId(sandboxId, "sandbox id");
    const canonical = multiRoot ? validateCanonicalQuotaWorkspaceId(workspaceId)
      : validateQuotaWorkspaceId(workspaceId);
    const record = this.sessions.get(multiRoot ? compositeSessionKey(canonical, sandboxId) : sandboxId);
    return record?.workspaceId === canonical ? record : undefined;
  }
  findLegacySession(sandboxId: string): RecordV1 | undefined {
    safeOpaqueId(sandboxId, "sandbox id"); return this.sessions.get(sandboxId);
  }
  sessionKey(record: RecordV1): string {
    return record.ownsWorkspaceMountSource ? compositeSessionKey(record.workspaceId, record.sandboxId) : record.sandboxId;
  }
  private leaseKey(record: RecordV1): string {
    return record.ownsWorkspaceMountSource ? compositeSessionKey(record.workspaceId, record.clientLeaseId) : record.clientLeaseId;
  }
  bind(record: RecordV1): void {
    this.sessions.set(this.sessionKey(record), record);
    this.leaseBindings.set(this.leaseKey(record), record);
    if (!record.ownsWorkspaceMountSource) this.legacyWorkspaceBindings.set(record.workspaceId, record);
  }
  detach(record: RecordV1): void {
    clearTimeout(record.timer);
    this.sessions.delete(this.sessionKey(record));
    const leaseKey = this.leaseKey(record);
    if (this.leaseBindings.get(leaseKey) === record) this.leaseBindings.delete(leaseKey);
    if (this.legacyWorkspaceBindings.get(record.workspaceId) === record)
      this.legacyWorkspaceBindings.delete(record.workspaceId);
    record.invocations.clear();
  }
  lease(record: RecordV1, newlyAllocated: boolean): SessionLeaseStateV1 {
    const legacy = { sandboxId: record.sandboxId,
      leaseExpiresAtMs: record.leaseExpiresAtMs, hardExpiresAtMs: record.hardExpiresAtMs };
    return Object.freeze(record.ownsWorkspaceMountSource
      ? { ...legacy, newlyAllocated } : legacy);
  }
}
