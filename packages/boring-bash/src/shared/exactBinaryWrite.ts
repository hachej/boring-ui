export const EXACT_BINARY_WRITE_POLICIES = ["error", "replace", "skip"] as const;

export type ExactBinaryWritePolicy = (typeof EXACT_BINARY_WRITE_POLICIES)[number];

export type ExactBinaryWriteOutcome =
  | { status: "written"; path: string }
  | { status: "skipped"; path: string; reason: "already-exists" }
  | { status: "conflict"; path: string; reason: "already-exists" };

export function isExactBinaryWritePolicy(value: unknown): value is ExactBinaryWritePolicy {
  return typeof value === "string"
    && (EXACT_BINARY_WRITE_POLICIES as readonly string[]).includes(value);
}

export function parseExactBinaryWriteOutcome(
  value: unknown,
): ExactBinaryWriteOutcome {
  if (!value || typeof value !== "object") {
    throw new TypeError("invalid exact binary write outcome");
  }
  const outcome = value as Record<string, unknown>;
  if (typeof outcome.path !== "string") {
    throw new TypeError("invalid exact binary write outcome path");
  }
  if (outcome.status === "written") {
    return { status: "written", path: outcome.path };
  }
  if (
    (outcome.status === "skipped" || outcome.status === "conflict")
    && outcome.reason === "already-exists"
  ) {
    return {
      status: outcome.status,
      path: outcome.path,
      reason: "already-exists",
    };
  }
  throw new TypeError("invalid exact binary write outcome status");
}
