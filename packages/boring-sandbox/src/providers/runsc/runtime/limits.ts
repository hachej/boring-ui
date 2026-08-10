import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";

import { runscRuntimeError } from "./errors";

export const RUNSC_RUNTIME_LIMITS_V1 = Object.freeze({
  defaultInvocationTimeoutMs: 30_000,
  maxInvocationTimeoutMs: 15 * 60 * 1000,
  maxCombinedOutputBytes: 4 * 1024 * 1024,
  maxEnvelopeBytes: 512 * 1024,
  maxWorkspaceEnvelopeBytes: 8 * 1024 * 1024,
  maxCommandBytes: 64 * 1024,
  maxPathBytes: 4 * 1024,
  maxEnvEntries: 128,
  maxSecretEntries: 32,
  maxEnvValueBytes: 64 * 1024,
  processGroupGraceMs: 2_000,
  dockerCommandTimeoutMs: 120_000,
  createTimeoutMs: 120_000,
  fsTimeoutMs: 30_000,
  renewTimeoutMs: 15_000,
  disposeTimeoutMs: 30_000,
  idleTtlMs: 30 * 60 * 1000,
  hardLifetimeMs: 24 * 60 * 60 * 1000,
  shutdownDrainMs: 30_000,
  maxStartupSweepContainers: 1_000,
} as const);

export function boundedPositiveInteger(
  value: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      `remote-worker ${label} is outside its bound`,
    );
  }
  return value;
}

export function boundedUtf8Bytes(
  value: string,
  maximum: number,
  label: string,
): number {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > maximum) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      `remote-worker ${label} exceeds its byte bound`,
    );
  }
  return bytes;
}
