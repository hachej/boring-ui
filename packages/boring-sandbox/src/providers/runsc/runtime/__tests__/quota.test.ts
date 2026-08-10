import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import {
  RUNSC_QUOTA_HELPER_EXCEEDED_EXIT,
  RUNSC_WORKSPACE_QUOTA_PROFILE_V1,
  FixedProjectQuotaManagerV1,
  assertHostReserveWritable,
  requiredHostReserveBytes,
} from "../quota";

const workspaceId = "00000000-0000-4000-8000-000000000001";

describe("fixed project quota contract", () => {
  test("passes only validated workspace id and the fixed profile to the helper", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, timedOut: false }));
    await new FixedProjectQuotaManagerV1({ run }).apply(workspaceId.toUpperCase());
    expect(run).toHaveBeenCalledWith({
      argv: ["apply", workspaceId, RUNSC_WORKSPACE_QUOTA_PROFILE_V1.profileId],
      timeoutMs: 120_000,
    });
  });

  test.each(["../workspace", "/srv/workspace", "$(id)", "workspace-a"])(
    "rejects arbitrary path/shell input: %s",
    async (untrusted) => {
      const run = vi.fn();
      await expect(
        new FixedProjectQuotaManagerV1({ run }).apply(untrusted),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      });
      expect(run).not.toHaveBeenCalled();
    },
  );

  test("maps all quota exhaustion to one stable failure", async () => {
    await expect(
      new FixedProjectQuotaManagerV1({
        run: async () => ({
          exitCode: RUNSC_QUOTA_HELPER_EXCEEDED_EXIT,
          timedOut: false,
        }),
      }).check(workspaceId),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded,
    });
  });

  test("reserves the larger of ten percent and ten GiB", () => {
    expect(requiredHostReserveBytes(50 * 1024 ** 3)).toBe(10 * 1024 ** 3);
    expect(requiredHostReserveBytes(200 * 1024 ** 3)).toBe(20 * 1024 ** 3);
    expect(() =>
      assertHostReserveWritable({
        totalVolumeBytes: 50 * 1024 ** 3,
        freeVolumeBytes: 10 * 1024 ** 3,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded,
      }),
    );
  });
});
