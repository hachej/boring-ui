import { join } from "node:path";

import {
  RUNSC_PREFLIGHT_ERROR_CODES,
  RUNSC_UNPROVEN_SECURITY_FACTS,
  type RunscPreflightResult,
} from "../../shared/runsc";
import {
  validateRunscPreflightConfig,
  type RunscPreflightConfig,
} from "./config";
import { RunscPreflightError } from "./errors";

export interface RunscHostCommand {
  file: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RunscHostCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunscHostCommandRunner {
  run(command: RunscHostCommand): Promise<unknown>;
}

const PREFLIGHT_TIMEOUT_MS = 10_000;
const PREFLIGHT_MAX_OUTPUT_BYTES = 256 * 1024;

export async function preflightRunsc(
  input: unknown,
  runner: RunscHostCommandRunner,
): Promise<RunscPreflightResult> {
  try {
    const config = validateRunscPreflightConfig(input);

    const version = await runProbe(runner, "runsc version", config.binaries.runsc, ["--version"]);
    assertVersionOutput(version.stdout);
    const bundleDigest = await runProbe(runner, "digest marker", config.binaries.cat, [
      config.digestMarkerPath,
    ]);
    if (bundleDigest.stdout.trim() !== config.expected.imageDigest) {
      throw new RunscPreflightError(
        RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch,
        "digest marker does not match the configured image digest",
      );
    }

    await runProbe(runner, "network namespace", config.binaries.ip, [
      "netns",
      "exec",
      config.networkNamespace,
      config.binaries.true,
    ]);
    const nft = await runProbe(runner, "nftables table", config.binaries.nft, [
      "list",
      "table",
      "inet",
      config.nftTable,
    ]);
    for (const cidr of config.requiredBlockedCidrs) {
      if (!nft.stdout.includes(cidr)) {
        throw new RunscPreflightError(
          RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch,
          "nftables table output is missing configured CIDR text",
        );
      }
    }

    const controllers = await runProbe(runner, "cgroup v2 controllers", config.binaries.cat, [
      join(config.cgroupRoot, "cgroup.controllers"),
    ]);
    const controllerSet = new Set(controllers.stdout.trim().split(/\s+/));
    for (const controller of ["cpu", "memory", "pids"]) {
      if (!controllerSet.has(controller)) {
        throw new RunscPreflightError(
          RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch,
          `cgroup v2 controller ${controller} is unavailable`,
        );
      }
    }
    await verifyResourceLimits(config, runner);

    return {
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
      unproven: RUNSC_UNPROVEN_SECURITY_FACTS,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      status: "failed",
      provider: "runsc",
      productionReady: false,
      error: { code: normalized.code, message: normalized.message },
    };
  }
}

async function runProbe(
  runner: RunscHostCommandRunner,
  label: string,
  file: string,
  args: readonly string[],
): Promise<RunscHostCommandResult> {
  let raw: unknown;
  try {
    raw = await runner.run({
      file,
      args,
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
      maxOutputBytes: PREFLIGHT_MAX_OUTPUT_BYTES,
    });
  } catch {
    throw new RunscPreflightError(RUNSC_PREFLIGHT_ERROR_CODES.commandFailed, `${label} probe failed`);
  }
  const result = parseCommandResult(raw, label);
  if (result.exitCode !== 0) {
    throw new RunscPreflightError(RUNSC_PREFLIGHT_ERROR_CODES.commandFailed, `${label} probe failed`);
  }
  return result;
}

function assertVersionOutput(output: string): void {
  const line = output.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = /^runsc version\s+([a-z0-9][a-z0-9._+-]{0,127})$/i.exec(line);
  if (!match?.[1]) {
    throw new RunscPreflightError(
      RUNSC_PREFLIGHT_ERROR_CODES.invalidOutput,
      "runsc version output is invalid",
    );
  }
}

async function verifyResourceLimits(
  config: RunscPreflightConfig,
  runner: RunscHostCommandRunner,
): Promise<void> {
  const expected = config.expected;
  const cpu = await runProbe(runner, "cgroup CPU limit", config.binaries.cat, [
    join(config.workspaceCgroupRoot, "cpu.max"),
  ]);
  const memory = await runProbe(runner, "cgroup memory limit", config.binaries.cat, [
    join(config.workspaceCgroupRoot, "memory.max"),
  ]);
  const pids = await runProbe(runner, "cgroup pid limit", config.binaries.cat, [
    join(config.workspaceCgroupRoot, "pids.max"),
  ]);

  const [quota, period, extra] = cpu.stdout.trim().split(/\s+/);
  if (
    extra !== undefined ||
    quota !== String(expected.cpuQuotaMicros) ||
    period !== String(expected.cpuPeriodMicros)
  ) {
    mismatch("CPU");
  }
  if (memory.stdout.trim() !== String(expected.memoryBytes)) mismatch("memory");
  if (pids.stdout.trim() !== String(expected.pidsMax)) mismatch("pid");
}

function mismatch(resource: string): never {
  throw new RunscPreflightError(
    RUNSC_PREFLIGHT_ERROR_CODES.structuralMismatch,
    `cgroup ${resource} limit does not match the approved policy`,
  );
}

function parseCommandResult(value: unknown, label: string): RunscHostCommandResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidOutput(label);
  const result = value as Record<string, unknown>;
  if (
    !Number.isInteger(result.exitCode) ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string"
  ) {
    invalidOutput(label);
  }
  const stdoutBytes = outputBytes(result.stdout as string);
  const stderrBudget = PREFLIGHT_MAX_OUTPUT_BYTES - stdoutBytes;
  if (
    stdoutBytes > PREFLIGHT_MAX_OUTPUT_BYTES ||
    outputBytes(result.stderr as string) > stderrBudget
  ) {
    invalidOutput(label);
  }
  return {
    exitCode: result.exitCode as number,
    stdout: result.stdout as string,
    stderr: result.stderr as string,
  };
}

function outputBytes(value: string): number {
  if (value.length > PREFLIGHT_MAX_OUTPUT_BYTES) return value.length;
  return new TextEncoder().encode(value).byteLength;
}

function invalidOutput(label: string): never {
  throw new RunscPreflightError(
    RUNSC_PREFLIGHT_ERROR_CODES.invalidOutput,
    `${label} probe returned invalid output`,
  );
}

function normalizeError(error: unknown): RunscPreflightError {
  if (error instanceof RunscPreflightError) return error;
  return new RunscPreflightError(RUNSC_PREFLIGHT_ERROR_CODES.commandFailed, "runsc preflight failed");
}
