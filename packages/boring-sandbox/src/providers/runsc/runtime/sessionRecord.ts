import type { RemoteWorkerExecResponseV1 } from "../../../shared/remoteWorkerProtocolV1";
import type { TrustedWorkspaceMountSource } from "./dockerArgv";
import type { RunscSessionRetirementReasonV1 } from "./sessionRetirement";

export interface InvocationRecordV1 {
  readonly digest: `sha256:${string}`;
  state: "running" | "complete" | "secret-terminal";
  result?: RemoteWorkerExecResponseV1;
}

export interface SessionRecordV1 {
  readonly sandboxId: string;
  readonly clientLeaseId: string;
  readonly createDigest: `sha256:${string}`;
  readonly workspaceId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly ownsWorkspaceMountSource: boolean;
  readonly image: string;
  createdAtMs: number;
  hardExpiresAtMs: number;
  readonly idleTtlMs: number;
  runtimeId: string;
  leaseExpiresAtMs: number;
  timer: ReturnType<typeof setTimeout>;
  activeExec: boolean;
  activeFs: boolean;
  expiryPending?: "idle" | "hard-expiry";
  invocations: Map<string, InvocationRecordV1>;
  retirement?: {
    readonly reason: RunscSessionRetirementReasonV1;
    readonly notify: boolean;
    attempts: number;
  };
}

interface InvocationHelperResponseV1 {
  readonly ok: true;
  readonly stdoutBase64: string;
  readonly stderrBase64: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly cleanupProven: boolean;
}

export function isInvocationHelperResponseV1(
  value: unknown,
): value is InvocationHelperResponseV1 {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<InvocationHelperResponseV1>;
  return (
    result.ok === true &&
    typeof result.stdoutBase64 === "string" &&
    typeof result.stderrBase64 === "string" &&
    Number.isInteger(result.exitCode) &&
    typeof result.durationMs === "number" &&
    typeof result.truncated === "boolean" &&
    typeof result.timedOut === "boolean" &&
    typeof result.cleanupProven === "boolean"
  );
}
