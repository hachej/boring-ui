import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";

import { runscRuntimeError } from "./errors";

export function encodeBoundedJson(
  value: unknown,
  maximumBytes: number,
): Uint8Array {
  let encoded: Uint8Array;
  try {
    encoded = new TextEncoder().encode(JSON.stringify(value));
  } catch (error) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker envelope cannot be encoded",
      error,
    );
  }
  if (encoded.byteLength === 0 || encoded.byteLength > maximumBytes) {
    encoded.fill(0);
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker envelope exceeds its byte bound",
    );
  }
  return encoded;
}

export function decodeBoundedJson(
  value: Uint8Array,
  maximumBytes: number,
): unknown {
  if (value.byteLength === 0 || value.byteLength > maximumBytes) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
      "remote-worker helper response exceeds its byte bound",
    );
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch (error) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
      "remote-worker helper returned an invalid response",
      error,
    );
  }
}
