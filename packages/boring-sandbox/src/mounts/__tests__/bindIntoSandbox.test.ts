import { describe, expect, it, vi } from "vitest";

import { bindMountIntoSandbox, buildBwrapArgsWithMount } from "../bindIntoSandbox";

function findTupleIndex(args: string[], tuple: string[]): number {
  for (let i = 0; i <= args.length - tuple.length; i += 1) {
    if (tuple.every((part, offset) => args[i + offset] === part)) return i;
  }
  return -1;
}

describe("host mount to bwrap bind", () => {
  it("binds a ready readonly mount with --ro-bind and exposes no fuse device, helper, or credential", async () => {
    const mount = {
      mountpoint: "/tmp/boring-rclone-mount",
      pid: 300,
      readonly: true,
      ready: true,
      ensureReady: vi.fn(async () => {}),
      unmount: vi.fn(async () => {}),
    };

    const bind = await bindMountIntoSandbox(mount, "/workspace/user", {
      forbiddenSubstrings: ["super-secret-value"],
    });
    const args = await buildBwrapArgsWithMount("/tmp/workspace", mount, "/workspace/user", {
      forbiddenSubstrings: ["super-secret-value"],
    });

    expect(bind.args).toEqual(["--ro-bind", "/tmp/boring-rclone-mount", "/workspace/user"]);
    expect(findTupleIndex(args, ["--ro-bind", "/tmp/boring-rclone-mount", "/workspace/user"])).toBeGreaterThanOrEqual(0);
    expect(findTupleIndex(args, ["--tmpfs", "/dev"])).toBeGreaterThanOrEqual(0);
    expect(findTupleIndex(args, ["--ro-bind-try", "/dev/null", "/usr/bin/fusermount3"])).toBeGreaterThanOrEqual(0);
    expect(findTupleIndex(args, ["--ro-bind-try", "/dev/null", "/usr/bin/rclone"])).toBeGreaterThanOrEqual(0);
    expect(args.join("\0")).not.toContain("/dev/fuse");
    expect(args.join("\0")).not.toContain("super-secret-value");
    expect(mount.ensureReady).toHaveBeenCalledTimes(2);
  });

  it("binds a ready readwrite mount with --bind", async () => {
    const bind = await bindMountIntoSandbox({
      mountpoint: "/tmp/boring-rclone-rw",
      pid: 301,
      readonly: false,
      ready: true,
      ensureReady: vi.fn(async () => {}),
      unmount: vi.fn(async () => {}),
    }, "/workspace/user");

    expect(bind.args).toEqual(["--bind", "/tmp/boring-rclone-rw", "/workspace/user"]);
  });

  it("does not allow a readonly mount handle to be downgraded to a writable bind", async () => {
    const bind = await bindMountIntoSandbox({
      mountpoint: "/tmp/boring-rclone-ro",
      pid: 305,
      readonly: true,
      ready: true,
      ensureReady: vi.fn(async () => {}),
      unmount: vi.fn(async () => {}),
    }, "/workspace/user", { readonly: false });

    expect(bind.args).toEqual(["--ro-bind", "/tmp/boring-rclone-ro", "/workspace/user"]);
  });

  it("can force a readwrite source to be bound read-only", async () => {
    const bind = await bindMountIntoSandbox({
      mountpoint: "/tmp/boring-rclone-rw-as-ro",
      pid: 306,
      readonly: false,
      ready: true,
      ensureReady: vi.fn(async () => {}),
      unmount: vi.fn(async () => {}),
    }, "/workspace/user", { readonly: true });

    expect(bind.args).toEqual(["--ro-bind", "/tmp/boring-rclone-rw-as-ro", "/workspace/user"]);
  });

  it("refuses to bind until the lifecycle readiness gate has marked the mount ready", async () => {
    const ensureReady = vi.fn(async () => {});

    await expect(bindMountIntoSandbox({
      mountpoint: "/tmp/boring-rclone-slow",
      pid: 302,
      readonly: true,
      ready: false,
      ensureReady,
      unmount: vi.fn(async () => {}),
    }, "/workspace/user")).rejects.toMatchObject({ code: "mount-unavailable" });
    expect(ensureReady).toHaveBeenCalledTimes(1);
  });

  it("does not echo forbidden credential substrings in guard errors", async () => {
    const secret = "super-secret-value";

    await expect(bindMountIntoSandbox({
      mountpoint: `/tmp/${secret}/mount`,
      pid: 303,
      readonly: true,
      ready: true,
      ensureReady: vi.fn(async () => {}),
      unmount: vi.fn(async () => {}),
    }, "/workspace/user", { forbiddenSubstrings: [secret] }))
      .rejects.toThrow("sandbox bind args contain a forbidden token");

    await expect(bindMountIntoSandbox({
      mountpoint: `/tmp/${secret}/mount`,
      pid: 304,
      readonly: true,
      ready: true,
      ensureReady: vi.fn(async () => {}),
      unmount: vi.fn(async () => {}),
    }, "/workspace/user", { forbiddenSubstrings: [secret] }))
      .rejects.not.toThrow(secret);
  });

  it("rejects forbidden tokens from caller-supplied final bwrap args", async () => {
    const mount = {
      mountpoint: "/tmp/boring-rclone-mount",
      pid: 307,
      readonly: true,
      ready: true,
      ensureReady: vi.fn(async () => {}),
      unmount: vi.fn(async () => {}),
    };

    await expect(buildBwrapArgsWithMount("/tmp/workspace", mount, "/workspace/user", {
      extraArgs: ["--ro-bind", "/dev/fuse", "/dev/fuse"],
    })).rejects.toMatchObject({ code: "unsupported-mount-mode" });

    await expect(buildBwrapArgsWithMount("/tmp/workspace", mount, "/workspace/user", {
      postWorkspaceArgs: ["--setenv", "TOKEN", "super-secret-value"],
      forbiddenSubstrings: ["super-secret-value"],
    })).rejects.toMatchObject({ code: "unsupported-mount-mode" });

    await expect(buildBwrapArgsWithMount("/tmp/workspace", mount, "/workspace/user", {
      extraArgs: ["--dev", "/dev"],
    })).rejects.toMatchObject({ code: "unsupported-mount-mode" });
  });
});
