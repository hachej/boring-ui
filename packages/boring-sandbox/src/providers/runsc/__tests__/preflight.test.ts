import { describe, expect, it, vi } from "vitest";

import {
  preflightRunsc,
  RUNSC_PREFLIGHT_ERROR_CODES,
  RUNSC_REQUIRED_BLOCKED_CIDRS,
  validateRunscPreflightConfig,
  type RunscHostCommand,
  type RunscHostCommandResult,
  type RunscPreflightConfig,
} from "../index";

const IMAGE_DIGEST = `sha256:${"a".repeat(64)}` as const;
const MAX_OUTPUT_BYTES = 256 * 1024;

describe("runsc trusted host preflight", () => {
  it("reports bounded structural observations while security readiness stays unproven", async () => {
    const commands: RunscHostCommand[] = [];
    const runner = {
      run: vi.fn(async (command: RunscHostCommand): Promise<RunscHostCommandResult> => {
        commands.push(command);
        return resultFor(command);
      }),
    };

    const result = await preflightRunsc(makeConfig(), runner);

    expect(result).toEqual({
      status: "observed",
      provider: "runsc",
      productionReady: false,
      observations: {
        runscVersionOutputValid: true,
        digestMarkerMatchesExpected: true,
        namespaceCommandSucceeded: true,
        nftTableReadable: true,
        configuredCidrTextPresent: true,
        cgroupControllersPresent: ["cpu", "memory", "pids"],
        configuredLimitFilesMatchExpected: true,
      },
      unproven: {
        systrapWorkload: "unknown",
        imageDigestBinding: "unknown",
        effectiveUid: "unknown",
        effectiveGid: "unknown",
        cgroupMembership: "unknown",
        resourceEnforcement: "unknown",
        networkIsolation: "unknown",
        metadataEgressDenied: "unknown",
        privateNetworkEgressDenied: "unknown",
        hostNetworkEgressDenied: "unknown",
        crossWorkspaceEgressDenied: "unknown",
        nftDropRulesEffective: "unknown",
        ociBundleUsed: "unknown",
        containerConfigurationUsed: "unknown",
        rootPathSafety: "unknown",
        hostRunnerEnforcement: "unknown",
      },
    });
    expect(commands).toEqual([
      command("/usr/local/bin/runsc", ["--version"]),
      command("/usr/bin/cat", ["/srv/boring/runsc/bundles/ws-a/image.digest"]),
      command("/usr/sbin/ip", ["netns", "exec", "ws-a", "/usr/bin/true"]),
      command("/usr/sbin/nft", ["list", "table", "inet", "boring_ws_a"]),
      command("/usr/bin/cat", ["/sys/fs/cgroup/cgroup.controllers"]),
      command("/usr/bin/cat", ["/sys/fs/cgroup/boring/ws-a/cpu.max"]),
      command("/usr/bin/cat", ["/sys/fs/cgroup/boring/ws-a/memory.max"]),
      command("/usr/bin/cat", ["/sys/fs/cgroup/boring/ws-a/pids.max"]),
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("/srv/");
    expect(serialized).not.toContain("/sys/");
    expect(serialized).not.toContain(IMAGE_DIGEST);
    expect(serialized).not.toContain("release-20260701.0");
    expect(serialized.toLowerCase()).not.toContain("token");
    expect(serialized.toLowerCase()).not.toContain("secret");
  });

  const invalidConfigs: Array<[string, (config: RunscPreflightConfig) => void]> = [
    [
      "unsafe namespace id",
      (config) => {
        config.networkNamespace = "../escape";
      },
    ],
    ["unpinned image", (config) => {
      config.expected.imageDigest = "sha256:short" as `sha256:${string}`;
    }],
    [
      "root escape",
      (config) => {
        config.digestMarkerPath = "/outside/image.digest";
      },
    ],
    [
      "cgroup root escape",
      (config) => {
        config.workspaceCgroupRoot = "/outside/cgroup";
      },
    ],
    [
      "small memory limit",
      (config) => {
        config.expected.memoryBytes = 1024;
      },
    ],
    [
      "missing CIDR",
      (config) => {
        config.requiredBlockedCidrs = ["10.0.0.0/8"];
      },
    ],
    [
      "empty CIDR prefix",
      (config) => {
        config.requiredBlockedCidrs.push("203.0.113.0/");
      },
    ],
    [
      "whitespace CIDR prefix",
      (config) => {
        config.requiredBlockedCidrs.push("203.0.113.0/ ");
      },
    ],
    [
      "hex CIDR prefix",
      (config) => {
        config.requiredBlockedCidrs.push("203.0.113.0/0x10");
      },
    ],
    [
      "exponent CIDR prefix",
      (config) => {
        config.requiredBlockedCidrs.push("203.0.113.0/1e1");
      },
    ],
  ];

  it.each(invalidConfigs)("rejects invalid config: %s", (_name, mutate) => {
    const config = makeConfig();
    mutate(config);
    expect(() => validateRunscPreflightConfig(config)).toThrowError(
      expect.objectContaining({ code: RUNSC_PREFLIGHT_ERROR_CODES.invalidConfig }),
    );
  });

  it("accepts decimal IPv4 and IPv6 prefix boundaries", () => {
    const boundaries = [
      "0.0.0.0/0",
      "255.255.255.255/32",
      "::/0",
      "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128",
    ];
    const config = makeConfig();
    config.requiredBlockedCidrs.push(...boundaries);

    expect(validateRunscPreflightConfig(config).requiredBlockedCidrs).toEqual(
      expect.arrayContaining(boundaries),
    );
  });

  it.each([
    null,
    {},
    { ...makeConfig(), binaries: null },
    { ...makeConfig(), requiredBlockedCidrs: "10.0.0.0/8" },
    { ...makeConfig(), expected: { ...makeConfig().expected, pidsMax: "512" } },
  ])("rejects malformed runtime config with the stable invalid-config code", (input) => {
    expect(() => validateRunscPreflightConfig(input)).toThrowError(
      expect.objectContaining({ code: RUNSC_PREFLIGHT_ERROR_CODES.invalidConfig }),
    );
  });

  it("fails when the configured digest marker differs", async () => {
    const runner = {
      run: async (command: RunscHostCommand) => command.args[0]?.endsWith("image.digest")
        ? { exitCode: 0, stdout: `sha256:${"b".repeat(64)}\n`, stderr: "" }
        : resultFor(command),
    };

    await expect(preflightRunsc(makeConfig(), runner)).resolves.toEqual({
      status: "failed",
      provider: "runsc",
      productionReady: false,
      error: {
        code: RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch,
        message: "digest marker does not match the configured image digest",
      },
    });
  });

  it("fails when expected nftables text or cgroup controller text is absent", async () => {
    const missingFirewall = {
      run: async (command: RunscHostCommand) => command.file.endsWith("nft")
        ? { exitCode: 0, stdout: "table inet boring_ws_a {}", stderr: "" }
        : resultFor(command),
    };
    const missingController = {
      run: async (command: RunscHostCommand) => command.args[0]?.endsWith("cgroup.controllers")
        ? { exitCode: 0, stdout: "cpu memory", stderr: "" }
        : resultFor(command),
    };

    await expect(preflightRunsc(makeConfig(), missingFirewall)).resolves.toMatchObject({
      status: "failed",
      error: { code: RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch },
    });
    await expect(preflightRunsc(makeConfig(), missingController)).resolves.toMatchObject({
      status: "failed",
      error: { code: RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch },
    });
  });

  it("fails when configured cgroup limit files differ from expected values", async () => {
    const runner = {
      run: async (command: RunscHostCommand) => command.args[0]?.endsWith("memory.max")
        ? { exitCode: 0, stdout: "max\n", stderr: "" }
        : resultFor(command),
    };

    await expect(preflightRunsc(makeConfig(), runner)).resolves.toMatchObject({
      status: "failed",
      error: { code: RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch },
    });
  });

  it.each([
    null,
    { exitCode: "0", stdout: "", stderr: "" },
    { exitCode: 0, stdout: 1, stderr: "" },
    { exitCode: 0, stdout: "", stderr: "x".repeat(256 * 1024 + 1) },
  ])("rejects malformed or oversized runner output", async (output) => {
    const result = await preflightRunsc(makeConfig(), { run: async () => output });
    expect(result).toMatchObject({
      status: "failed",
      productionReady: false,
      error: { code: RUNSC_PREFLIGHT_ERROR_CODES.invalidOutput },
    });
  });

  it.each([
    [0, "observed"],
    [1, "failed"],
  ] as const)(
    "enforces one combined stdout and stderr budget at boundary +%i",
    async (extra, status) => {
      const stdout = "runsc version release-20260701.0\n";
      const stdoutBytes = new TextEncoder().encode(stdout).byteLength;
      const stderr = "x".repeat(MAX_OUTPUT_BYTES - stdoutBytes + extra);
      const result = await preflightRunsc(makeConfig(), {
        run: async (command) => command.args[0] === "--version"
          ? { exitCode: 0, stdout, stderr }
          : resultFor(command),
      });

      expect(result.status).toBe(status);
      if (status === "failed") {
        expect(result).toMatchObject({
          error: { code: RUNSC_PREFLIGHT_ERROR_CODES.invalidOutput },
        });
      }
    },
  );

  it("rejects unbounded version text without reflecting it", async () => {
    const result = await preflightRunsc(makeConfig(), {
      run: async (command) => command.args[0] === "--version"
        ? { exitCode: 0, stdout: "runsc version TOKEN=do-not-return extra\n", stderr: "" }
        : resultFor(command),
    });
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNSC_PREFLIGHT_ERROR_CODES.invalidOutput },
    });
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("redacts command errors and never returns runner output", async () => {
    const runner = {
      run: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "TOKEN=do-not-return /srv/boring/runsc/private",
      }),
    };

    const result = await preflightRunsc(makeConfig(), runner);
    expect(result).toEqual({
      status: "failed",
      provider: "runsc",
      productionReady: false,
      error: {
        code: RUNSC_PREFLIGHT_ERROR_CODES.commandFailed,
        message: "runsc version probe failed",
      },
    });
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(JSON.stringify(result)).not.toContain("/srv/");
  });
});

function makeConfig(): RunscPreflightConfig {
  return {
    stateRoot: "/srv/boring/runsc",
    digestMarkerPath: "/srv/boring/runsc/bundles/ws-a/image.digest",
    networkNamespace: "ws-a",
    nftTable: "boring_ws_a",
    requiredBlockedCidrs: [...RUNSC_REQUIRED_BLOCKED_CIDRS],
    cgroupRoot: "/sys/fs/cgroup",
    workspaceCgroupRoot: "/sys/fs/cgroup/boring/ws-a",
    binaries: {
      runsc: "/usr/local/bin/runsc",
      ip: "/usr/sbin/ip",
      nft: "/usr/sbin/nft",
      cat: "/usr/bin/cat",
      true: "/usr/bin/true",
    },
    expected: {
      imageDigest: IMAGE_DIGEST,
      cpuPeriodMicros: 100_000,
      cpuQuotaMicros: 100_000,
      memoryBytes: 1024 * 1024 * 1024,
      pidsMax: 512,
    },
  };
}

function command(file: string, args: readonly string[]): RunscHostCommand {
  return { file, args, timeoutMs: 10_000, maxOutputBytes: MAX_OUTPUT_BYTES };
}

function resultFor(command: RunscHostCommand): RunscHostCommandResult {
  if (command.args[0] === "--version") {
    return { exitCode: 0, stdout: "runsc version release-20260701.0\n", stderr: "" };
  }
  if (command.args[0]?.endsWith("image.digest")) {
    return { exitCode: 0, stdout: `${IMAGE_DIGEST}\n`, stderr: "" };
  }
  if (command.file.endsWith("nft")) {
    return { exitCode: 0, stdout: RUNSC_REQUIRED_BLOCKED_CIDRS.join(" "), stderr: "" };
  }
  if (command.args[0]?.endsWith("cgroup.controllers")) {
    return { exitCode: 0, stdout: "cpuset cpu io memory hugetlb pids", stderr: "" };
  }
  if (command.args[0]?.endsWith("cpu.max")) {
    return { exitCode: 0, stdout: "100000 100000\n", stderr: "" };
  }
  if (command.args[0]?.endsWith("memory.max")) {
    return { exitCode: 0, stdout: `${1024 * 1024 * 1024}\n`, stderr: "" };
  }
  if (command.args[0]?.endsWith("pids.max")) {
    return { exitCode: 0, stdout: "512\n", stderr: "" };
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}
