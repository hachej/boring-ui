import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { DockerCliCommandRunner, runDockerChecked } from "../dockerRunner";

describe("Docker command runner", () => {
  test("rejects malformed argv before spawning", async () => {
    const runner = new DockerCliCommandRunner();
    await expect(
      runner.run({ argv: ["run", "bad\0arg"], timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    });
  });

  test("maps runner failures without reflecting infrastructure stderr", async () => {
    const runner = {
      run: vi.fn(async () => ({
        exitCode: 1,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode("SECRET=/host/root/docker.sock"),
        timedOut: false,
        truncated: false,
      })),
    };
    const failure = await runDockerChecked(runner, {
      argv: ["inspect", "missing"],
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.dockerCommandFailed,
    });
    expect(String((failure as Error).message)).not.toMatch(
      /SECRET|\/host|docker\.sock/,
    );
  });

  test("sanitizes spawn causes before they leave the runtime", async () => {
    const failure = await runDockerChecked(
      {
        run: vi.fn(async () => {
          const error = Object.assign(new Error("spawn failed"), {
            code: "ENOENT",
            errno: -2,
            syscall: "spawn /usr/bin/docker",
            path: "/usr/bin/docker",
            spawnargs: ["--mount", "src=/host/private/workspace"],
          });
          throw error;
        }),
      },
      { argv: ["inspect", "missing"], timeoutMs: 1_000 },
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ cause: { code: "ENOENT", errno: -2 } });
    const serialized = JSON.stringify((failure as Error).cause);
    expect(serialized).toContain("ENOENT");
    expect(serialized).not.toMatch(/\/usr\/bin|\/host|--mount|spawnargs/);
  });
});
