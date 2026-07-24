import {
  REMOTE_WORKER_CREDENTIAL_NAME_MAX_BYTES_V1,
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
const utf8Encoder = new TextEncoder();
const invocationFrameMagic = new Uint8Array([0x42, 0x52, 0x49, 0x31]);
const credentialFrameMagic = new Uint8Array([0x42, 0x52, 0x43, 0x31]);
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

function encodeCredentialFrame(
  fields: readonly ResolvedInvocationCredentialFieldV1[],
): Uint8Array {
  if (fields.length === 0) return new Uint8Array();
  if (fields.length > 16) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
      "remote-worker credential field count exceeds its bound",
    );
  }
  const encodedNames = fields.map((field) => utf8Encoder.encode(field.name));
  let size = 6;
  for (let index = 0; index < fields.length; index += 1) {
    const name = encodedNames[index]!;
    const value = fields[index]!.value;
    if (
      name.byteLength === 0 ||
      name.byteLength > REMOTE_WORKER_CREDENTIAL_NAME_MAX_BYTES_V1 ||
      value.byteLength > RUNSC_RUNTIME_LIMITS_V1.maxEnvValueBytes
    ) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker credential field exceeds its bound",
      );
    }
    size += 6 + name.byteLength + value.byteLength;
  }
  if (size > RUNSC_RUNTIME_LIMITS_V1.maxEnvelopeBytes) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
      "remote-worker credential frame exceeds its bound",
    );
  }
  const frame = new Uint8Array(size);
  frame.set(credentialFrameMagic, 0);
  const view = new DataView(frame.buffer);
  view.setUint16(4, fields.length, false);
  let offset = 6;
  for (let index = 0; index < fields.length; index += 1) {
    const name = encodedNames[index]!;
    const value = fields[index]!.value;
    view.setUint16(offset, name.byteLength, false);
    view.setUint32(offset + 2, value.byteLength, false);
    offset += 6;
    frame.set(name, offset);
    offset += name.byteLength;
    frame.set(value, offset);
    offset += value.byteLength;
  }
  return frame;
}

function encodeInvocationFrame(
  metadata: Uint8Array,
  credentials: Uint8Array,
): Uint8Array {
  const size = 12 + metadata.byteLength + credentials.byteLength;
  if (size > RUNSC_RUNTIME_LIMITS_V1.maxEnvelopeBytes) {
    credentials.fill(0);
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker invocation frame exceeds its bound",
    );
  }
  const frame = new Uint8Array(size);
  frame.set(invocationFrameMagic, 0);
  const view = new DataView(frame.buffer);
  view.setUint32(4, metadata.byteLength, false);
  view.setUint32(8, credentials.byteLength, false);
  frame.set(metadata, 12);
  frame.set(credentials, 12 + metadata.byteLength);
  credentials.fill(0);
  return frame;
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
    delivered.add(key);
  }

  const metadata = encodeBoundedJson(
    {
      version: 1,
      command: request.command,
      cwd,
      timeoutMs,
      maxOutputBytes,
      graceMs: RUNSC_RUNTIME_LIMITS_V1.processGroupGraceMs,
    },
    RUNSC_RUNTIME_LIMITS_V1.maxEnvelopeBytes,
  );
  const bytes = encodeInvocationFrame(
    metadata,
    encodeCredentialFrame(resolvedFields),
  );
  return {
    bytes,
    secretBearing: expectedFields.size > 0,
    timeoutMs,
    maxOutputBytes,
  };
}
