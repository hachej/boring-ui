import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { mountRcloneS3, type MountHandle, type RcloneS3MountSpec } from "./rcloneMount";

export const MOUNT_ERROR_CODES = {
  unavailable: "mount-unavailable",
  stale: "mount-stale",
  writebackFailed: "writeback-failed",
  pathOutsidePrefix: "path-outside-prefix",
  egressDenied: "egress-denied",
  unsupportedMountMode: "unsupported-mount-mode",
} as const;

export type MountErrorCode = (typeof MOUNT_ERROR_CODES)[keyof typeof MOUNT_ERROR_CODES];
export type MountSourceErrorKind = "storage-gone" | "transient";

export class MountLifecycleError extends Error {
  readonly code: MountErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: MountErrorCode, cause?: unknown) {
    super(message);
    this.name = "MountLifecycleError";
    this.code = code;
    this.cause = cause;
  }
}

export interface ManagedMountHandle extends MountHandle {
  readonly sessionId: string;
  readonly cacheDir: string;
  readonly immutable: boolean;
  readonly ready: boolean;
  ensureReady(): Promise<void>;
}

export interface MountLifecycleSessionSpec extends Omit<RcloneS3MountSpec, "cacheDir"> {
  sessionId: string;
  immutable?: boolean;
}

interface MountRecord {
  readonly spec: MountLifecycleSessionSpec;
  handle: ManagedMountHandle;
  readonly root: string;
  readonly sharedKey?: string;
}

interface SharedMountRecord {
  refs: number;
  record: MountRecord;
}

interface PendingRemount {
  canceled: boolean;
}

export interface MountLifecycleManagerOptions {
  baseDir?: string;
  mount?: (spec: RcloneS3MountSpec) => Promise<MountHandle>;
  readMountInfo?: () => Promise<string>;
  statPath?: typeof stat;
  readdirPath?: typeof readdir;
  removePath?: typeof rm;
  pollIntervalMs?: number;
  readinessTimeoutMs?: number;
  eioRetries?: number;
}

export interface MountedSourceOperationOptions {
  retryTransient?: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_READINESS_TIMEOUT_MS = 5000;
const DEFAULT_EIO_RETRIES = 2;

function extractErrno(error: unknown): string | undefined {
  const record = error as { code?: unknown; errno?: unknown; cause?: { code?: unknown } } | null;
  if (typeof record?.code === "string") return record.code;
  if (typeof record?.errno === "string") return record.errno;
  if (typeof record?.cause?.code === "string") return record.cause.code;
  return undefined;
}

export function classifyMountSourceError(error: unknown): MountSourceErrorKind | null {
  const errno = extractErrno(error);
  if (errno === "ENOTCONN" || errno === "ESTALE") return "storage-gone";
  if (errno === "EIO") return "transient";
  return null;
}

function hasMountErrorCode(error: unknown, code: MountErrorCode): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

function decodeMountInfoField(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

export function mountInfoContainsMountpoint(mountInfo: string, mountpoint: string): boolean {
  return mountInfo.split("\n").some((line) => {
    const fields = line.split(" - ")[0]?.split(" ");
    if (!fields || fields.length < 5) return false;
    return decodeMountInfoField(fields[4]) === mountpoint;
  });
}

async function withReadinessDeadline<T>(promise: Promise<T>, deadline: number, mountpoint: string): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new MountLifecycleError(`mount ${mountpoint} readiness probe timed out`, MOUNT_ERROR_CODES.unavailable);
  }

  return Promise.race([
    promise,
    delay(remainingMs).then(() => {
      throw new MountLifecycleError(`mount ${mountpoint} readiness probe timed out`, MOUNT_ERROR_CODES.unavailable);
    }),
  ]);
}

export async function waitForMountReady(
  mountpoint: string,
  options: {
    readMountInfo?: () => Promise<string>;
    statPath?: typeof stat;
    readdirPath?: typeof readdir;
    pollIntervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const readMountInfo = options.readMountInfo ?? (() => readFile("/proc/self/mountinfo", "utf8"));
  const statPath = options.statPath ?? stat;
  const readdirPath = options.readdirPath ?? readdir;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      const mountInfo = await withReadinessDeadline(readMountInfo(), deadline, mountpoint);
      if (mountInfoContainsMountpoint(mountInfo, mountpoint)) {
        const statResult = await withReadinessDeadline(statPath(mountpoint), deadline, mountpoint);
        if (!("isDirectory" in statResult) || statResult.isDirectory()) {
          await withReadinessDeadline(readdirPath(mountpoint), deadline, mountpoint);
          return;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await delay(pollIntervalMs);
  }

  throw new MountLifecycleError(
    `mount ${mountpoint} did not become ready before binding`,
    MOUNT_ERROR_CODES.unavailable,
    lastError,
  );
}

function sharedKeyFor(spec: MountLifecycleSessionSpec): string {
  return [
    spec.endpoint.provider,
    spec.endpoint.url,
    spec.endpoint.region ?? "",
    spec.bucket,
    spec.prefix,
    spec.ro ? "ro" : "rw",
    spec.creds.id,
  ].join("\0");
}

function snapshotSessionSpec(spec: MountLifecycleSessionSpec): MountLifecycleSessionSpec {
  return {
    sessionId: spec.sessionId,
    bucket: spec.bucket,
    prefix: spec.prefix,
    creds: spec.creds,
    ro: spec.ro,
    immutable: spec.immutable === true,
    endpoint: Object.freeze({ ...spec.endpoint }),
  };
}

export class MountLifecycleManager {
  private readonly baseDir: string;
  private readonly mount: (spec: RcloneS3MountSpec) => Promise<MountHandle>;
  private readonly readMountInfo: () => Promise<string>;
  private readonly statPath: typeof stat;
  private readonly readdirPath: typeof readdir;
  private readonly removePath: typeof rm;
  private readonly pollIntervalMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly eioRetries: number;
  private readonly sessions = new Map<string, MountRecord>();
  private readonly shared = new Map<string, SharedMountRecord>();
  private readonly pendingSessions = new Set<string>();
  private readonly pendingSessionCompletions = new Map<string, Promise<void>>();
  private readonly pendingTeardowns = new Set<string>();
  private readonly pendingShared = new Map<string, Promise<MountRecord>>();
  private readonly pendingSharedWaiters = new Map<string, number>();
  private readonly pendingRemounts = new Map<string, PendingRemount>();

  constructor(options: MountLifecycleManagerOptions = {}) {
    this.baseDir = options.baseDir ?? join(tmpdir(), "boring-sandbox-mounts-");
    this.mount = options.mount ?? mountRcloneS3;
    this.readMountInfo = options.readMountInfo ?? (() => readFile("/proc/self/mountinfo", "utf8"));
    this.statPath = options.statPath ?? stat;
    this.readdirPath = options.readdirPath ?? readdir;
    this.removePath = options.removePath ?? rm;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.eioRetries = options.eioRetries ?? DEFAULT_EIO_RETRIES;
  }

  async mountSession(spec: MountLifecycleSessionSpec): Promise<ManagedMountHandle> {
    const stableSpec = snapshotSessionSpec(spec);
    if (this.sessions.has(stableSpec.sessionId) || this.pendingSessions.has(stableSpec.sessionId)) {
      throw new MountLifecycleError(`mount session ${stableSpec.sessionId} is already active`, MOUNT_ERROR_CODES.unavailable);
    }
    this.pendingSessions.add(stableSpec.sessionId);

    const completion = this.mountSessionAfterReservation(stableSpec);
    this.pendingSessionCompletions.set(stableSpec.sessionId, completion.then(() => undefined, () => undefined));
    try {
      return await completion;
    } finally {
      this.pendingSessions.delete(stableSpec.sessionId);
      this.pendingSessionCompletions.delete(stableSpec.sessionId);
      this.pendingTeardowns.delete(stableSpec.sessionId);
    }
  }

  private async mountSessionAfterReservation(spec: MountLifecycleSessionSpec): Promise<ManagedMountHandle> {
    if (spec.ro && spec.immutable) {
      const sharedKey = sharedKeyFor(spec);
      const existing = this.shared.get(sharedKey);
      if (existing) {
        existing.refs += 1;
        this.sessions.set(spec.sessionId, existing.record);
        return this.facadeOrCancel(existing.record, spec.sessionId);
      }

      const pending = this.pendingShared.get(sharedKey);
      if (pending) {
        this.pendingSharedWaiters.set(sharedKey, (this.pendingSharedWaiters.get(sharedKey) ?? 0) + 1);
        try {
          const record = await pending;
          const shared = this.shared.get(sharedKey);
          if (!shared) {
            throw new MountLifecycleError("shared mount creation failed", MOUNT_ERROR_CODES.unavailable);
          }
          shared.refs += 1;
          this.sessions.set(spec.sessionId, record);
          return this.facadeOrCancel(record, spec.sessionId, true);
        } finally {
          const waiters = (this.pendingSharedWaiters.get(sharedKey) ?? 1) - 1;
          if (waiters > 0) this.pendingSharedWaiters.set(sharedKey, waiters);
          else this.pendingSharedWaiters.delete(sharedKey);
        }
      }

      const pendingRecord = this.createRecord(spec, sharedKey);
      this.pendingShared.set(sharedKey, pendingRecord);
      try {
        const record = await pendingRecord;
        this.shared.set(sharedKey, { refs: 1, record });
        this.sessions.set(spec.sessionId, record);
        return this.facadeOrCancel(record, spec.sessionId);
      } finally {
        this.pendingShared.delete(sharedKey);
      }
    }

    const record = await this.createRecord(spec);
    this.sessions.set(spec.sessionId, record);
    return this.facadeOrCancel(record, spec.sessionId);
  }

  async teardownSession(sessionId: string): Promise<void> {
    const remount = this.pendingRemounts.get(sessionId);
    if (remount) {
      remount.canceled = true;
      return;
    }

    const pending = this.pendingSessionCompletions.get(sessionId);
    if (pending) {
      this.pendingTeardowns.add(sessionId);
      await pending;
      await this.teardownCommittedSession(sessionId);
      return;
    }
    await this.teardownCommittedSession(sessionId);
  }

  private async teardownCommittedSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    let removedShared: SharedMountRecord | undefined;

    if (record.sharedKey) {
      const shared = this.shared.get(record.sharedKey);
      if (shared && shared.refs > 1) {
        shared.refs -= 1;
        this.sessions.delete(sessionId);
        return;
      }
      removedShared = shared;
      this.shared.delete(record.sharedKey);
    }

    try {
      await this.teardownRecord(record);
    } catch (error) {
      if (hasMountErrorCode(error, MOUNT_ERROR_CODES.writebackFailed)) {
        this.sessions.delete(sessionId);
      } else if (record.sharedKey && removedShared && !this.shared.has(record.sharedKey)) {
        this.shared.set(record.sharedKey, removedShared);
      }
      throw error;
    }
    this.sessions.delete(sessionId);
  }

  async withMountedSource<T>(
    sessionId: string,
    operation: (handle: ManagedMountHandle) => Promise<T>,
    options: MountedSourceOperationOptions = {},
  ): Promise<T> {
    let record = this.requireSession(sessionId);
    let eioAttempts = 0;
    let remounted = false;

    while (true) {
      try {
        return await operation(this.createSessionFacade(record, sessionId));
      } catch (error) {
        const kind = classifyMountSourceError(error);
        if (kind === "storage-gone" && !remounted) {
          record = await this.remountSession(sessionId);
          remounted = true;
          continue;
        }

        if (kind === "transient" && options.retryTransient === true && eioAttempts < this.eioRetries) {
          eioAttempts += 1;
          await delay(this.pollIntervalMs);
          continue;
        }

        throw error;
      }
    }
  }

  private requireSession(sessionId: string): MountRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new MountLifecycleError(`mount session ${sessionId} is not active`, MOUNT_ERROR_CODES.unavailable);
    }
    return record;
  }

  private async createRecord(spec: MountLifecycleSessionSpec, sharedKey?: string): Promise<MountRecord> {
    const root = await mkdtemp(this.baseDir);
    const cacheDir = join(root, "cache");
    let rawHandle: MountHandle;
    try {
      rawHandle = await this.mount({ ...spec, cacheDir });
    } catch (error) {
      await this.removePath(root, { recursive: true, force: true });
      throw error;
    }
    const ensureReady = async () => waitForMountReady(rawHandle.mountpoint, {
      readMountInfo: this.readMountInfo,
      statPath: this.statPath,
      readdirPath: this.readdirPath,
      pollIntervalMs: this.pollIntervalMs,
      timeoutMs: this.readinessTimeoutMs,
    });

    try {
      await ensureReady();
    } catch (error) {
      let unmounted = false;
      try {
        await rawHandle.unmount();
        unmounted = true;
      } catch {
        // Startup cleanup may run before a FUSE mount exists; keep the
        // readiness error as the actionable failure and leave the fresh tree
        // for janitor cleanup unless unmount definitely succeeded.
      } finally {
        if (unmounted) {
          await this.removePath(root, { recursive: true, force: true });
        }
      }
      throw error;
    }

    const handle: ManagedMountHandle = {
      ...rawHandle,
      sessionId: spec.sessionId,
      cacheDir,
      immutable: spec.immutable === true,
      ready: true,
      ensureReady,
      async unmount() {
        await rawHandle.unmount();
      },
    };

    return { spec, handle, root, sharedKey };
  }

  private createSessionFacade(record: MountRecord, sessionId: string): ManagedMountHandle {
    const manager = this;
    return {
      ...record.handle,
      sessionId,
      async unmount() {
        await manager.teardownSession(sessionId);
      },
    };
  }

  private async facadeOrCancel(record: MountRecord, sessionId: string, pendingSharedWaiter = false): Promise<ManagedMountHandle> {
    if (this.pendingTeardowns.has(sessionId)) {
      if (record.sharedKey && (this.pendingSharedWaiters.get(record.sharedKey) ?? 0) > 0) {
        const shared = this.shared.get(record.sharedKey);
        if (shared) shared.refs -= 1;
        this.sessions.delete(sessionId);
        if (pendingSharedWaiter && shared && shared.refs <= 0 && (this.pendingSharedWaiters.get(record.sharedKey) ?? 0) <= 1) {
          this.shared.delete(record.sharedKey);
          await this.teardownRecord(record);
        }
        throw new MountLifecycleError(`mount session ${sessionId} was torn down before it became ready`, MOUNT_ERROR_CODES.unavailable);
      }
      await this.teardownCommittedSession(sessionId);
      throw new MountLifecycleError(`mount session ${sessionId} was torn down before it became ready`, MOUNT_ERROR_CODES.unavailable);
    }
    return this.createSessionFacade(record, sessionId);
  }

  private async remountSession(sessionId: string): Promise<MountRecord> {
    const oldRecord = this.requireSession(sessionId);
    const sharedKey = oldRecord.sharedKey;
    if (sharedKey && this.shared.get(sharedKey)?.record === oldRecord) {
      this.shared.delete(sharedKey);
    }
    const remountSessionIds = Array.from(this.sessions.entries())
      .filter(([, record]) => record === oldRecord)
      .map(([mappedSessionId]) => mappedSessionId);
    const remountStates = remountSessionIds.map((mappedSessionId) => {
      const state: PendingRemount = { canceled: false };
      this.pendingRemounts.set(mappedSessionId, state);
      this.sessions.delete(mappedSessionId);
      return [mappedSessionId, state] as const;
    });

    try {
      await this.teardownRecord(oldRecord);
      const activeRemountSessionIds = remountStates
        .filter(([, state]) => !state.canceled)
        .map(([mappedSessionId]) => mappedSessionId);
      if (activeRemountSessionIds.length === 0) {
        if (sharedKey) {
          this.shared.delete(sharedKey);
        }
        throw new MountLifecycleError(`mount session ${sessionId} is not active`, MOUNT_ERROR_CODES.unavailable);
      }

      let nextRecord: MountRecord;
      try {
        nextRecord = await this.createRecord(oldRecord.spec, sharedKey);
      } catch (error) {
        if (sharedKey) {
          this.shared.delete(sharedKey);
        }
        throw new MountLifecycleError("failed to remount stale storage", MOUNT_ERROR_CODES.unavailable, error);
      }

      const finalSessionIds = remountStates
        .filter(([, state]) => !state.canceled)
        .map(([mappedSessionId]) => mappedSessionId);
      if (finalSessionIds.length === 0) {
        await this.teardownRecord(nextRecord);
        if (sharedKey) {
          this.shared.delete(sharedKey);
        }
        throw new MountLifecycleError(`mount session ${sessionId} is not active`, MOUNT_ERROR_CODES.unavailable);
      }

      let publishedRecord = nextRecord;
      if (sharedKey) {
        const existingShared = this.shared.get(sharedKey);
        if (existingShared) {
          await this.teardownRecord(nextRecord);
          publishedRecord = existingShared.record;
        }
      }

      for (const mappedSessionId of finalSessionIds) {
        this.sessions.set(mappedSessionId, publishedRecord);
      }
      if (sharedKey) {
        const refs = Array.from(this.sessions.values()).filter((record) => record === publishedRecord).length;
        this.shared.set(sharedKey, { refs, record: publishedRecord });
      }
      return publishedRecord;
    } finally {
      for (const [mappedSessionId] of remountStates) {
        this.pendingRemounts.delete(mappedSessionId);
      }
    }
  }

  private async teardownRecord(record: MountRecord): Promise<void> {
    let unmounted = false;
    try {
      await record.handle.unmount();
      unmounted = true;
    } finally {
      if (unmounted) {
        await this.removePath(record.root, { recursive: true, force: true });
      }
    }
  }
}
