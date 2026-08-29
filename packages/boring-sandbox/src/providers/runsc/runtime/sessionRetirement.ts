import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";
import {
  buildDockerOwnedContainerLookupArgv,
  buildDockerRemoveArgv,
  type TrustedWorkspaceMountSource,
} from "./dockerArgv";
import type { DockerCommandRunner } from "./dockerRunner";
import { runDockerChecked } from "./dockerRunner";
import { runscRuntimeError } from "./errors";
import { RUNSC_RUNTIME_LIMITS_V1 } from "./limits";
const RETIREMENT_RETRY_BASE_MS = 100;
const RETIREMENT_RETRY_MAX_MS = 5_000;
export type RunscSessionRetirementReasonV1 =
  "idle" | "hard-expiry" | "missing" | "cleanup" | "history" | "shutdown";
/** Legacy V1 callback payload. */
export interface RunscSessionRetirementV1 {
  readonly sandboxId: string;
  readonly reason: RunscSessionRetirementReasonV1;
}
export interface CompositeRunscSessionRetirementV1 extends RunscSessionRetirementV1 {
  readonly workspaceId: string;
}
/** Legacy V1 retirement record. */
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
interface CompositeFieldsV1 {
  readonly workspaceId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly ownsWorkspaceMountSource: boolean;
}
interface CleanupStateV1 { containerRemoved: boolean; rootRemoved: boolean }
export interface RunscSessionRetirementManagerOptionsV1<
  RecordV1 extends RetirableRunscSessionRecordV1,
> {
  readonly runner: DockerCommandRunner;
  readonly detach: (record: RecordV1) => void;
  readonly onRetire?: (value: RunscSessionRetirementV1) => void | Promise<void>;
  readonly onCompositeRetire?: (value: CompositeRunscSessionRetirementV1) => void | Promise<void>;
  readonly disposeMountSource?: (source: TrustedWorkspaceMountSource) => void | Promise<void>;
}
export class RunscSessionRetirementManagerV1<
  RecordV1 extends RetirableRunscSessionRecordV1> {
  private readonly cleanupInflight = new Map<RecordV1, Promise<void>>();
  private readonly cleanupState = new WeakMap<RecordV1, CleanupStateV1>();
  private readonly notificationInflight = new Map<string, Promise<void>>();
  constructor(private readonly options: RunscSessionRetirementManagerOptionsV1<RecordV1>) {}
  async retire(
    record: RecordV1,
    reason: RunscSessionRetirementReasonV1,
    notify = true,
  ): Promise<void> {
    const existing = this.cleanupInflight.get(record);
    if (existing) return await existing;
    clearTimeout(record.timer);
    record.retirement ??= { reason, notify, attempts: 0 };
    const operation = this.removeAndDetach(record);
    this.cleanupInflight.set(record, operation);
    try { await operation; }
    finally { this.cleanupInflight.delete(record); }
  }
  async notifyMissing(sandboxId: string): Promise<void> {
    await this.notifyMissingWithKey(`legacy\u0000${sandboxId}`, {
      sandboxId,
      reason: "missing",
    });
  }
  async notifyMissingComposite(workspaceId: string, sandboxId: string): Promise<void> {
    await this.notifyMissingWithKey(`${workspaceId}\u0000${sandboxId}`, {
      workspaceId,
      sandboxId,
      reason: "missing",
    });
  }
  private async notifyMissingWithKey(
    key: string,
    value: RunscSessionRetirementV1 | CompositeRunscSessionRetirementV1,
  ): Promise<void> {
    const existing = this.notificationInflight.get(key);
    if (existing) return await existing;
    const operation = this.notify(value);
    this.notificationInflight.set(key, operation);
    try { await operation; }
    finally { this.notificationInflight.delete(key); }
  }
  private async removeAndDetach(record: RecordV1): Promise<void> {
    const composite = this.compositeFields(record);
    const state = this.cleanupState.get(record) ?? {
      containerRemoved: false,
      rootRemoved: !composite?.ownsWorkspaceMountSource,
    };
    this.cleanupState.set(record, state);
    try {
      if (!state.containerRemoved) {
        await this.removeContainerOrProveAbsent(record.runtimeId);
        state.containerRemoved = true;
      }
      if (!state.rootRemoved) {
        if (!composite || !this.options.disposeMountSource) {
          throw runscRuntimeError(
            REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
            "remote-worker sandbox root disposal is unavailable",
          );
        }
        await this.options.disposeMountSource(composite.workspaceMountSource);
        state.rootRemoved = true;
      }
      if (record.retirement!.notify) {
        await this.notify(composite?.ownsWorkspaceMountSource
          ? { workspaceId: composite.workspaceId, sandboxId: record.sandboxId, reason: record.retirement!.reason }
          : { sandboxId: record.sandboxId, reason: record.retirement!.reason });
      }
    } catch (error) {
      record.retirement!.attempts += 1;
      this.scheduleRetry(record);
      if (error && typeof error === "object" && "code" in error &&
        error.code === REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup) throw error;
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker sandbox cleanup is incomplete",
        error,
      );
    }
    this.options.detach(record);
    this.cleanupState.delete(record);
  }
  private compositeFields(record: RecordV1): CompositeFieldsV1 | undefined {
    const candidate = record as RecordV1 & Partial<CompositeFieldsV1>;
    return candidate.ownsWorkspaceMountSource === undefined
      ? undefined
      : (candidate as RecordV1 & CompositeFieldsV1);
  }
  private async removeContainerOrProveAbsent(runtimeId: string): Promise<void> {
    try {
      const removed = await this.options.runner.run({
        argv: buildDockerRemoveArgv(runtimeId),
        timeoutMs: RUNSC_RUNTIME_LIMITS_V1.disposeTimeoutMs,
        maxOutputBytes: 64 * 1024,
      });
      if (!removed.timedOut && !removed.aborted && removed.exitCode === 0) return;
    } catch {
      // A process failure may occur after Docker accepted removal.
    }
    const lookup = await runDockerChecked(this.options.runner, {
      argv: buildDockerOwnedContainerLookupArgv(runtimeId),
      timeoutMs: RUNSC_RUNTIME_LIMITS_V1.disposeTimeoutMs,
      maxOutputBytes: 64 * 1024,
    });
    if (new TextDecoder().decode(lookup.stdout).trim() === "") return;
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
      "remote-worker owned container removal is incomplete",
    );
  }
  private scheduleRetry(record: RecordV1): void {
    if (!record.retirement) return;
    const exponent = Math.max(0, record.retirement.attempts - 1);
    const delayMs = Math.min(RETIREMENT_RETRY_BASE_MS * 2 ** exponent, RETIREMENT_RETRY_MAX_MS);
    clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      void this.retire(record, record.retirement!.reason, record.retirement!.notify)
        .catch(() => undefined);
    }, delayMs);
  }
  private async notify(
    retirement: RunscSessionRetirementV1 | CompositeRunscSessionRetirementV1,
  ): Promise<void> {
    try {
      if ("workspaceId" in retirement) await this.options.onCompositeRetire?.(retirement);
      else await this.options.onRetire?.(retirement);
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker retirement notification failed",
        error,
      );
    }
  }
}
