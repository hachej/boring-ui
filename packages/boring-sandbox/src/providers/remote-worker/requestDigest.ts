import { createHash } from "node:crypto";

function canonicalJsonValue(
  value: unknown,
  ancestors: Set<object>,
  arrayElement: boolean,
): string | undefined {
  if (value && typeof value === "object") {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      return canonicalJsonValue(toJSON.call(value), ancestors, arrayElement);
    }
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return arrayElement ? "null" : undefined;
  }
  if (typeof value === "bigint") {
    throw new TypeError("bigint cannot be encoded as canonical JSON");
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (ancestors.has(value)) {
    throw new TypeError("cyclic value cannot be encoded as canonical JSON");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => canonicalJsonValue(entry, ancestors, true) ?? "null")
        .join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .flatMap((key) => {
        const encoded = canonicalJsonValue(record[key], ancestors, false);
        return encoded === undefined
          ? []
          : [`${JSON.stringify(key)}:${encoded}`];
      });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new Set(), false) ?? "null";
}

export function remoteWorkerRequestDigestV1(
  value: unknown,
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
