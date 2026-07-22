import {
  REMOTE_WORKER_ERROR_CODES_V1,
  RemoteWorkerExecRequestSchemaV1,
  type RemoteWorkerExecRequestV1,
} from "../../../shared/remoteWorkerProtocolV1";

import { runscRuntimeError } from "./errors";
import { encodeBoundedJson } from "./jsonEnvelope";
import {
  RUNSC_RUNTIME_LIMITS_V1,
  boundedPositiveInteger,
  boundedUtf8Bytes,
} from "./limits";

const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reservedNames = new Set([
  "BASH_ENV",
  "DOCKER_CONFIG",
  "DOCKER_HOST",
  "ENV",
  "HOME",
  "IFS",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "PATH",
  "PWD",
  "PYTHONHOME",
  "PYTHONPATH",
  "SHELL",
  "_",
]);

export const RUNSC_RUNTIME_RESERVED_ENV_NAMES_V1 = Object.freeze([
  ...reservedNames,
]);

function validateEnvName(name: string): void {
  if (
    !envNamePattern.test(name) ||
    reservedNames.has(name) ||
    name.startsWith("BORING_")
  ) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
      "remote-worker invocation env name is not allowed",
    );
  }
}

export interface PreparedInvocationEnvelopeV1 {
  readonly bytes: Uint8Array;
  readonly secretBearing: boolean;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export function prepareInvocationEnvelopeV1(input: {
  workspaceId: string;
  request: RemoteWorkerExecRequestV1;
}): PreparedInvocationEnvelopeV1 {
  let request: RemoteWorkerExecRequestV1;
  try {
    request = RemoteWorkerExecRequestSchemaV1.parse(input.request);
  } catch (error) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker invocation failed strict validation",
      error,
    );
  }
  boundedUtf8Bytes(
    request.command,
    RUNSC_RUNTIME_LIMITS_V1.maxCommandBytes,
    "command",
  );
  const timeoutMs = boundedPositiveInteger(
    request.timeoutMs ?? RUNSC_RUNTIME_LIMITS_V1.defaultInvocationTimeoutMs,
    RUNSC_RUNTIME_LIMITS_V1.maxInvocationTimeoutMs,
    "invocation timeout",
  );
  const maxOutputBytes = boundedPositiveInteger(
    request.maxOutputBytes,
    RUNSC_RUNTIME_LIMITS_V1.maxCombinedOutputBytes,
    "invocation output limit",
  );
  const cwd = request.cwd ?? "/workspace";
  boundedUtf8Bytes(cwd, RUNSC_RUNTIME_LIMITS_V1.maxPathBytes, "cwd");
  if (
    (cwd !== "/workspace" && !cwd.startsWith("/workspace/")) ||
    cwd.includes("\0") ||
    cwd.split("/").includes("..")
  ) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
      "remote-worker invocation cwd is outside the workspace",
    );
  }

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.env ?? {})) {
    validateEnvName(name);
    boundedUtf8Bytes(
      value,
      RUNSC_RUNTIME_LIMITS_V1.maxEnvValueBytes,
      "env value",
    );
    env[name] = value;
  }
  const secretNames = new Set<string>();
  for (const entry of request.secretEnv ?? []) {
    validateEnvName(entry.name);
    if (entry.reference.kind === "model-provider-credential") {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker rejects model-provider credentials",
      );
    }
    if (entry.reference.workspaceId !== input.workspaceId) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker invocation secret scope is invalid",
      );
    }
    if (entry.name in env || secretNames.has(entry.name)) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker invocation env names must be unique",
      );
    }
    boundedUtf8Bytes(
      entry.value,
      RUNSC_RUNTIME_LIMITS_V1.maxEnvValueBytes,
      "secret value",
    );
    secretNames.add(entry.name);
    env[entry.name] = entry.value;
  }

  const bytes = encodeBoundedJson(
    {
      version: 1,
      command: request.command,
      cwd,
      env,
      timeoutMs,
      maxOutputBytes,
      graceMs: RUNSC_RUNTIME_LIMITS_V1.processGroupGraceMs,
    },
    RUNSC_RUNTIME_LIMITS_V1.maxEnvelopeBytes,
  );
  for (const name of Object.keys(env)) env[name] = "";
  return {
    bytes,
    secretBearing: secretNames.size > 0,
    timeoutMs,
    maxOutputBytes,
  };
}
