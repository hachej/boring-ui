import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { access, chmod, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { EU_S3_ENDPOINTS, brokerMountCredentials } from "../credentialBroker";
import type { MountCredentialMintRequest } from "../credentialBroker";
import { buildRcloneMountArgs, lazyUnmountMountpoint, mountRcloneS3 } from "../rcloneMount";
import type { RcloneMountSpawn } from "../rcloneMount";

class FakeChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit("exit", code, signal);
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.exit(null, signal);
    return true;
  }
}

describe("rclone S3 mount", () => {
  it("builds concrete rclone mount argv with VFS full cache and tuned retry flags", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      accessMode: "read-only",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            sessionToken: "minio-session",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-argv",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-"));
    const calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }> = [];
    const spawnImpl: RcloneMountSpawn = (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return new FakeChild(4242) as never;
    };

    const handle = await mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: true,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl, env: { PATH: "/usr/bin" } });

    expect(handle).toMatchObject({
      mountpoint: join(cacheDir, "mount"),
      pid: 4242,
      readonly: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("rclone");
    expect(calls[0].args).toEqual(expect.arrayContaining([
      "mount",
      ":s3:workspace-bucket/workspaces/ws-1",
      join(cacheDir, "mount"),
      "--s3-env-auth",
      "--s3-no-check-bucket",
      "--vfs-cache-mode",
      "full",
      "--vfs-cache-dir",
      join(cacheDir, "vfs"),
      "--timeout",
      "30s",
      "--retries",
      "3",
      "--low-level-retries",
      "3",
      "--read-only",
    ]));
    expect(calls[0].env).toMatchObject({
      AWS_CONFIG_FILE: expect.stringContaining(join(cacheDir, "credentials")),
      AWS_PROFILE: "default",
      AWS_SDK_LOAD_CONFIG: "1",
    });
    expect(calls[0].env?.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(calls[0].env?.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(calls[0].env?.AWS_SESSION_TOKEN).toBeUndefined();
    expect(JSON.stringify(calls[0].args)).not.toContain("minio-secret-value");
  });

  it("locks down cache, mountpoint, VFS, and credential directories before spawning rclone", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-private-cache",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-private-"));
    await chmod(cacheDir, 0o755);
    const spawnImpl: RcloneMountSpawn = () => new FakeChild(4343) as never;

    await mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl });

    await expect(stat(cacheDir).then((result) => result.mode & 0o777)).resolves.toBe(0o700);
    await expect(stat(join(cacheDir, "mount")).then((result) => result.mode & 0o777)).resolves.toBe(0o700);
    await expect(stat(join(cacheDir, "vfs")).then((result) => result.mode & 0o777)).resolves.toBe(0o700);
    await expect(stat(join(cacheDir, "credentials")).then((result) => result.mode & 0o777)).resolves.toBe(0o700);
  });

  it("exposes the ./mounts package export without adding a generic driver registry", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../package.json"), "utf8"),
    );

    expect(packageJson.exports["./mounts"]).toEqual({
      types: "./dist/mounts/index.d.ts",
      import: "./dist/mounts/index.js",
    });
    const args = buildRcloneMountArgs({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds: {} as never,
      ro: false,
      cacheDir: "/tmp/cache",
      endpoint: EU_S3_ENDPOINTS.ovh,
    }, { mountpoint: "/tmp/mount", vfsCacheDir: "/tmp/cache/vfs" });
    expect(args).not.toContain("mountpoint-s3");
    expect(JSON.stringify(packageJson.exports)).not.toContain("MountDriver");
  });

  it("lazy-unmounts and reaps the rclone process on handle unmount", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.ovh,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      accessMode: "read-only",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "OVH_ACCESS",
            secretAccessKey: "ovh-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-unmount",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-unmount-"));
    const children: FakeChild[] = [];
    const calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }> = [];
    const spawnImpl: RcloneMountSpawn = (command, args, options) => {
      calls.push({ command, args, env: options.env });
      const child = new FakeChild(5000 + children.length);
      children.push(child);
      if (command === "fusermount3") {
        child.exit(0, null);
      }
      return child as never;
    };

    const handle = await mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: true,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.ovh,
    }, {
      spawn: spawnImpl,
      env: {
        PATH: "/usr/bin",
        HOME: "/home/host-user",
        AWS_SECRET_ACCESS_KEY: "ambient-secret",
      },
    });

    await handle.unmount();

    expect(calls[1]).toEqual({
      command: "fusermount3",
      args: ["-uz", join(cacheDir, "mount")],
      env: { PATH: "/usr/bin" },
    });
    expect(calls[1].env?.HOME).toBeUndefined();
    expect(calls[1].env?.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(children[0].signalCode).toBe("SIGTERM");
    await expect(access(cacheDir)).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "mount"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(cacheDir, "vfs"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(cacheDir, "credentials"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds a wedged fusermount helper and falls back to umount", async () => {
    const calls: string[] = [];
    const spawnImpl: RcloneMountSpawn = (command) => {
      calls.push(command);
      const child = new FakeChild(5500 + calls.length);
      if (command === "umount") {
        child.exit(0, null);
      }
      return child as never;
    };

    await expect(lazyUnmountMountpoint("/tmp/boring-rclone-timeout", {
      spawn: spawnImpl,
      env: { PATH: "/usr/bin" },
      timeoutMs: 1,
    })).resolves.toBeUndefined();
    expect(calls).toEqual(["fusermount3", "umount"]);
  });

  it("strips ambient AWS credentials when spawning a credential_process mount", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "SCOPED_ACCESS",
            secretAccessKey: "scoped-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-1",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-env-"));
    let spawnedEnv: NodeJS.ProcessEnv | undefined;
    const spawnImpl: RcloneMountSpawn = (_command, _args, options) => {
      spawnedEnv = options.env;
      return new FakeChild(7000) as never;
    };

    await mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, {
      spawn: spawnImpl,
      env: {
      PATH: "/usr/bin",
      HOME: "/home/host-user",
      AWS_ACCESS_KEY_ID: "BROAD_ACCESS",
      AWS_SECRET_ACCESS_KEY: "broad-secret-value",
      AWS_SESSION_TOKEN: "broad-session-token",
      AWS_SHARED_CREDENTIALS_FILE: "/home/host-user/.aws/credentials",
    },
    });

    expect(spawnedEnv).toMatchObject({
      PATH: "/usr/bin",
      AWS_CONFIG_FILE: expect.stringContaining(join(cacheDir, "credentials")),
      AWS_SHARED_CREDENTIALS_FILE: expect.stringContaining(join(cacheDir, "credentials")),
      AWS_PROFILE: "default",
      AWS_SDK_LOAD_CONFIG: "1",
      AWS_EC2_METADATA_DISABLED: "true",
    });
    expect(spawnedEnv?.HOME).toBeUndefined();
    expect(spawnedEnv?.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(spawnedEnv?.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(spawnedEnv?.AWS_SESSION_TOKEN).toBeUndefined();
    expect(JSON.stringify(spawnedEnv)).not.toContain("broad-secret-value");
  });

  it("still reaps and removes cache when lazy unmount fails", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-unmount-fail",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-unmount-fail-"));
    const children: FakeChild[] = [];
    const spawnImpl: RcloneMountSpawn = (command) => {
      const child = new FakeChild(6000 + children.length);
      children.push(child);
      if (command === "fusermount3" || command === "umount") {
        child.exit(1, null);
      }
      return child as never;
    };

    const handle = await mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl });

    await expect(handle.unmount()).rejects.toMatchObject({
      code: "mount-unavailable",
      message: expect.stringContaining("failed to lazy-unmount"),
    });
    expect(children[0].signalCode).toBe("SIGTERM");
    await expect(access(cacheDir)).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "mount"))).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "vfs"))).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "credentials"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves writable VFS cache when rclone writeback does not drain", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-writeback",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-writeback-"));
    const children: FakeChild[] = [];
    const spawnImpl: RcloneMountSpawn = (command) => {
      const child = new FakeChild(6100 + children.length);
      children.push(child);
      if (command === "fusermount3") {
        child.exit(0, null);
      }
      return child as never;
    };

    const handle = await mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl, unmountGraceMs: 1 });

    await expect(handle.unmount()).rejects.toMatchObject({ code: "writeback-failed" });
    expect(children[0].signalCode).toBe("SIGTERM");
    await expect(access(cacheDir)).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "mount"))).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "vfs"))).resolves.toBeUndefined();
  });

  it("attaches an error listener before reporting spawn failures", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-spawn-fail",
          };
        },
      },
    });
    const failedChild = new FakeChild(undefined);
    const spawnImpl: RcloneMountSpawn = () => failedChild as never;
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-spawn-fail-"));

    await expect(mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl })).rejects.toMatchObject({ code: "mount-unavailable" });

    expect(failedChild.listenerCount("error")).toBe(1);
    failedChild.emit("error", Object.assign(new Error("missing rclone"), { code: "ENOENT" }));
    await expect(access(cacheDir)).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "mount"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-refreshable short-lived credentials before spawning rclone", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-no-refresh-"));
    const spawnImpl: RcloneMountSpawn = () => {
      throw new Error("spawn should not be called");
    };

    await expect(mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl })).rejects.toThrow("credential_process refresh");
    await expect(access(cacheDir)).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "mount"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a rclone mount whose requested bucket or prefix differs from the credential scope", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-scope",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-scope-"));
    const spawnImpl: RcloneMountSpawn = () => {
      throw new Error("spawn should not be called");
    };

    await expect(mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-2",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl })).rejects.toThrow("credential handle scope");
    await expect(access(cacheDir)).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "mount"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a rclone mount whose endpoint differs from the credential scope", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-endpoint",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-endpoint-"));
    const spawnImpl: RcloneMountSpawn = () => {
      throw new Error("spawn should not be called");
    };

    await expect(mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: false,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.scaleway,
    }, { spawn: spawnImpl })).rejects.toThrow("credential handle scope");
    await expect(access(cacheDir)).resolves.toBeUndefined();
    await expect(access(join(cacheDir, "mount"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects read-only mounts backed by write-capable credentials", async () => {
    const creds = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      accessMode: "readwrite",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-access-mode",
          };
        },
      },
    });
    const cacheDir = await mkdtemp(join(tmpdir(), "boring-sandbox-rclone-access-mode-"));
    const spawnImpl: RcloneMountSpawn = () => {
      throw new Error("spawn should not be called");
    };

    await expect(mountRcloneS3({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      creds,
      ro: true,
      cacheDir,
      endpoint: EU_S3_ENDPOINTS.minio,
    }, { spawn: spawnImpl })).rejects.toThrow("credential handle scope");
    await expect(access(join(cacheDir, "mount"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
