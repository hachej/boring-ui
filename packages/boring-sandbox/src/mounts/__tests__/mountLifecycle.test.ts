import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { EU_S3_ENDPOINTS } from "../credentialBroker";
import {
  MountLifecycleManager,
  classifyMountSourceError,
  mountInfoContainsMountpoint,
  waitForMountReady,
} from "../mountLifecycle";
import type { MountLifecycleSessionSpec } from "../mountLifecycle";
import type { MountHandle, RcloneS3MountSpec } from "../rcloneMount";

function mountInfoLine(mountpoint: string): string {
  const encoded = mountpoint.replaceAll(" ", "\\040");
  return `36 25 0:35 / ${encoded} rw,relatime - fuse.rclone rclone rw`;
}

function createSpec(sessionId: string, ro = false, immutable = false, credentialId = "cred-default"): MountLifecycleSessionSpec {
  return {
    sessionId,
    bucket: "workspace-bucket",
    prefix: "workspaces/ws-1",
    creds: { id: credentialId } as never,
    ro,
    immutable,
    endpoint: EU_S3_ENDPOINTS.minio,
  };
}

function fakeStat() {
  return { isDirectory: () => true } as never;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("mount lifecycle manager", () => {
  it("blocks readiness until mountinfo and the stat/readdir probe both pass", async () => {
    let pid = 100;
    let activeMountpoint = "";
    let mountInfoReads = 0;
    let readdirReads = 0;
    const mount = vi.fn(async (spec: RcloneS3MountSpec): Promise<MountHandle> => {
      activeMountpoint = join(spec.cacheDir, "mount");
      return {
        mountpoint: activeMountpoint,
        pid: pid += 1,
        readonly: spec.ro,
        async unmount() {},
      };
    });
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-ready-"),
      mount,
      readMountInfo: async () => {
        mountInfoReads += 1;
        return mountInfoReads >= 2 ? mountInfoLine(activeMountpoint) : "";
      },
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => {
        readdirReads += 1;
        if (readdirReads === 1) {
          throw Object.assign(new Error("not yet readable"), { code: "ENOENT" });
        }
        return [] as never;
      }),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const handle = await manager.mountSession(createSpec("session-ready"));

    expect(handle.ready).toBe(true);
    expect(mountInfoReads).toBeGreaterThanOrEqual(2);
    expect(readdirReads).toBe(2);
  });

  it("lazy-unmounts through the handle and removes the per-session cache root", async () => {
    const unmount = vi.fn(async () => {});
    let mountedPath = "";
    const readyManager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-teardown-ready-"),
      mount: async (spec) => {
        mountedPath = join(spec.cacheDir, "mount");
        return {
          mountpoint: mountedPath,
          pid: 201,
          readonly: spec.ro,
          unmount,
        };
      },
      readMountInfo: async () => mountInfoLine(mountedPath),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const handle = await readyManager.mountSession(createSpec("session-teardown"));
    await readyManager.teardownSession("session-teardown");

    expect(unmount).toHaveBeenCalledTimes(1);
    await expect(access(handle.cacheDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("classifies ENOTCONN and ESTALE as storage-gone and EIO as transient", () => {
    expect(classifyMountSourceError(Object.assign(new Error("gone"), { code: "ENOTCONN" }))).toBe("storage-gone");
    expect(classifyMountSourceError(Object.assign(new Error("stale"), { code: "ESTALE" }))).toBe("storage-gone");
    expect(classifyMountSourceError(Object.assign(new Error("io"), { code: "EIO" }))).toBe("transient");
  });

  it("refuses readiness when mountinfo and probes never agree", async () => {
    await expect(waitForMountReady("/tmp/not-ready", {
      readMountInfo: async () => "",
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      timeoutMs: 2,
    })).rejects.toMatchObject({ code: "mount-unavailable" });
  });

  it("bounds hung readiness probes by the readiness timeout", async () => {
    await expect(waitForMountReady("/tmp/hung-probe", {
      readMountInfo: async () => mountInfoLine("/tmp/hung-probe"),
      statPath: vi.fn(async () => new Promise<never>(() => {})),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      timeoutMs: 5,
    })).rejects.toMatchObject({ code: "mount-unavailable" });
  });

  it("remounts once on ENOTCONN and bounded-retries EIO", async () => {
    let mountCount = 0;
    let activeMountpoint = "";
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-retry-"),
      mount: async (spec) => {
        mountCount += 1;
        activeMountpoint = join(spec.cacheDir, "mount");
        const pid = mountCount;
        return {
          mountpoint: activeMountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            unmounts.push(pid);
          },
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
      eioRetries: 1,
    });

    await manager.mountSession(createSpec("session-retry"));
    let attempts = 0;
    const remountedPid = await manager.withMountedSource("session-retry", async (handle) => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("not connected"), { code: "ENOTCONN" });
      }
      return handle.pid;
    });

    expect(remountedPid).toBe(2);
    expect(unmounts).toEqual([1]);

    let eioAttempts = 0;
    await expect(manager.withMountedSource("session-retry", async () => {
      eioAttempts += 1;
      throw Object.assign(new Error("transient io"), { code: "EIO" });
    }, { retryTransient: true })).rejects.toMatchObject({ code: "EIO" });
    expect(eioAttempts).toBe(2);
  });

  it("does not retry EIO for generic operations unless transient retry is opted in", async () => {
    let activeMountpoint = "";
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-eio-no-retry-"),
      mount: async (spec) => {
        activeMountpoint = join(spec.cacheDir, "mount");
        return {
          mountpoint: activeMountpoint,
          pid: 1,
          readonly: spec.ro,
          async unmount() {},
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
      eioRetries: 2,
    });

    await manager.mountSession(createSpec("session-eio-no-retry"));
    let attempts = 0;
    await expect(manager.withMountedSource("session-eio-no-retry", async () => {
      attempts += 1;
      throw Object.assign(new Error("transient io"), { code: "EIO" });
    })).rejects.toMatchObject({ code: "EIO" });

    expect(attempts).toBe(1);
  });

  it("uses distinct processes/cache dirs per session and shares only immutable readonly mounts", async () => {
    let mountCount = 0;
    const mounted = new Set<string>();
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-isolation-"),
      mount: async (spec) => {
        mountCount += 1;
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        return {
          mountpoint,
          pid: mountCount,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(mountpoint);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const sessionA = await manager.mountSession(createSpec("session-a"));
    const sessionB = await manager.mountSession(createSpec("session-b"));
    const sharedA = await manager.mountSession(createSpec("shared-a", true, true));
    const sharedB = await manager.mountSession(createSpec("shared-b", true, true));

    expect(sessionA.pid).not.toBe(sessionB.pid);
    expect(sessionA.cacheDir).not.toBe(sessionB.cacheDir);
    expect(sharedA.pid).toBe(sharedB.pid);
    expect(sharedA.cacheDir).toBe(sharedB.cacheDir);
    expect(sharedA.sessionId).toBe("shared-a");
    expect(sharedB.sessionId).toBe("shared-b");
  });

  it("does not share immutable readonly mounts across different credential handles", async () => {
    let mountCount = 0;
    const mounted = new Set<string>();
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-credential-share-"),
      mount: async (spec) => {
        mountCount += 1;
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        return {
          mountpoint,
          pid: mountCount,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(mountpoint);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const sharedA = await manager.mountSession(createSpec("shared-a", true, true, "cred-a"));
    const sharedB = await manager.mountSession(createSpec("shared-b", true, true, "cred-b"));

    expect(sharedA.pid).not.toBe(sharedB.pid);
  });

  it("rejects duplicate session ids without leaking a second mount or shared ref", async () => {
    let mountCount = 0;
    const unmounts: number[] = [];
    let activeMountpoint = "";
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-duplicate-session-"),
      mount: async (spec) => {
        mountCount += 1;
        const pid = mountCount;
        activeMountpoint = join(spec.cacheDir, "mount");
        return {
          mountpoint: activeMountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            unmounts.push(pid);
          },
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    await manager.mountSession(createSpec("duplicate-session", true, true));
    await expect(manager.mountSession(createSpec("duplicate-session", true, true)))
      .rejects.toMatchObject({ code: "mount-unavailable" });
    await manager.teardownSession("duplicate-session");

    expect(mountCount).toBe(1);
    expect(unmounts).toEqual([1]);
  });

  it("reserves session ids while mount creation is in flight", async () => {
    const release = deferred<void>();
    let mountCount = 0;
    let activeMountpoint = "";
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-pending-session-"),
      mount: async (spec) => {
        mountCount += 1;
        activeMountpoint = join(spec.cacheDir, "mount");
        await release.promise;
        return {
          mountpoint: activeMountpoint,
          pid: mountCount,
          readonly: spec.ro,
          async unmount() {},
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const first = manager.mountSession(createSpec("pending-session"));
    await expect(manager.mountSession(createSpec("pending-session"))).rejects.toMatchObject({ code: "mount-unavailable" });
    release.resolve();
    await first;

    expect(mountCount).toBe(1);
  });

  it("snapshots the mount spec before awaits and uses the snapshot for remount", async () => {
    const release = deferred<void>();
    const mounted = new Set<string>();
    const mountedSpecs: RcloneS3MountSpec[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-spec-snapshot-"),
      mount: async (spec) => {
        mountedSpecs.push(spec);
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        if (mountedSpecs.length === 1) {
          await release.promise;
        }
        return {
          mountpoint,
          pid: mountedSpecs.length,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(mountpoint);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });
    const spec = createSpec("session-snapshot");

    const pending = manager.mountSession(spec);
    spec.bucket = "mutated-bucket";
    spec.prefix = "workspaces/mutated";
    spec.endpoint = EU_S3_ENDPOINTS.scaleway;
    release.resolve();
    await pending;

    expect(mountedSpecs[0]).toMatchObject({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      endpoint: EU_S3_ENDPOINTS.minio,
    });

    await manager.withMountedSource("session-snapshot", async () => {
      throw Object.assign(new Error("not connected"), { code: "ENOTCONN" });
    }).catch(() => undefined);

    expect(mountedSpecs[1]).toMatchObject({
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      endpoint: EU_S3_ENDPOINTS.minio,
    });
  });

  it("tears down a session requested while mount creation is pending", async () => {
    const release = deferred<void>();
    let activeMountpoint = "";
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-pending-teardown-"),
      mount: async (spec) => {
        activeMountpoint = join(spec.cacheDir, "mount");
        await release.promise;
        return {
          mountpoint: activeMountpoint,
          pid: 1,
          readonly: spec.ro,
          async unmount() {
            unmounts.push(1);
          },
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const pendingMount = manager.mountSession(createSpec("session-pending-teardown"));
    const pendingTeardown = manager.teardownSession("session-pending-teardown");
    release.resolve();

    await expect(pendingMount).rejects.toMatchObject({ code: "mount-unavailable" });
    await pendingTeardown;
    expect(unmounts).toEqual([1]);
    await expect(manager.withMountedSource("session-pending-teardown", async (handle) => handle.pid))
      .rejects.toMatchObject({ code: "mount-unavailable" });
  });

  it("joins concurrent immutable readonly mounts for the same shared key", async () => {
    const release = deferred<void>();
    let mountCount = 0;
    const mounted = new Set<string>();
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-pending-shared-"),
      mount: async (spec) => {
        mountCount += 1;
        const pid = mountCount;
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        await release.promise;
        return {
          mountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(mountpoint);
            unmounts.push(pid);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const first = manager.mountSession(createSpec("pending-shared-a", true, true, "same-cred"));
    const second = manager.mountSession(createSpec("pending-shared-b", true, true, "same-cred"));
    release.resolve();
    const [firstHandle, secondHandle] = await Promise.all([first, second]);
    await manager.teardownSession("pending-shared-a");
    await manager.teardownSession("pending-shared-b");

    expect(mountCount).toBe(1);
    expect(firstHandle.pid).toBe(secondHandle.pid);
    expect(firstHandle.sessionId).toBe("pending-shared-a");
    expect(secondHandle.sessionId).toBe("pending-shared-b");
    expect(unmounts).toEqual([1]);
  });

  it("does not cancel pending shared waiters when the initiating session is torn down", async () => {
    const release = deferred<void>();
    let mountCount = 0;
    const mounted = new Set<string>();
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-pending-shared-cancel-"),
      mount: async (spec) => {
        mountCount += 1;
        const pid = mountCount;
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        await release.promise;
        return {
          mountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(mountpoint);
            unmounts.push(pid);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const first = manager.mountSession(createSpec("pending-shared-cancel-a", true, true, "same-cred"));
    const second = manager.mountSession(createSpec("pending-shared-cancel-b", true, true, "same-cred"));
    const teardownFirst = manager.teardownSession("pending-shared-cancel-a");
    release.resolve();

    await expect(first).rejects.toMatchObject({ code: "mount-unavailable" });
    const secondHandle = await second;
    await teardownFirst;
    expect(secondHandle.pid).toBe(1);
    expect(unmounts).toEqual([]);
    await manager.teardownSession("pending-shared-cancel-b");
    expect(unmounts).toEqual([1]);
  });

  it("tears down an already-resolved shared attach when teardown happens in the same tick", async () => {
    let mountCount = 0;
    const mounted = new Set<string>();
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-existing-shared-teardown-"),
      mount: async (spec) => {
        mountCount += 1;
        const pid = mountCount;
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        return {
          mountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(mountpoint);
            unmounts.push(pid);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    await manager.mountSession(createSpec("shared-existing-a", true, true, "same-cred"));
    const second = manager.mountSession(createSpec("shared-existing-b", true, true, "same-cred"));
    await manager.teardownSession("shared-existing-b");
    await second.catch(() => undefined);
    await expect(manager.withMountedSource("shared-existing-b", async (handle) => handle.pid))
      .rejects.toMatchObject({ code: "mount-unavailable" });
    expect(unmounts).toEqual([]);
    await manager.teardownSession("shared-existing-a");
    expect(unmounts).toEqual([1]);
  });

  it("tears down a pending shared mount when all pending sessions are canceled", async () => {
    const release = deferred<void>();
    let mountCount = 0;
    const mounted = new Set<string>();
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-pending-shared-cancel-all-"),
      mount: async (spec) => {
        mountCount += 1;
        const pid = mountCount;
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        if (pid === 1) {
          await release.promise;
        }
        return {
          mountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(mountpoint);
            unmounts.push(pid);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const first = manager.mountSession(createSpec("pending-shared-cancel-all-a", true, true, "same-cred"));
    const second = manager.mountSession(createSpec("pending-shared-cancel-all-b", true, true, "same-cred"));
    const teardownFirst = manager.teardownSession("pending-shared-cancel-all-a");
    const teardownSecond = manager.teardownSession("pending-shared-cancel-all-b");
    release.resolve();

    await expect(first).rejects.toMatchObject({ code: "mount-unavailable" });
    await expect(second).rejects.toMatchObject({ code: "mount-unavailable" });
    await Promise.all([teardownFirst, teardownSecond]);
    expect(unmounts).toEqual([1]);

    const replacement = await manager.mountSession(createSpec("pending-shared-cancel-all-c", true, true, "same-cred"));
    expect(replacement.pid).toBe(2);
  });

  it("does not attach new sessions to a shared mount while its last ref is tearing down", async () => {
    const releaseUnmount = deferred<void>();
    let mountCount = 0;
    const mounted = new Set<string>();
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-shared-teardown-"),
      mount: async (spec) => {
        mountCount += 1;
        const pid = mountCount;
        const mountpoint = join(spec.cacheDir, "mount");
        mounted.add(mountpoint);
        return {
          mountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            unmounts.push(pid);
            if (pid === 1) {
              await releaseUnmount.promise;
            }
            mounted.delete(mountpoint);
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    const first = await manager.mountSession(createSpec("shared-teardown-a", true, true, "same-cred"));
    const pendingTeardown = manager.teardownSession("shared-teardown-a");
    const second = await manager.mountSession(createSpec("shared-teardown-b", true, true, "same-cred"));
    releaseUnmount.resolve();
    await pendingTeardown;

    expect(first.pid).toBe(1);
    expect(second.pid).toBe(2);
    expect(unmounts).toEqual([1]);
  });

  it("clears session state when stale remount fails", async () => {
    let mountCount = 0;
    let activeMountpoint = "";
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-remount-fail-"),
      mount: async (spec) => {
        mountCount += 1;
        if (mountCount === 2) {
          throw Object.assign(new Error("rclone missing"), { code: "ENOENT" });
        }
        activeMountpoint = join(spec.cacheDir, "mount");
        return {
          mountpoint: activeMountpoint,
          pid: mountCount,
          readonly: spec.ro,
          async unmount() {},
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    await manager.mountSession(createSpec("session-remount-fail"));
    await expect(manager.withMountedSource("session-remount-fail", async () => {
      throw Object.assign(new Error("not connected"), { code: "ENOTCONN" });
    })).rejects.toMatchObject({ code: "mount-unavailable" });
    await expect(manager.withMountedSource("session-remount-fail", async () => "unused"))
      .rejects.toMatchObject({ code: "mount-unavailable" });
  });

  it("does not resurrect a session torn down during stale remount recovery", async () => {
    const oldUnmounted = deferred<void>();
    const releaseReplacement = deferred<void>();
    let mountCount = 0;
    let activeMountpoint = "";
    const mounted = new Set<string>();
    const unmounts: number[] = [];
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-remount-teardown-"),
      mount: async (spec) => {
        mountCount += 1;
        const pid = mountCount;
        activeMountpoint = join(spec.cacheDir, "mount");
        mounted.add(activeMountpoint);
        if (pid === 2) {
          await releaseReplacement.promise;
        }
        return {
          mountpoint: activeMountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            mounted.delete(activeMountpoint);
            unmounts.push(pid);
            if (pid === 1) {
              oldUnmounted.resolve();
            }
          },
        };
      },
      readMountInfo: async () => Array.from(mounted).map(mountInfoLine).join("\n"),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    await manager.mountSession(createSpec("session-remount-teardown"));
    const remounting = manager.withMountedSource("session-remount-teardown", async () => {
      throw Object.assign(new Error("not connected"), { code: "ENOTCONN" });
    });
    await oldUnmounted.promise;
    await manager.teardownSession("session-remount-teardown");
    releaseReplacement.resolve();

    await expect(remounting).rejects.toMatchObject({ code: "mount-unavailable" });
    await expect(manager.withMountedSource("session-remount-teardown", async (handle) => handle.pid))
      .rejects.toMatchObject({ code: "mount-unavailable" });
    expect(unmounts).toEqual([1]);
  });

  it("removes the lifecycle root when mount creation fails before a handle exists", async () => {
    const removePath = vi.fn(async () => {});
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-create-fail-"),
      mount: async () => {
        throw Object.assign(new Error("missing rclone"), { code: "ENOENT" });
      },
      removePath,
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    await expect(manager.mountSession(createSpec("session-create-fail")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(removePath).toHaveBeenCalledWith(
      expect.stringContaining("boring-sandbox-lifecycle-create-fail-"),
      { recursive: true, force: true },
    );
  });

  it("leaves the lifecycle root for a safe janitor when unmount fails", async () => {
    const removePath = vi.fn(async () => {});
    let unmountAttempts = 0;
    let activeMountpoint = "";
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-unmount-fail-"),
      mount: async (spec) => {
        activeMountpoint = join(spec.cacheDir, "mount");
        return {
          mountpoint: activeMountpoint,
          pid: 1,
          readonly: spec.ro,
          async unmount() {
            unmountAttempts += 1;
            if (unmountAttempts === 1) {
              throw new Error("failed to lazy-unmount");
            }
          },
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      removePath,
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    await manager.mountSession(createSpec("session-unmount-fail"));
    await expect(manager.teardownSession("session-unmount-fail")).rejects.toThrow("failed to lazy-unmount");
    expect(removePath).not.toHaveBeenCalled();
    await expect(manager.mountSession(createSpec("session-unmount-fail")))
      .rejects.toMatchObject({ code: "mount-unavailable" });
    await expect(manager.withMountedSource("session-unmount-fail", async (handle) => handle.pid))
      .resolves.toBe(1);
    await manager.teardownSession("session-unmount-fail");
    expect(removePath).toHaveBeenCalledWith(
      expect.stringContaining("boring-sandbox-lifecycle-unmount-fail-"),
      { recursive: true, force: true },
    );
  });

  it("clears session state after writeback failure while preserving the cache root", async () => {
    const removePath = vi.fn(async () => {});
    let mountCount = 0;
    let activeMountpoint = "";
    const manager = new MountLifecycleManager({
      baseDir: join(tmpdir(), "boring-sandbox-lifecycle-writeback-fail-"),
      mount: async (spec) => {
        mountCount += 1;
        activeMountpoint = join(spec.cacheDir, "mount");
        const pid = mountCount;
        return {
          mountpoint: activeMountpoint,
          pid,
          readonly: spec.ro,
          async unmount() {
            if (pid === 1) {
              throw Object.assign(new Error("writeback did not drain"), { code: "writeback-failed" });
            }
          },
        };
      },
      readMountInfo: async () => mountInfoLine(activeMountpoint),
      statPath: vi.fn(async () => fakeStat()),
      readdirPath: vi.fn(async () => [] as never),
      removePath,
      pollIntervalMs: 1,
      readinessTimeoutMs: 100,
    });

    await manager.mountSession(createSpec("session-writeback-fail"));
    await expect(manager.teardownSession("session-writeback-fail"))
      .rejects.toMatchObject({ code: "writeback-failed" });
    expect(removePath).not.toHaveBeenCalled();
    await expect(manager.withMountedSource("session-writeback-fail", async (handle) => handle.pid))
      .rejects.toMatchObject({ code: "mount-unavailable" });

    const replacement = await manager.mountSession(createSpec("session-writeback-fail"));
    expect(replacement.pid).toBe(2);
  });

  it("parses escaped mountinfo mountpoints", () => {
    expect(mountInfoContainsMountpoint(mountInfoLine("/tmp/path with spaces/mount"), "/tmp/path with spaces/mount")).toBe(true);
  });
});
