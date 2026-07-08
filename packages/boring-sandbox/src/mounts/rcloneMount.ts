import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  normalizeMountPrefix,
  prepareMountCredentialEnv,
  validateMountBucket,
  type MountCredentialHandle,
  type MountEndpoint,
} from "./credentialBroker";

export interface MountHandle {
  readonly mountpoint: string;
  readonly pid: number;
  readonly readonly: boolean;
  readonly ready?: boolean;
  unmount(): Promise<void>;
}

export interface RcloneS3MountSpec {
  bucket: string;
  prefix: string;
  creds: MountCredentialHandle;
  ro: boolean;
  cacheDir: string;
  endpoint: MountEndpoint;
}

export interface RcloneMountPaths {
  mountpoint: string;
  vfsCacheDir: string;
}

export interface RcloneMountSpawn {
  (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): ChildProcess;
}

export interface MountRcloneS3Options {
  binary?: string;
  spawn?: RcloneMountSpawn;
  env?: NodeJS.ProcessEnv;
  unmountGraceMs?: number;
}

const RCLONE_TIMEOUT = "30s";
const RCLONE_RETRIES = "3";
const RCLONE_LOW_LEVEL_RETRIES = "3";
const UNMOUNT_GRACE_MS = 5000;
const MOUNT_ENV_ALLOWLIST = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
] as const;

export class RcloneMountError extends Error {
  readonly code: "mount-unavailable" | "writeback-failed";
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown, code: "mount-unavailable" | "writeback-failed" = "mount-unavailable") {
    super(message);
    this.name = "RcloneMountError";
    this.code = code;
    this.cause = cause;
  }
}

function defaultMountProcessEnv(): NodeJS.ProcessEnv {
  return process.env.PATH ? { PATH: process.env.PATH } : {};
}

function allowedMountProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {};
  for (const key of MOUNT_ENV_ALLOWLIST) {
    if (env[key]) allowed[key] = env[key];
  }
  return allowed;
}

export function buildRcloneS3Remote(bucket: string, prefix: string): string {
  validateMountBucket(bucket);
  const normalizedPrefix = normalizeMountPrefix(prefix);
  return `:s3:${bucket}/${normalizedPrefix}`;
}

function rcloneS3Provider(endpoint: MountEndpoint): string {
  if (endpoint.provider === "AWS" || endpoint.provider === "Scaleway") return endpoint.provider;
  return "Other";
}

function assertCredentialScopeMatchesSpec(spec: RcloneS3MountSpec): void {
  const requestedPrefix = normalizeMountPrefix(spec.prefix);
  const requestedAccessMode = spec.ro ? "read-only" : "readwrite";
  const endpointMatches = spec.endpoint.provider === spec.creds.endpoint.provider
    && spec.endpoint.url === spec.creds.endpoint.url
    && (spec.endpoint.region ?? "") === (spec.creds.endpoint.region ?? "");
  if (
    spec.bucket !== spec.creds.bucket
    || requestedPrefix !== spec.creds.prefix
    || !endpointMatches
    || spec.creds.accessMode !== requestedAccessMode
  ) {
    throw new RcloneMountError("rclone mount scope must match the credential handle scope");
  }
}

export function buildRcloneMountArgs(spec: RcloneS3MountSpec, paths: RcloneMountPaths): string[] {
  const args = [
    "mount",
    buildRcloneS3Remote(spec.bucket, spec.prefix),
    paths.mountpoint,
    "--s3-env-auth",
    "--s3-provider",
    rcloneS3Provider(spec.endpoint),
    "--s3-endpoint",
    spec.endpoint.url,
    "--s3-no-check-bucket",
    "--vfs-cache-mode",
    "full",
    "--vfs-cache-dir",
    paths.vfsCacheDir,
    "--timeout",
    RCLONE_TIMEOUT,
    "--retries",
    RCLONE_RETRIES,
    "--low-level-retries",
    RCLONE_LOW_LEVEL_RETRIES,
    "--dir-cache-time",
    "30s",
    "--poll-interval",
    "0",
  ];

  if (spec.endpoint.region) {
    args.push("--s3-region", spec.endpoint.region);
  }

  if (spec.ro) {
    args.push("--read-only");
  }

  return args;
}

async function waitForProcessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

async function waitForCleanProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const exited = await Promise.race([
    waitForProcessExit(child).then(() => true),
    delay(timeoutMs).then(() => false),
  ]);

  return exited && child.exitCode === 0 && child.signalCode === null;
}

async function runUnmountCommand(
  spawnImpl: RcloneMountSpawn,
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<boolean> {
  const child = spawnImpl(command, args, { env, stdio: "ignore" });
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.once("error", () => settle(false));
    child.once("exit", (code) => settle(code === 0));
    delay(timeoutMs).then(() => {
      if (!settled) {
        child.kill("SIGKILL");
        settle(false);
      }
    });
  });
}

export async function lazyUnmountMountpoint(
  mountpoint: string,
  options: { spawn?: RcloneMountSpawn; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<void> {
  const spawnImpl = options.spawn ?? spawn;
  const env = allowedMountProcessEnv(options.env ?? defaultMountProcessEnv());
  const timeoutMs = options.timeoutMs ?? UNMOUNT_GRACE_MS;
  const fusermountOk = await runUnmountCommand(spawnImpl, "fusermount3", ["-uz", mountpoint], env, timeoutMs);
  if (fusermountOk) return;

  const umountOk = await runUnmountCommand(spawnImpl, "umount", ["-l", mountpoint], env, timeoutMs);
  if (!umountOk) {
    throw new RcloneMountError(`failed to lazy-unmount ${mountpoint}`);
  }
}

export async function reapMountProcess(child: ChildProcess, timeoutMs = UNMOUNT_GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const exited = await Promise.race([
    waitForProcessExit(child).then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
  if (exited) return;

  child.kill("SIGKILL");
  await Promise.race([
    waitForProcessExit(child),
    delay(timeoutMs),
  ]);
}

export async function mountRcloneS3(
  spec: RcloneS3MountSpec,
  options: MountRcloneS3Options = {},
): Promise<MountHandle> {
  const spawnImpl = options.spawn ?? spawn;
  const binary = options.binary ?? "rclone";
  const mountpoint = join(spec.cacheDir, "mount");
  const vfsCacheDir = join(spec.cacheDir, "vfs");
  const credentialProcessDir = join(spec.cacheDir, "credentials");
  const unmountGraceMs = options.unmountGraceMs ?? UNMOUNT_GRACE_MS;
  let child: ChildProcess | undefined;
  let createdMountpoint = false;
  let createdVfsCacheDir = false;
  let createdCredentialProcessDir = false;

  async function removeCredentialProcessDir(): Promise<void> {
    if (createdCredentialProcessDir) {
      await rm(credentialProcessDir, { recursive: true, force: true });
      createdCredentialProcessDir = false;
    }
  }

  async function removeCreatedChildren(): Promise<void> {
    await removeCredentialProcessDir();
    if (createdVfsCacheDir) {
      await rm(vfsCacheDir, { recursive: true, force: true });
      createdVfsCacheDir = false;
    }
    if (createdMountpoint) {
      await rm(mountpoint, { recursive: true, force: true });
      createdMountpoint = false;
    }
  }

  try {
    assertCredentialScopeMatchesSpec(spec);
    await mkdir(spec.cacheDir, { recursive: true, mode: 0o700 });
    await chmod(spec.cacheDir, 0o700);
    await mkdir(mountpoint, { mode: 0o700 });
    createdMountpoint = true;
    await mkdir(vfsCacheDir, { mode: 0o700 });
    createdVfsCacheDir = true;
    await mkdir(credentialProcessDir, { mode: 0o700 });
    createdCredentialProcessDir = true;

    const credentialEnv = await prepareMountCredentialEnv(spec.creds, {
      credentialProcessDir,
      requireCredentialProcess: true,
    });
    const args = buildRcloneMountArgs(spec, { mountpoint, vfsCacheDir });
    let spawnError: unknown;
    child = spawnImpl(binary, args, {
      env: {
        ...allowedMountProcessEnv(options.env ?? defaultMountProcessEnv()),
        ...credentialEnv,
      },
      stdio: "ignore",
    });
    child.once("error", (error) => {
      spawnError = error;
    });

    if (typeof child.pid !== "number") {
      throw new RcloneMountError("rclone mount process did not expose a pid", spawnError);
    }

    return {
      mountpoint,
      pid: child.pid,
      readonly: spec.ro,
      async unmount() {
        let unmountError: unknown;
        let removeCache = false;
        let reaped = false;
        try {
          await lazyUnmountMountpoint(mountpoint, { spawn: spawnImpl, env: options.env, timeoutMs: unmountGraceMs });
          if (spec.ro) {
            await reapMountProcess(child as ChildProcess, unmountGraceMs);
            reaped = true;
            removeCache = true;
          } else if (await waitForCleanProcessExit(child as ChildProcess, unmountGraceMs)) {
            removeCache = true;
          } else {
            await reapMountProcess(child as ChildProcess, unmountGraceMs);
            reaped = true;
            throw new RcloneMountError(
              "rclone writeback did not drain before teardown; preserving VFS cache",
              undefined,
              "writeback-failed",
            );
          }
        } catch (error) {
          unmountError = error;
        } finally {
          if (!reaped) {
            await reapMountProcess(child as ChildProcess, unmountGraceMs);
          }
          await removeCredentialProcessDir();
          if (removeCache) {
            await removeCreatedChildren();
          }
        }
        if (unmountError) throw unmountError;
      },
    };
  } catch (error) {
    await removeCreatedChildren();
    throw error;
  }
}
