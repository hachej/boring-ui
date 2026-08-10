import {
  REMOTE_WORKER_ERROR_CODES_V1,
  RemoteWorkerWorkspaceOperationSchemaV1,
  RemoteWorkerWorkspaceResultSchemaV1,
  type RemoteWorkerWorkspaceOperationV1,
  type RemoteWorkerWorkspaceResultV1,
} from "../../../shared/remoteWorkerProtocolV1";

import { buildDockerExecArgv } from "./dockerArgv";
import type { DockerCommandRunner } from "./dockerRunner";
import { runDockerChecked } from "./dockerRunner";
import { runscRuntimeError } from "./errors";
import { decodeBoundedJson, encodeBoundedJson } from "./jsonEnvelope";
import { RUNSC_RUNTIME_LIMITS_V1 } from "./limits";

interface HelperFailure {
  readonly ok: false;
  readonly code: string;
}

function validateWorkspacePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > RUNSC_RUNTIME_LIMITS_V1.maxPathBytes ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.split("/").some((component) => component === "..")
  ) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
      "remote-worker workspace path is unsafe",
    );
  }
}

function validateOperationPaths(operation: RemoteWorkerWorkspaceOperationV1): void {
  if ("path" in operation) validateWorkspacePath(operation.path);
  if (operation.op === "rename") {
    validateWorkspacePath(operation.from);
    validateWorkspacePath(operation.to);
  }
}

function helperFailure(value: unknown): value is HelperFailure {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

export class RunscWorkspaceHelperClientV1 {
  constructor(private readonly runner: DockerCommandRunner) {}

  async probe(runtimeId: string): Promise<void> {
    const response = await this.call(runtimeId, { op: "probe" });
    if (
      !response ||
      typeof response !== "object" ||
      (response as { openat2?: unknown }).openat2 !== true
    ) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable,
        "remote-worker workspace containment primitive is unavailable",
      );
    }
  }

  async execute(
    runtimeId: string,
    input: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1> {
    let operation: RemoteWorkerWorkspaceOperationV1;
    try {
      operation = RemoteWorkerWorkspaceOperationSchemaV1.parse(input);
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker workspace operation failed strict validation",
        error,
      );
    }
    validateOperationPaths(operation);
    const response = await this.call(runtimeId, operation);
    if (helperFailure(response)) {
      const code =
        response.code === REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded
          ? REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded
          : response.code === REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable
            ? REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable
            : REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe;
      throw runscRuntimeError(code, "remote-worker workspace operation failed");
    }
    try {
      return RemoteWorkerWorkspaceResultSchemaV1.parse(response);
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
        "remote-worker workspace helper returned an invalid result",
        error,
      );
    }
  }

  private async call(runtimeId: string, body: unknown): Promise<unknown> {
    const result = await runDockerChecked(this.runner, {
      argv: buildDockerExecArgv(runtimeId, "workspace"),
      stdin: encodeBoundedJson(
        body,
        RUNSC_RUNTIME_LIMITS_V1.maxWorkspaceEnvelopeBytes,
      ),
      timeoutMs: RUNSC_RUNTIME_LIMITS_V1.fsTimeoutMs,
      maxOutputBytes: RUNSC_RUNTIME_LIMITS_V1.maxWorkspaceEnvelopeBytes,
    });
    return decodeBoundedJson(
      result.stdout,
      RUNSC_RUNTIME_LIMITS_V1.maxWorkspaceEnvelopeBytes,
    );
  }
}
