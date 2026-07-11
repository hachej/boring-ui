import type { RunscPreflightErrorCode } from "../../shared/runsc";

export class RunscPreflightError extends Error {
  constructor(
    readonly code: RunscPreflightErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RunscPreflightError";
  }
}
