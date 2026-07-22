import { describe, expect, test } from "vitest";

import {
  RUNSC_RUNTIME_HELPER_PATH,
  buildDockerExecArgv,
  buildDockerRunArgv,
  trustedWorkspaceMountSource,
} from "../dockerArgv";

const runtimeId = "a".repeat(32);
const image = `registry.example/boring-workload@sha256:${"b".repeat(64)}`;

describe("typed Docker argv construction", () => {
  test("emits the exact fixed V3 run profile without a shell fragment", () => {
    expect(
      buildDockerRunArgv({
        runtimeId,
        workspaceMountSource: trustedWorkspaceMountSource(
          "/srv/boring/workspaces",
          "00000000-0000-4000-8000-000000000001",
        ),
        image,
      }),
    ).toEqual([
      "run",
      "-d",
      "--name",
      `boring-sbx-${runtimeId}`,
      "--runtime=runsc",
      "--user",
      "65532:65532",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--cpus",
      "0.5",
      "--memory",
      "128m",
      "--pids-limit",
      "64",
      "--network",
      "none",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=16m",
      "--ulimit",
      "nofile=1024:1024",
      "--ulimit",
      "fsize=1073741824:1073741824",
      "--mount",
      "type=bind,src=/srv/boring/workspaces/00000000-0000-4000-8000-000000000001,dst=/workspace,readonly=false",
      "--label",
      "com.hachej.boring.runsc-runtime=true",
      "--label",
      "com.hachej.boring.runsc-profile=v1",
      image,
      RUNSC_RUNTIME_HELPER_PATH,
      "supervise",
    ]);
  });

  test.each([
    "a;--privileged",
    "$(touch-pwned)",
    "A".repeat(32),
    "../tenant",
  ])("rejects a tenant-shaped runtime id: %s", (untrusted) => {
    expect(() =>
      buildDockerRunArgv({
        runtimeId: untrusted,
        workspaceMountSource: trustedWorkspaceMountSource(
          "/srv/boring/workspaces",
          "00000000-0000-4000-8000-000000000001",
        ),
        image,
      }),
    ).toThrow();
  });

  test.each([
    "/srv/workspaces,readonly",
    "relative/workspaces",
    "/srv/workspaces\n--privileged",
    "/srv/../private",
  ])("rejects an unsafe configured workspace root: %s", (root) => {
    expect(() =>
      trustedWorkspaceMountSource(
        root,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).toThrow();
  });

  test("rejects a tenant-shaped workspace id before building a mount source", () => {
    expect(() =>
      trustedWorkspaceMountSource(
        "/srv/boring/workspaces",
        "../../private,readonly",
      ),
    ).toThrow();
  });

  test("puts no tenant command or env in docker exec argv", () => {
    const argv = buildDockerExecArgv(runtimeId, "invoke");
    expect(argv).toEqual([
      "exec",
      "--interactive",
      "--user",
      "65532:65532",
      `boring-sbx-${runtimeId}`,
      RUNSC_RUNTIME_HELPER_PATH,
      "invoke",
    ]);
    expect(argv).not.toContain("--env");
  });
});
