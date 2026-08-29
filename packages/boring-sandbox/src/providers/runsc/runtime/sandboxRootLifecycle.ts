import {
  chown,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  rmdir,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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

export interface RunscSandboxRootLifecycleOptionsV1 {
  readonly sandboxRoot: string;
  readonly prepareOwnership?: (path: string) => void | Promise<void>;
  readonly removeSandboxRoot?: (path: string) => void | Promise<void>;
  /** Test/development roots may be owned by the daemon uid; production defaults to root. */
  readonly trustedOwnerUid?: number;
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

export class RunscSandboxRootLifecycleV1 {
  readonly sandboxRoot: string;
  private readonly trustedOwnerUid: number;
  private trustedRootIdentity?: RootIdentity;
  private readonly readyWorkspaces = new Set<string>();
  private readonly workspaceInflight = new Map<string, Promise<void>>();
  private readonly pendingRoots = new Map<
    string,
    {
      readonly workspace: string;
      readonly workspaceRoot: string;
      readonly sandboxRoot: string;
      workspaceCreated: boolean;
      created: boolean;
    }
  >();

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
    if (!Number.isSafeInteger(this.trustedOwnerUid) || this.trustedOwnerUid < 0) {
      invalidRoot("remote-worker sandbox root owner is invalid");
    }
  }

  async prepare(
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
    const workspaceRoot = join(this.sandboxRoot, workspace);
    const sandboxRoot = join(workspaceRoot, sandbox);
    const source = trustedSandboxMountSource(this.sandboxRoot, workspace, sandbox);
    if (
      this.pendingRoots.has(sandboxRoot) ||
      this.pendingRoots.size >= RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers
    ) {
      invalidRoot("remote-worker sandbox root cleanup capacity is exhausted");
    }
    const pending = {
      workspace,
      workspaceRoot,
      sandboxRoot,
      workspaceCreated: false,
      created: false,
    };
    this.pendingRoots.set(sandboxRoot, pending);
    let workspaceReady = false;
    try {
      pending.workspaceCreated = await this.ensureWorkspace(
        workspace,
        workspaceRoot,
        quota,
      );
      workspaceReady = true;
      await mkdir(sandboxRoot, { mode: 0o770 });
      pending.created = true;
      if (this.options.prepareOwnership) {
        await this.options.prepareOwnership(sandboxRoot);
      } else {
        await chown(sandboxRoot, 65_532, 65_532);
      }
      await this.assertTrustedRoot();
      await this.assertExactDirectory(workspaceRoot, true);
      await this.assertExactDirectory(sandboxRoot, false);
      this.pendingRoots.delete(sandboxRoot);
      return source;
    } catch (error) {
      if (!workspaceReady) {
        this.pendingRoots.delete(sandboxRoot);
        throw error;
      }
      if (!pending.created) {
        this.pendingRoots.delete(sandboxRoot);
        if (pending.workspaceCreated) {
          await this.removeEmptyWorkspace(workspace, workspaceRoot);
        }
        invalidRoot("remote-worker sandbox root could not be prepared", error);
      }
      try {
        await this.cleanupPendingRoot(pending);
      } catch (cleanupError) {
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
          "remote-worker sandbox root cleanup is incomplete",
          cleanupError,
        );
      }
      invalidRoot("remote-worker sandbox root could not be prepared", error);
    }
  }

  async retryPendingCleanup(): Promise<number> {
    let cleaned = 0;
    let firstFailure: unknown;
    for (const pending of [...this.pendingRoots.values()]) {
      if (!pending.created) continue;
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

  async dispose(source: TrustedWorkspaceMountSource): Promise<void> {
    const sandboxRoot = this.assertOwnedSource(source);
    const workspaceRoot = dirname(sandboxRoot);
    const workspace = workspaceRoot.slice(this.sandboxRoot.length + 1);
    try {
      await this.assertTrustedRoot();
      await this.assertExactDirectory(workspaceRoot, true);
      await this.assertExactDirectory(sandboxRoot, false);
      await this.removeSandboxRoot(sandboxRoot);
      await this.assertTrustedRoot();
      try {
        await rmdir(workspaceRoot);
        this.readyWorkspaces.delete(workspace);
      } catch {
        // A sibling sandbox or quota-owned workspace still exists.
      }
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker sandbox root cleanup is incomplete",
        error,
      );
    }
  }

  async startupSweep(): Promise<number> {
    const retried = await this.retryPendingCleanup();
    await this.assertTrustedRoot();
    const entries = await readdir(this.sandboxRoot, { withFileTypes: true });
    let discovered = 0;
    const roots: TrustedWorkspaceMountSource[] = [];
    for (const workspace of entries) {
      discovered += 1;
      if (discovered > RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers) {
        invalidRoot("remote-worker startup root cleanup exceeds its bound");
      }
      if (workspace.name === RUNSC_QUOTA_LOCK_NAME) {
        await this.assertQuotaMetadata(join(this.sandboxRoot, workspace.name));
        continue;
      }
      if (workspace.isSymbolicLink() || !workspace.isDirectory()) {
        invalidRoot("remote-worker sandbox root contains an unowned entry");
      }
      validateCanonicalQuotaWorkspaceId(workspace.name);
      const workspaceRoot = join(this.sandboxRoot, workspace.name);
      await this.assertExactDirectory(workspaceRoot, true);
      const sandboxes = await readdir(workspaceRoot, { withFileTypes: true });
      for (const sandbox of sandboxes) {
        discovered += 1;
        if (
          discovered > RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers ||
          sandbox.isSymbolicLink() ||
          !sandbox.isDirectory()
        ) {
          invalidRoot("remote-worker startup root cleanup exceeds its bound");
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
      if (sandboxes.length === 0) {
        await rmdir(workspaceRoot);
      }
    }
    for (const root of roots) await this.dispose(root);
    return retried + roots.length;
  }

  private async cleanupPendingRoot(
    pending: {
      readonly workspace: string;
      readonly workspaceRoot: string;
      readonly sandboxRoot: string;
      readonly workspaceCreated: boolean;
    },
  ): Promise<void> {
    await this.assertTrustedRoot();
    await this.assertExactDirectory(pending.workspaceRoot, true);
    try {
      await this.assertExactDirectory(pending.sandboxRoot, false);
      await this.removeSandboxRoot(pending.sandboxRoot);
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    this.pendingRoots.delete(pending.sandboxRoot);
    if (pending.workspaceCreated) {
      await this.removeEmptyWorkspace(pending.workspace, pending.workspaceRoot);
    }
  }

  private async removeSandboxRoot(path: string): Promise<void> {
    if (this.options.removeSandboxRoot) {
      await this.options.removeSandboxRoot(path);
      return;
    }
    await rm(path, { recursive: true, force: true });
  }

  private async ensureWorkspace(
    workspace: string,
    workspaceRoot: string,
    quota: QuotaManager,
  ): Promise<boolean> {
    const existing = this.workspaceInflight.get(workspace);
    if (existing) {
      await existing;
      await quota.check(workspace);
      return false;
    }
    let created = false;
    const operation = (async () => {
      if (!this.readyWorkspaces.has(workspace)) {
        try {
          await mkdir(workspaceRoot, { mode: 0o750 });
          created = true;
        } catch (error) {
          if (!this.isAlreadyExists(error)) throw error;
        }
        await this.assertExactDirectory(workspaceRoot, true);
        if (created) await quota.apply(workspace);
        else await quota.check(workspace);
        this.readyWorkspaces.add(workspace);
      } else {
        await this.assertExactDirectory(workspaceRoot, true);
        await quota.check(workspace);
      }
    })();
    this.workspaceInflight.set(workspace, operation);
    try {
      await operation;
      return created;
    } catch (error) {
      if (created) await this.removeEmptyWorkspace(workspace, workspaceRoot);
      throw error;
    } finally {
      this.workspaceInflight.delete(workspace);
    }
  }

  private async removeEmptyWorkspace(
    workspace: string,
    workspaceRoot: string,
  ): Promise<void> {
    try {
      await rmdir(workspaceRoot);
      this.readyWorkspaces.delete(workspace);
    } catch {
      // A concurrent sibling owns the workspace parent.
    }
  }

  private async assertTrustedRoot(): Promise<void> {
    try {
      const stat = await lstat(this.sandboxRoot, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("type");
      if (Number(stat.uid) !== this.trustedOwnerUid || (Number(stat.mode) & 0o022) !== 0) {
        throw new Error("ownership");
      }
      if ((await realpath(this.sandboxRoot)) !== this.sandboxRoot) {
        throw new Error("canonical path");
      }
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
      invalidRoot("remote-worker sandbox root is not a trusted directory", error);
    }
  }

  private async assertTrustedAncestors(): Promise<void> {
    let current = dirname(this.sandboxRoot);
    while (true) {
      const stat = await lstat(current);
      const mode = stat.mode & 0o7777;
      const stickyRootDirectory = stat.uid === 0 && (mode & 0o1000) !== 0;
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.uid !== 0 && stat.uid !== this.trustedOwnerUid) ||
        ((mode & 0o022) !== 0 && !stickyRootDirectory)
      ) {
        throw new Error("untrusted ancestor");
      }
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

  private async assertExactDirectory(path: string, trustedOwner: boolean): Promise<void> {
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (trustedOwner &&
        (stat.uid !== this.trustedOwnerUid || (stat.mode & 0o022) !== 0))
    ) {
      invalidRoot("remote-worker sandbox path is not a trusted directory");
    }
    if ((await realpath(path)) !== path) {
      invalidRoot("remote-worker sandbox path escaped its trusted root");
    }
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

  private isAlreadyExists(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST",
    );
  }

  private isNotFound(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT",
    );
  }
}
