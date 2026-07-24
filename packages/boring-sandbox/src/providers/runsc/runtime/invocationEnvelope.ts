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
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
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

export interface ResolvedInvocationCredentialFieldV1 {
  readonly bindingId: string;
  readonly fieldId: string;
  readonly name: string;
  readonly value: Uint8Array;
}

export function prepareInvocationEnvelopeV1(input: {
  workspaceId: string;
  request: RemoteWorkerExecRequestV1;
  resolvedCredentialFields?: readonly ResolvedInvocationCredentialFieldV1[];
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
  const secretNames = new Set<string>();
  const expectedFields = new Map<string, string>();
  for (const credential of request.credentialRefs ?? []) {
    if (credential.ref.executionId !== request.invocationId) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker credential execution scope is invalid",
      );
    }
    for (const field of credential.fields) {
      validateEnvName(field.name);
      const key = `${credential.ref.bindingId}\0${field.fieldId}`;
      if (expectedFields.has(key) || secretNames.has(field.name)) {
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
          "remote-worker credential fields must be unique",
        );
      }
      expectedFields.set(key, field.name);
      secretNames.add(field.name);
    }
  }
  const resolvedFields = input.resolvedCredentialFields ?? [];
  if (resolvedFields.length !== expectedFields.size) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
      "remote-worker credential resolution is incomplete",
    );
  }
  const delivered = new Set<string>();
  for (const field of resolvedFields) {
    const key = `${field.bindingId}\0${field.fieldId}`;
    const expectedName = expectedFields.get(key);
    if (
      expectedName === undefined ||
      expectedName !== field.name ||
      delivered.has(key)
    ) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker credential resolution does not match the request",
      );
    }
    let value: string;
    try {
      value = utf8Decoder.decode(field.value);
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker credential field is not valid UTF-8",
        error,
      );
    }
    boundedUtf8Bytes(
      value,
      RUNSC_RUNTIME_LIMITS_V1.maxEnvValueBytes,
      "credential value",
    );
    delivered.add(key);
    env[field.name] = value;
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
    secretBearing: expectedFields.size > 0,
    timeoutMs,
    maxOutputBytes,
  };
}
