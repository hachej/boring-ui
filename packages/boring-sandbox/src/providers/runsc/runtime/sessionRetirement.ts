import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";

import { buildDockerRemoveArgv } from "./dockerArgv";
import type { DockerCommandRunner } from "./dockerRunner";
import { runDockerChecked } from "./dockerRunner";
import { runscRuntimeError } from "./errors";
import { RUNSC_RUNTIME_LIMITS_V1 } from "./limits";

const RETIREMENT_RETRY_BASE_MS = 100;
const RETIREMENT_RETRY_MAX_MS = 5_000;

export type RunscSessionRetirementReasonV1 =
  "idle" | "hard-expiry" | "missing" | "cleanup" | "history" | "shutdown";

export interface RunscSessionRetirementV1 {
  readonly sandboxId: string;
  readonly reason: RunscSessionRetirementReasonV1;
}

export interface RetirableRunscSessionRecordV1 {
  readonly sandboxId: string;
  readonly runtimeId: string;
  timer: ReturnType<typeof setTimeout>;
  retirement?: {
    readonly reason: RunscSessionRetirementReasonV1;
    readonly notify: boolean;
    attempts: number;
  };
}

export interface RunscSessionRetirementManagerOptionsV1<
  RecordV1 extends RetirableRunscSessionRecordV1,
> {
  readonly runner: DockerCommandRunner;
  readonly detach: (record: RecordV1) => void;
  readonly onRetire?: (
    retirement: RunscSessionRetirementV1,
  ) => void | Promise<void>;
}

export class RunscSessionRetirementManagerV1<
  RecordV1 extends RetirableRunscSessionRecordV1,
> {
  private readonly cleanupInflight = new Map<RecordV1, Promise<void>>();
  private readonly notificationInflight = new Map<string, Promise<void>>();

  constructor(
    private readonly options: RunscSessionRetirementManagerOptionsV1<RecordV1>,
  ) {}

  async retire(
    record: RecordV1,
    reason: RunscSessionRetirementReasonV1,
    notify = true,
  ): Promise<void> {
    const existing = this.cleanupInflight.get(record);
    if (existing) return await existing;
    clearTimeout(record.timer);
    record.retirement ??= { reason, notify, attempts: 0 };
    const retirement = this.removeAndDetach(record);
    this.cleanupInflight.set(record, retirement);
    try {
      await retirement;
    } finally {
      this.cleanupInflight.delete(record);
    }
  }

  async notifyMissing(sandboxId: string): Promise<void> {
    const existing = this.notificationInflight.get(sandboxId);
    if (existing) return await existing;
    const retirement = this.notify({ sandboxId, reason: "missing" });
    this.notificationInflight.set(sandboxId, retirement);
    try {
      await retirement;
    } finally {
      this.notificationInflight.delete(sandboxId);
    }
  }

  private async removeAndDetach(record: RecordV1): Promise<void> {
    try {
      await runDockerChecked(this.options.runner, {
        argv: buildDockerRemoveArgv(record.runtimeId),
        timeoutMs: RUNSC_RUNTIME_LIMITS_V1.disposeTimeoutMs,
        maxOutputBytes: 64 * 1024,
      });
    } catch (error) {
      record.retirement!.attempts += 1;
      this.scheduleRetry(record);
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker sandbox cleanup is incomplete",
        error,
      );
    }
    const retirement = record.retirement;
    this.options.detach(record);
    if (retirement?.notify) {
      await this.notify({
        sandboxId: record.sandboxId,
        reason: retirement.reason,
      });
    }
  }

  private scheduleRetry(record: RecordV1): void {
    if (!record.retirement) return;
    const exponent = Math.max(0, record.retirement.attempts - 1);
    const delayMs = Math.min(
      RETIREMENT_RETRY_BASE_MS * 2 ** exponent,
      RETIREMENT_RETRY_MAX_MS,
    );
    clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      void this.retire(
        record,
        record.retirement!.reason,
        record.retirement!.notify,
      ).catch(() => undefined);
    }, delayMs);
  }

  private async notify(retirement: RunscSessionRetirementV1): Promise<void> {
    try {
      await this.options.onRetire?.(retirement);
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker retirement notification failed",
        error,
      );
    }
  }
}
