import type { ErrorCode } from "@hachej/boring-agent/shared";

import { SandboxProviderError } from "../../../shared/providerV1";

interface SanitizedRuntimeCause {
  readonly name?: string;
  readonly code?: string;
  readonly errno?: number | string;
  readonly syscall?: string;
}

const SAFE_CAUSE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

function safeCauseToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_CAUSE_TOKEN.test(value)
    ? value
    : undefined;
}

function sanitizedCause(cause: unknown): SanitizedRuntimeCause | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const candidate = cause as {
    name?: unknown;
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
  };
  const errno =
    typeof candidate.errno === "number" && Number.isSafeInteger(candidate.errno)
      ? candidate.errno
      : safeCauseToken(candidate.errno);
  const result: SanitizedRuntimeCause = {
    name: safeCauseToken(candidate.name),
    code: safeCauseToken(candidate.code),
    errno,
    syscall: safeCauseToken(candidate.syscall),
  };
  return Object.values(result).some((value) => value !== undefined)
    ? result
    : undefined;
}

export function runscRuntimeError(
  code: ErrorCode,
  message: string,
  cause?: unknown,
): SandboxProviderError {
  const safeCause = sanitizedCause(cause);
  return new SandboxProviderError(
    code,
    message,
    safeCause === undefined ? {} : { cause: safeCause },
  );
}
