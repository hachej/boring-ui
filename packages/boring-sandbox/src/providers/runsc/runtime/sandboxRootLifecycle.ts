import { chown, lstat, mkdir, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";
import {
  trustedSandboxMountSource,
  type TrustedWorkspaceMountSource,
} from "./dockerArgv";
import { runscRuntimeError } from "./errors";
import { RUNSC_RUNTIME_LIMITS_V1 } from "./limits";
import { validateQuotaWorkspaceId } from "./quota";
const sandboxIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export interface RunscSandboxRootLifecycleOptionsV1 {
  readonly sandboxRoot: string;
  readonly prepareOwnership?: (path: string) => void | Promise<void>;
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
  }
  async prepare(
    workspaceId: string,
    sandboxId: string,
  ): Promise<TrustedWorkspaceMountSource> {
    const workspace = validateQuotaWorkspaceId(workspaceId);
    const sandbox = normalizedSandboxId(sandboxId);
    await this.assertTrustedRoot();
    const workspaceRoot = join(this.sandboxRoot, workspace);
    await mkdir(workspaceRoot, { recursive: true, mode: 0o750 });
    await this.assertExactDirectory(workspaceRoot);
    const sandboxRoot = join(workspaceRoot, sandbox);
    let created = false;
    try {
      await mkdir(sandboxRoot, { mode: 0o770 });
      created = true;
      if (this.options.prepareOwnership) {
        await this.options.prepareOwnership(sandboxRoot);
      } else {
        await chown(sandboxRoot, 65_532, 65_532);
      }
      await this.assertExactDirectory(sandboxRoot);
      return trustedSandboxMountSource(this.sandboxRoot, workspace, sandbox);
    } catch (error) {
      if (created) {
        await rm(sandboxRoot, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      invalidRoot("remote-worker sandbox root could not be prepared", error);
    }
  }
  async dispose(source: TrustedWorkspaceMountSource): Promise<void> {
    const sandboxRoot = this.assertOwnedSource(source);
    try {
      await rm(sandboxRoot, { recursive: true, force: true });
      await rmdir(resolve(sandboxRoot, "..")).catch(() => undefined);
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
    const workspaces = await readdir(this.sandboxRoot, { withFileTypes: true });
    let discovered = 0;
    const roots: string[] = [];
    for (const workspace of workspaces) {
      if (workspace.isSymbolicLink() || !workspace.isDirectory()) {
        invalidRoot("remote-worker sandbox root contains an unowned entry");
      }
      validateQuotaWorkspaceId(workspace.name);
      const workspaceRoot = join(this.sandboxRoot, workspace.name);
      await this.assertExactDirectory(workspaceRoot);
      for (const sandbox of await readdir(workspaceRoot, {
        withFileTypes: true,
      })) {
        discovered += 1;
        if (
          discovered > RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers ||
          sandbox.isSymbolicLink() ||
          !sandbox.isDirectory()
        ) {
          invalidRoot("remote-worker startup root cleanup exceeds its bound");
        }
        normalizedSandboxId(sandbox.name);
        roots.push(join(workspaceRoot, sandbox.name));
      }
    }
    for (const root of roots) {
      await this.dispose(root as TrustedWorkspaceMountSource);
    }
    return roots.length;
  }
  private async assertTrustedRoot(): Promise<void> {
    try {
      const stat = await lstat(this.sandboxRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("type");
      if ((await realpath(this.sandboxRoot)) !== this.sandboxRoot) {
        throw new Error("canonical path");
      }
    } catch (error) {
      invalidRoot("remote-worker sandbox root is not a trusted directory", error);
    }
  }
  private async assertExactDirectory(path: string): Promise<void> {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      invalidRoot("remote-worker sandbox path is not a directory");
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
}
