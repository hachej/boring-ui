import { isIP } from "node:net";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import {
  RUNSC_PREFLIGHT_ERROR_CODES,
  RUNSC_REQUIRED_BLOCKED_CIDRS,
} from "../../shared/runsc";
import { RunscPreflightError } from "./errors";

const SAFE_ID = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const MIN_MEMORY_BYTES = 64 * 1024 * 1024;
const AbsolutePath = z.string()
  .min(1)
  .max(4_096)
  .refine((value) => isAbsolute(value) && !value.includes("\0"));
const Cidr = z.string().max(64).refine(isCidr);
const PositiveInteger = z.number().int().positive().safe();

const NonEmptyString = z.string().min(1);
const RunscPreflightConfigSchema = z.object({
  stateRoot: AbsolutePath,
  digestMarkerPath: AbsolutePath,
  networkNamespace: NonEmptyString.regex(SAFE_ID),
  nftTable: NonEmptyString.regex(SAFE_ID),
  requiredBlockedCidrs: z.array(Cidr).max(64),
  cgroupRoot: AbsolutePath,
  workspaceCgroupRoot: AbsolutePath,
  binaries: z.object({
    runsc: AbsolutePath,
    ip: AbsolutePath,
    nft: AbsolutePath,
    cat: AbsolutePath,
    true: AbsolutePath,
  }).strict(),
  expected: z.object({
    imageDigest: NonEmptyString.regex(SHA256_DIGEST),
    cpuPeriodMicros: PositiveInteger,
    cpuQuotaMicros: PositiveInteger,
    memoryBytes: z.number().int().safe().min(MIN_MEMORY_BYTES),
    pidsMax: z.number().int().min(16).max(65_536),
  }).strict(),
}).strict().superRefine((config, ctx) => {
  if (!isChildPath(config.stateRoot, config.digestMarkerPath)) reject(ctx);
  if (!isChildPath(config.cgroupRoot, config.workspaceCgroupRoot)) reject(ctx);
  if (RUNSC_REQUIRED_BLOCKED_CIDRS.some((cidr) => !config.requiredBlockedCidrs.includes(cidr))) {
    reject(ctx);
  }
  if (config.expected.cpuQuotaMicros > config.expected.cpuPeriodMicros * 64) reject(ctx);
});

export type RunscPreflightConfig = z.infer<typeof RunscPreflightConfigSchema>;

export function validateRunscPreflightConfig(value: unknown): RunscPreflightConfig {
  const parsed = RunscPreflightConfigSchema.safeParse(value);
  if (!parsed.success) invalid("config does not match the runsc preflight schema");
  return parsed.data;
}

function reject(ctx: z.RefinementCtx): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cross-field constraint failed" });
}

function isChildPath(root: string, value: string): boolean {
  const child = resolve(value);
  const rel = relative(resolve(root), child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function isCidr(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  const family = address ? isIP(address) : 0;
  if (!prefix || !/^\d+$/.test(prefix)) return false;
  const prefixNumber = Number(prefix);
  const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1;
  return !(
    extra !== undefined ||
    !Number.isInteger(prefixNumber) ||
    prefixNumber < 0 ||
    prefixNumber > maxPrefix
  );
}

function invalid(message: string): never {
  throw new RunscPreflightError(RUNSC_PREFLIGHT_ERROR_CODES.invalidConfig, message);
}
