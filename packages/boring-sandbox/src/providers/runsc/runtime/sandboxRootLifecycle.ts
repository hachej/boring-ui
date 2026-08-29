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
  validateQuotaWorkspaceId,
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
    const workspace = validateQuotaWorkspaceId(workspaceId);
    const sandbox = normalizedSandboxId(sandboxId);
    if (quota.workspaceRoot !== this.sandboxRoot) {
      invalidRoot("remote-worker quota and sandbox roots do not match");
    }
    await this.assertTrustedRoot();
    const workspaceRoot = join(this.sandboxRoot, workspace);
    const workspaceCreated = await this.ensureWorkspace(workspace, workspaceRoot, quota);
    const sandboxRoot = join(workspaceRoot, sandbox);
    let sandboxCreated = false;
    try {
      await mkdir(sandboxRoot, { mode: 0o770 });
      sandboxCreated = true;
      if (this.options.prepareOwnership) {
        await this.options.prepareOwnership(sandboxRoot);
      } else {
        await chown(sandboxRoot, 65_532, 65_532);
      }
      await this.assertTrustedRoot();
      await this.assertExactDirectory(workspaceRoot, true);
      await this.assertExactDirectory(sandboxRoot, false);
      return trustedSandboxMountSource(this.sandboxRoot, workspace, sandbox);
    } catch (error) {
      if (sandboxCreated) {
        await rm(sandboxRoot, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      if (workspaceCreated) await this.removeEmptyWorkspace(workspace, workspaceRoot);
      invalidRoot("remote-worker sandbox root could not be prepared", error);
    }
  }

  async dispose(source: TrustedWorkspaceMountSource): Promise<void> {
    const sandboxRoot = this.assertOwnedSource(source);
    const workspaceRoot = dirname(sandboxRoot);
    const workspace = workspaceRoot.slice(this.sandboxRoot.length + 1);
    try {
      await this.assertTrustedRoot();
      await this.assertExactDirectory(workspaceRoot, true);
      await this.assertExactDirectory(sandboxRoot, false);
      await rm(sandboxRoot, { recursive: true, force: true });
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
      validateQuotaWorkspaceId(workspace.name);
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
    return roots.length;
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
      validateQuotaWorkspaceId(parts[0] ?? "") !== parts[0] ||
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
}
