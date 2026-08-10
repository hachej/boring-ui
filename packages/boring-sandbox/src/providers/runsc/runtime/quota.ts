import { spawn } from "node:child_process";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";

import { runscRuntimeError } from "./errors";
import { RUNSC_RUNTIME_LIMITS_V1 } from "./limits";

export const RUNSC_WORKSPACE_QUOTA_PROFILE_V1 = Object.freeze({
  profileId: "fixed-1gib-100k-v1",
  bytes: 1024 * 1024 * 1024,
  inodes: 100_000,
} as const);

export const RUNSC_QUOTA_HELPER_PATH =
  "/usr/local/libexec/boring-workspace-quota" as const;
export const RUNSC_QUOTA_HELPER_EXCEEDED_EXIT = 73;

const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateQuotaWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId.trim().toLowerCase();
  if (!workspaceIdPattern.test(normalized)) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker workspace id is invalid",
    );
  }
  return normalized;
}

export type QuotaHelperOperationV1 = "apply" | "check";

export interface QuotaHelperCommandResultV1 {
  readonly exitCode: number;
  readonly timedOut: boolean;
}

export interface QuotaHelperCommandRunnerV1 {
  run(input: {
    readonly argv: readonly [QuotaHelperOperationV1, string, string];
    readonly timeoutMs: number;
  }): Promise<QuotaHelperCommandResultV1>;
}

export class FixedQuotaHelperCommandRunnerV1
  implements QuotaHelperCommandRunnerV1
{
  async run(input: {
    readonly argv: readonly [QuotaHelperOperationV1, string, string];
    readonly timeoutMs: number;
  }): Promise<QuotaHelperCommandResultV1> {
    return await new Promise((resolve, reject) => {
      const child = spawn(RUNSC_QUOTA_HELPER_PATH, [...input.argv], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, input.timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(
          runscRuntimeError(
            REMOTE_WORKER_ERROR_CODES_V1.unqualified,
            "remote-worker quota helper is unavailable",
            error,
          ),
        );
      });
      child.once("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode: exitCode ?? -1, timedOut });
      });
    });
  }
}

export class FixedProjectQuotaManagerV1 {
  constructor(private readonly runner: QuotaHelperCommandRunnerV1) {}

  async apply(workspaceId: string): Promise<void> {
    await this.invoke("apply", workspaceId);
  }

  async check(workspaceId: string): Promise<void> {
    await this.invoke("check", workspaceId);
  }

  private async invoke(
    operation: QuotaHelperOperationV1,
    workspaceId: string,
  ): Promise<void> {
    const normalized = validateQuotaWorkspaceId(workspaceId);
    const result = await this.runner.run({
      argv: [operation, normalized, RUNSC_WORKSPACE_QUOTA_PROFILE_V1.profileId],
      timeoutMs: RUNSC_RUNTIME_LIMITS_V1.createTimeoutMs,
    });
    if (result.timedOut) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.timeout,
        "remote-worker quota operation timed out",
      );
    }
    if (result.exitCode === RUNSC_QUOTA_HELPER_EXCEEDED_EXIT) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded,
        "remote-worker workspace quota exceeded",
      );
    }
    if (result.exitCode !== 0) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.unqualified,
        "remote-worker quota operation failed",
      );
    }
  }
}

export function requiredHostReserveBytes(totalVolumeBytes: number): number {
  if (!Number.isSafeInteger(totalVolumeBytes) || totalVolumeBytes <= 0) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker volume capacity is invalid",
    );
  }
  return Math.max(Math.ceil(totalVolumeBytes * 0.1), 10 * 1024 ** 3);
}

export function assertHostReserveWritable(input: {
  readonly totalVolumeBytes: number;
  readonly freeVolumeBytes: number;
}): void {
  const reserve = requiredHostReserveBytes(input.totalVolumeBytes);
  if (
    !Number.isSafeInteger(input.freeVolumeBytes) ||
    input.freeVolumeBytes < reserve + RUNSC_WORKSPACE_QUOTA_PROFILE_V1.bytes
  ) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded,
      "remote-worker host reserve prevents workspace allocation",
    );
  }
}
