import { isAbsolute } from "node:path";

import { buildBwrapArgs, type BwrapArgsOptions } from "../providers/bwrap/buildBwrapArgs";
import { MOUNT_ERROR_CODES, MountLifecycleError } from "./mountLifecycle";
import type { MountHandle } from "./rcloneMount";

export interface BindableMountHandle extends MountHandle {
  readonly ready?: boolean;
  ensureReady?: () => Promise<void>;
}

export interface MountBindOptions {
  readonly?: boolean;
  forbiddenSubstrings?: readonly string[];
}

export interface MountBindSpec {
  source: string;
  target: string;
  readonly: boolean;
  args: string[];
}

const SANDBOX_ROOT = "/workspace";
const FORBIDDEN_BIND_ARG_SUBSTRINGS = ["/dev/fuse", "fusermount3"];
const HELPER_MASK_PATHS = [
  "/usr/bin/fusermount3",
  "/bin/fusermount3",
  "/usr/sbin/fusermount3",
  "/sbin/fusermount3",
  "/usr/bin/rclone",
  "/bin/rclone",
] as const;
const SAFE_DEV_PATHS = [
  "/dev/null",
  "/dev/zero",
  "/dev/full",
  "/dev/random",
  "/dev/urandom",
] as const;
const HOST_FUSE_MASK_ARGS = [
  "--tmpfs",
  "/dev",
  ...SAFE_DEV_PATHS.flatMap((path) => ["--dev-bind-try", path, path]),
  "--ro-bind-try",
  "/proc/self/fd",
  "/dev/fd",
  ...HELPER_MASK_PATHS.flatMap((path) => ["--ro-bind-try", "/dev/null", path]),
];

function validateSandboxPath(path: string): void {
  if (!isAbsolute(path)) {
    throw new MountLifecycleError("sandbox mount path must be absolute", MOUNT_ERROR_CODES.pathOutsidePrefix);
  }
  if (path.includes("\0") || path.includes("\n") || path.includes("\r")) {
    throw new MountLifecycleError("sandbox mount path contains an invalid character", MOUNT_ERROR_CODES.pathOutsidePrefix);
  }
  if (!path.startsWith(`${SANDBOX_ROOT}/`) && path !== SANDBOX_ROOT) {
    throw new MountLifecycleError("sandbox mount path must stay under /workspace", MOUNT_ERROR_CODES.pathOutsidePrefix);
  }
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new MountLifecycleError("sandbox mount path must not contain traversal segments", MOUNT_ERROR_CODES.pathOutsidePrefix);
  }
}

function assertNoForbiddenArgs(
  args: readonly string[],
  extraForbidden: readonly string[] = [],
  allowedArgs: readonly string[] = [],
): void {
  for (const token of [...FORBIDDEN_BIND_ARG_SUBSTRINGS, ...extraForbidden]) {
    if (token && args.some((arg) => arg.includes(token) && !allowedArgs.includes(arg))) {
      throw new MountLifecycleError("sandbox bind args contain a forbidden token", MOUNT_ERROR_CODES.unsupportedMountMode);
    }
  }
}

function assertNoCallerDevMounts(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dev" || arg === "--dev-bind" || arg === "--dev-bind-try") {
      throw new MountLifecycleError("sandbox bind args contain a forbidden token", MOUNT_ERROR_CODES.unsupportedMountMode);
    }
    if ((arg === "--bind" || arg === "--ro-bind" || arg === "--bind-try" || arg === "--ro-bind-try")
      && (args[index + 1] === "/dev" || args[index + 2] === "/dev")) {
      throw new MountLifecycleError("sandbox bind args contain a forbidden token", MOUNT_ERROR_CODES.unsupportedMountMode);
    }
  }
}

export async function bindMountIntoSandbox(
  mount: BindableMountHandle,
  sandboxPath: string,
  options: MountBindOptions = {},
): Promise<MountBindSpec> {
  await mount.ensureReady?.();
  if (mount.ready !== true) {
    throw new MountLifecycleError("mount must pass readiness before bwrap binding", MOUNT_ERROR_CODES.unavailable);
  }

  validateSandboxPath(sandboxPath);
  const readonly = mount.readonly || options.readonly === true;
  const args = [readonly ? "--ro-bind" : "--bind", mount.mountpoint, sandboxPath];
  assertNoForbiddenArgs(args, options.forbiddenSubstrings);

  return {
    source: mount.mountpoint,
    target: sandboxPath,
    readonly,
    args,
  };
}

export async function buildBwrapArgsWithMount(
  workspaceRoot: string,
  mount: BindableMountHandle,
  sandboxPath: string,
  options: BwrapArgsOptions & MountBindOptions = {},
): Promise<string[]> {
  const callerArgs = [...(options.extraArgs ?? []), ...(options.postWorkspaceArgs ?? [])];
  assertNoForbiddenArgs(callerArgs, options.forbiddenSubstrings);
  assertNoCallerDevMounts(callerArgs);
  const bind = await bindMountIntoSandbox(mount, sandboxPath, options);
  const args = buildBwrapArgs(workspaceRoot, {
    ...options,
    extraArgs: [
      ...HOST_FUSE_MASK_ARGS,
      ...(options.extraArgs ?? []),
    ],
    postWorkspaceArgs: [
      ...(options.postWorkspaceArgs ?? []),
      ...bind.args,
    ],
  });
  assertNoForbiddenArgs(args, options.forbiddenSubstrings, HOST_FUSE_MASK_ARGS);
  return args;
}
