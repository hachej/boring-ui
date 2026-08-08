import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_MOUNT_ERROR_CODES,
  ENVIRONMENT_MOUNTS_FLAG,
  PROVIDER_CAPABILITIES,
  SandboxProviderError,
  assertNoEnvironmentMounts,
  isEnvironmentMountsEnabled,
  resolveContextMounts,
  type SandboxEnvironmentMountV1,
} from "../index";

const MOUNT: SandboxEnvironmentMountV1 = {
  sourceRoot: "/srv/knowledge",
  logicalPath: "/mnt/knowledge",
  access: "ro",
};

const FLAG_ON = { [ENVIRONMENT_MOUNTS_FLAG]: "1" };
const FLAG_OFF = {};

describe("environment mounts flag", () => {
  it("is disabled unless BORING_ENV_MOUNTS=1", () => {
    expect(isEnvironmentMountsEnabled(FLAG_OFF)).toBe(false);
    expect(isEnvironmentMountsEnabled({ [ENVIRONMENT_MOUNTS_FLAG]: "true" })).toBe(false);
    expect(isEnvironmentMountsEnabled(FLAG_ON)).toBe(true);
  });

  it("resolves every mount set to empty when the flag is off", () => {
    expect(resolveContextMounts({ mounts: [MOUNT] }, FLAG_OFF)).toEqual([]);
    expect(resolveContextMounts({}, FLAG_OFF)).toEqual([]);
  });

  it("passes the context mount set through when the flag is on", () => {
    expect(resolveContextMounts({ mounts: [MOUNT] }, FLAG_ON)).toEqual([MOUNT]);
    expect(resolveContextMounts({}, FLAG_ON)).toEqual([]);
  });
});

describe("assertNoEnvironmentMounts (fail closed)", () => {
  it("rejects a non-empty effective mount set with a stable code", () => {
    try {
      assertNoEnvironmentMounts("direct", { mounts: [MOUNT] }, FLAG_ON);
      expect.unreachable("expected SandboxProviderError");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProviderError);
      expect((error as SandboxProviderError).code).toBe(
        ENVIRONMENT_MOUNT_ERROR_CODES.unsupported,
      );
      expect((error as SandboxProviderError).code).toBe(
        "SANDBOX_PROVIDER_MOUNTS_UNSUPPORTED",
      );
    }
  });

  it("accepts empty and flag-off mount sets", () => {
    expect(() => assertNoEnvironmentMounts("direct", {}, FLAG_ON)).not.toThrow();
    expect(() => assertNoEnvironmentMounts("direct", { mounts: [] }, FLAG_ON)).not.toThrow();
    expect(() => assertNoEnvironmentMounts("direct", { mounts: [MOUNT] }, FLAG_OFF)).not.toThrow();
  });
});

describe("mount capability matrix", () => {
  it("declares mounts only for bwrap in v1", () => {
    expect(PROVIDER_CAPABILITIES.bwrap.mounts).toBe(true);
    for (const [providerId, capabilities] of Object.entries(PROVIDER_CAPABILITIES)) {
      if (providerId === "bwrap") continue;
      expect(capabilities.mounts, providerId).toBe(false);
    }
  });
});
