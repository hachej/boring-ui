import {
  chown,
  lstat,
  mkdir,
  opendir,
  realpath,
  rm,
  rmdir,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { SandboxProviderError } from "../../../shared/providerV1";
import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";
import {
  trustedSandboxMountSource,
  type TrustedWorkspaceMountSource,
} from "./dockerArgv";
import { runscRuntimeError } from "./errors";
import { RUNSC_RUNTIME_LIMITS_V1 } from "./limits";
import {
  RUNSC_QUOTA_LOCK_NAME,
  validateCanonicalQuotaWorkspaceId,
  type FixedProjectQuotaManagerV1,
} from "./quota";
const sandboxIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type QuotaManager = Pick<
  FixedProjectQuotaManagerV1,
  "workspaceRoot" | "apply" | "check"
>;
type RootIdentity = Readonly<{ dev: bigint; ino: bigint }>;

interface PendingRoot {
  readonly workspace: string;
  readonly workspaceRoot: string;
  readonly sandboxRoot: string;
  workspaceCreated: boolean;
  created: boolean;
  retainedForCleanup: boolean;
}

export interface RunscSandboxRootLifecycleOptionsV1 {
  readonly sandboxRoot: string;
  readonly trustedOwnerUid?: number;
  readonly prepareOwnership?: (path: string) => void | Promise<void>;
  readonly removeSandboxRoot?: (path: string) => void | Promise<void>;
  readonly removeWorkspaceRoot?: (path: string) => void | Promise<void>;
}

function invalidRoot(message: string, cause?: unknown): never {
  throw runscRuntimeError(
    REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
    message,
    cause,
  );
}

function normalizedSandboxId(sandboxId: string): string {
  if (!sandboxIdPattern.test(sandboxId)) {
    invalidRoot("remote-worker sandbox id is invalid");
  }
  return sandboxId;
}

function errorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code,
  );
}

export class RunscSandboxRootLifecycleV1 {
  readonly sandboxRoot: string;
  private readonly trustedOwnerUid: number;
  private trustedRootIdentity?: RootIdentity;
  private readonly readyWorkspaces = new Set<string>();
  private startupReady = false;
  /** Every root this process owns: preparing, active, or retained for cleanup. */
  private readonly pendingRoots = new Map<string, PendingRoot>();
  private ownershipOperation: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: RunscSandboxRootLifecycleOptionsV1) {
    const normalized = resolve(options.sandboxRoot);
    if (
      !isAbsolute(options.sandboxRoot) ||
      normalized === "/" ||
      normalized !== options.sandboxRoot ||
      normalized.length > 3800
    ) {
      invalidRoot("remote-worker sandbox root is invalid");
    }
    this.sandboxRoot = normalized;
    this.trustedOwnerUid = options.trustedOwnerUid ?? 0;
    if (
      !Number.isSafeInteger(this.trustedOwnerUid) ||
      this.trustedOwnerUid < 0
    ) {
      invalidRoot("remote-worker sandbox root owner is invalid");
    }
  }

  /** Roots retained solely for retryable cleanup after create admission ended. */
  get pendingCleanupCount(): number {
    let count = 0;
    for (const pending of this.pendingRoots.values()) {
      if (pending.retainedForCleanup) count += 1;
    }
    return count;
  }

  /** Exact leaf + distinct workspace-parent entries a restart must enumerate. */
  get ownedRecoveryEntryCount(): number {
    const workspaces = new Set<string>();
    for (const pending of this.pendingRoots.values()) {
      workspaces.add(pending.workspace);
    }
    return this.pendingRoots.size + workspaces.size;
  }

  prepare(
    workspaceId: string,
    sandboxId: string,
    quota: QuotaManager,
  ): Promise<TrustedWorkspaceMountSource> {
    return this.withOwnershipLock(
      async () =>
        await this.withStableError(
          async () => await this.prepareOnce(workspaceId, sandboxId, quota),
          REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
          "remote-worker sandbox root could not be prepared",
        ),
    );
  }

  private async prepareOnce(
    workspaceId: string,
    sandboxId: string,
    quota: QuotaManager,
  ): Promise<TrustedWorkspaceMountSource> {
    const workspace = validateCanonicalQuotaWorkspaceId(workspaceId);
    const sandbox = normalizedSandboxId(sandboxId);
    if (quota.workspaceRoot !== this.sandboxRoot) {
      invalidRoot("remote-worker quota and sandbox roots do not match");
    }
    await this.assertTrustedRoot();
    await this.ensureStartupAdmission();
    const workspaceRoot = join(this.sandboxRoot, workspace);
    const sandboxRoot = join(workspaceRoot, sandbox);
    const source = trustedSandboxMountSource(
      this.sandboxRoot,
      workspace,
      sandbox,
    );
    const workspaceAlreadyOwned = [...this.pendingRoots.values()].some(
      (pending) => pending.workspace === workspace,
    );
    const additionalRecoveryEntries = workspaceAlreadyOwned ? 1 : 2;
    if (
      this.pendingRoots.has(sandboxRoot) ||
      this.ownedRecoveryEntryCount + additionalRecoveryEntries >
        RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers
    ) {
      invalidRoot("remote-worker sandbox root cleanup capacity is exhausted");
    }
    const pending: PendingRoot = {
      workspace,
      workspaceRoot,
      sandboxRoot,
      workspaceCreated: false,
      created: false,
      retainedForCleanup: false,
    };
    this.pendingRoots.set(sandboxRoot, pending);
    let workspaceReady = false;
    try {
      await this.ensureWorkspace(workspace, workspaceRoot, quota, pending);
      workspaceReady = true;
      await mkdir(sandboxRoot, { mode: 0o770 });
      pending.created = true;
      if (this.options.prepareOwnership)
        await this.options.prepareOwnership(sandboxRoot);
      else await chown(sandboxRoot, 65_532, 65_532);
      await this.assertTrustedRoot();
      await this.assertExactDirectory(workspaceRoot, true);
      await this.assertExactDirectory(sandboxRoot, false);
      return source;
    } catch (error) {
      if (!workspaceReady) {
        if (!pending.workspaceCreated) {
          this.pendingRoots.delete(sandboxRoot);
        } else {
          await this.cleanupFailedPrepare(pending);
        }
        throw error;
      }
      if (!pending.created) {
        await this.cleanupFailedPrepare(pending);
        invalidRoot("remote-worker sandbox root could not be prepared", error);
      }
      await this.cleanupFailedPrepare(pending);
      invalidRoot("remote-worker sandbox root could not be prepared", error);
    }
  }
  retryPendingCleanup(): Promise<number> {
    return this.withOwnershipLock(
      async () =>
        await this.withStableError(
          async () => await this.retryPendingCleanupOnce(),
          REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
          "remote-worker sandbox root cleanup is incomplete",
        ),
    );
  }

  private async retryPendingCleanupOnce(): Promise<number> {
    let cleaned = 0;
    let firstFailure: unknown;
    for (const pending of [...this.pendingRoots.values()]) {
      if (!pending.retainedForCleanup) continue;
      try {
        await this.cleanupPendingRoot(pending);
        cleaned += 1;
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (firstFailure) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker sandbox root cleanup is incomplete",
        firstFailure,
      );
    }
    return cleaned;
  }
  async close(): Promise<void> {
    await this.retryPendingCleanup();
  }
  dispose(source: TrustedWorkspaceMountSource): Promise<void> {
    return this.withOwnershipLock(
      async () =>
        await this.withStableError(
          async () => await this.disposeOnce(source),
          REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
          "remote-worker sandbox root cleanup is incomplete",
        ),
    );
  }

  private async disposeOnce(source: TrustedWorkspaceMountSource): Promise<void> {
    const sandboxRoot = this.assertOwnedSource(source);
    const workspaceRoot = dirname(sandboxRoot);
    const workspace = workspaceRoot.slice(this.sandboxRoot.length + 1);
    const pending = this.pendingRoots.get(sandboxRoot) ?? {
      workspace,
      workspaceRoot,
      sandboxRoot,
      workspaceCreated: true,
      created: true,
      retainedForCleanup: true,
    };
    pending.retainedForCleanup = true;
    this.pendingRoots.set(sandboxRoot, pending);
    try {
      await this.cleanupPendingRoot(pending);
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker sandbox root cleanup is incomplete",
        error,
      );
    }
  }
  startupSweep(): Promise<number> {
    return this.withOwnershipLock(
      async () =>
        await this.withStableError(
          async () => await this.startupSweepOnce(),
          REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
          "remote-worker startup root cleanup failed",
        ),
    );
  }

  private async startupSweepOnce(): Promise<number> {
    this.startupReady = false;
    const retried = await this.retryPendingCleanupOnce();
    await this.assertTrustedRoot();
    let discovered = 0;
    let cleaned = 0;
    const entries = await opendir(this.sandboxRoot);
    for await (const workspace of entries) {
      if (workspace.name === RUNSC_QUOTA_LOCK_NAME) {
        await this.assertQuotaMetadata(join(this.sandboxRoot, workspace.name));
        continue;
      }
      if (++discovered > RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers) {
        invalidRoot("remote-worker startup root cleanup exceeds its bound");
      }
      if (workspace.isSymbolicLink() || !workspace.isDirectory()) {
        invalidRoot("remote-worker sandbox root contains an unowned entry");
      }
      validateCanonicalQuotaWorkspaceId(workspace.name);
      const workspaceRoot = join(this.sandboxRoot, workspace.name);
      await this.assertExactDirectory(workspaceRoot, true);
      const roots: TrustedWorkspaceMountSource[] = [];
      let overflow = false;
      const sandboxes = await opendir(workspaceRoot);
      for await (const sandbox of sandboxes) {
        if (++discovered > RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers) {
          overflow = true;
          break;
        }
        if (sandbox.isSymbolicLink() || !sandbox.isDirectory()) {
          invalidRoot("remote-worker sandbox root contains an unowned entry");
        }
        normalizedSandboxId(sandbox.name);
        roots.push(
          trustedSandboxMountSource(
            this.sandboxRoot,
            workspace.name,
            sandbox.name,
          ),
        );
      }
      for (const root of roots) {
        await this.disposeOnce(root);
        cleaned += 1;
      }
      if (roots.length === 0) await rmdir(workspaceRoot);
      if (overflow) {
        invalidRoot("remote-worker startup root cleanup exceeds its bound");
      }
    }
    this.startupReady = true;
    return retried + cleaned;
  }
  private async cleanupFailedPrepare(pending: PendingRoot): Promise<void> {
    try {
      await this.cleanupPendingRoot(pending);
    } catch (cleanupError) {
      pending.retainedForCleanup = true;
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker sandbox root cleanup is incomplete",
        cleanupError,
      );
    }
  }

  private async cleanupPendingRoot(pending: PendingRoot): Promise<void> {
    await this.assertTrustedRoot();
    try {
      await this.assertExactDirectory(pending.workspaceRoot, true);
    } catch (error) {
      if (!errorCode(error, "ENOENT")) throw error;
      this.readyWorkspaces.delete(pending.workspace);
      this.pendingRoots.delete(pending.sandboxRoot);
      return;
    }
    if (pending.created)
      try {
        await this.assertExactDirectory(pending.sandboxRoot, false);
        await this.removeSandboxRoot(pending.sandboxRoot);
      } catch (error) {
        if (!errorCode(error, "ENOENT")) throw error;
      }
    await this.removeEmptyWorkspace(pending.workspace, pending.workspaceRoot);
    this.pendingRoots.delete(pending.sandboxRoot);
  }
  private async removeSandboxRoot(path: string): Promise<void> {
    if (this.options.removeSandboxRoot)
      await this.options.removeSandboxRoot(path);
    else await rm(path, { recursive: true, force: true });
  }
  private async ensureWorkspace(
    workspace: string,
    workspaceRoot: string,
    quota: QuotaManager,
    pending: PendingRoot,
  ): Promise<void> {
    if (!this.readyWorkspaces.has(workspace)) {
      let created = false;
      try {
        await mkdir(workspaceRoot, { mode: 0o750 });
        created = true;
        pending.workspaceCreated = true;
      } catch (error) {
        if (!errorCode(error, "EEXIST")) throw error;
      }
      await this.assertExactDirectory(workspaceRoot, true);
      if (created) await quota.apply(workspace);
      else await quota.check(workspace);
      this.readyWorkspaces.add(workspace);
      return;
    }
    await this.assertExactDirectory(workspaceRoot, true);
    await quota.check(workspace);
  }
  private async removeEmptyWorkspace(
    workspace: string,
    workspaceRoot: string,
  ): Promise<void> {
    try {
      if (this.options.removeWorkspaceRoot)
        await this.options.removeWorkspaceRoot(workspaceRoot);
      else await rmdir(workspaceRoot);
      this.readyWorkspaces.delete(workspace);
    } catch (error) {
      if (errorCode(error, "ENOENT")) this.readyWorkspaces.delete(workspace);
      else if (!errorCode(error, "ENOTEMPTY") && !errorCode(error, "EEXIST"))
        throw error;
    }
  }
  private async ensureStartupAdmission(): Promise<void> {
    if (this.startupReady) return;
    const entries = await opendir(this.sandboxRoot);
    for await (const entry of entries) {
      if (entry.name === RUNSC_QUOTA_LOCK_NAME) {
        await this.assertQuotaMetadata(join(this.sandboxRoot, entry.name));
        continue;
      }
      invalidRoot("remote-worker startup root cleanup is required");
    }
    this.startupReady = true;
  }

  private withOwnershipLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.ownershipOperation.then(operation, operation);
    this.ownershipOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async withStableError<T>(
    operation: () => Promise<T>,
    code: Parameters<typeof runscRuntimeError>[0],
    message: string,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SandboxProviderError) throw error;
      throw runscRuntimeError(code, message, error);
    }
  }

  private async assertTrustedRoot(): Promise<void> {
    try {
      const stat = await lstat(this.sandboxRoot, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("type");
      if (
        Number(stat.uid) !== this.trustedOwnerUid ||
        (Number(stat.mode) & 0o022) !== 0
      ) {
        throw new Error("ownership");
      }
      if ((await realpath(this.sandboxRoot)) !== this.sandboxRoot)
        throw new Error("canonical path");
      const identity = { dev: stat.dev, ino: stat.ino };
      if (
        this.trustedRootIdentity &&
        (this.trustedRootIdentity.dev !== identity.dev ||
          this.trustedRootIdentity.ino !== identity.ino)
      ) {
        throw new Error("root replaced");
      }
      this.trustedRootIdentity ??= identity;
      await this.assertTrustedAncestors();
    } catch (error) {
      invalidRoot(
        "remote-worker sandbox root is not a trusted directory",
        error,
      );
    }
  }
  private async assertTrustedAncestors(): Promise<void> {
    let current = dirname(this.sandboxRoot);
    while (true) {
      const stat = await lstat(current);
      const mode = stat.mode & 0o7777;
      const stickyRoot = stat.uid === 0 && (mode & 0o1000) !== 0;
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.uid !== 0 && stat.uid !== this.trustedOwnerUid) ||
        ((mode & 0o022) !== 0 && !stickyRoot)
      )
        throw new Error("untrusted ancestor");
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
  private async assertQuotaMetadata(path: string): Promise<void> {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== this.trustedOwnerUid ||
      (stat.mode & 0o077) !== 0 ||
      (await realpath(path)) !== path
    ) {
      invalidRoot("remote-worker quota metadata is not trusted");
    }
  }
  private async assertExactDirectory(
    path: string,
    trustedOwner: boolean,
  ): Promise<void> {
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (trustedOwner &&
        (stat.uid !== this.trustedOwnerUid || (stat.mode & 0o022) !== 0))
    ) {
      invalidRoot("remote-worker sandbox path is not a trusted directory");
    }
    if ((await realpath(path)) !== path)
      invalidRoot("remote-worker sandbox path escaped its trusted root");
  }
  private assertOwnedSource(source: TrustedWorkspaceMountSource): string {
    const path = resolve(String(source));
    const child = relative(this.sandboxRoot, path);
    const parts = child.split("/");
    if (
      child.startsWith("..") ||
      isAbsolute(child) ||
      parts.length !== 2 ||
      validateCanonicalQuotaWorkspaceId(parts[0] ?? "") !== parts[0] ||
      normalizedSandboxId(parts[1] ?? "") !== parts[1]
    ) {
      invalidRoot("remote-worker sandbox mount is outside its trusted root");
    }
    return path;
  }
}
