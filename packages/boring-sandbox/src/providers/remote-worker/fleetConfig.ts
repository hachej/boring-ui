import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import { z } from "zod";

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerSha256DigestSchemaV1,
} from "../../shared/remoteWorkerProtocolV1";
import { SandboxProviderError } from "../../shared/providerV1";

export const REMOTE_WORKER_BUCKET_COUNT_V1 = 256 as const;

const workerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const tlsServerNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/,
  );

const RemoteWorkerFleetWorkerConfigSchemaV1 = z
  .object({
    workerId: workerIdSchema,
    baseUrl: z.string().url(),
    tokenFile: z.string().min(1),
    caFile: z.string().min(1),
    tlsServerName: tlsServerNameSchema,
    expectedEvidenceDigest: RemoteWorkerSha256DigestSchemaV1,
    expectedQualificationBundleDigest: RemoteWorkerSha256DigestSchemaV1,
    expectedProviderCohortDigest: RemoteWorkerSha256DigestSchemaV1,
    expectedImageDigest: RemoteWorkerSha256DigestSchemaV1,
    buckets: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(REMOTE_WORKER_BUCKET_COUNT_V1 - 1),
      )
      .min(1),
  })
  .strict();

const RemoteWorkerFleetConfigSchemaV1 = z
  .object({
    protocolVersion: z.literal(REMOTE_WORKER_PROTOCOL_VERSION),
    bucketCount: z.literal(REMOTE_WORKER_BUCKET_COUNT_V1),
    workers: z.array(RemoteWorkerFleetWorkerConfigSchemaV1).min(1),
  })
  .strict();

export interface RemoteWorkerFleetWorkerConfigV1 {
  readonly workerId: string;
  readonly baseUrl: string;
  readonly tokenFile: string;
  readonly caFile: string;
  readonly tlsServerName: string;
  readonly expectedEvidenceDigest: `sha256:${string}`;
  readonly expectedQualificationBundleDigest: `sha256:${string}`;
  readonly expectedProviderCohortDigest: `sha256:${string}`;
  readonly expectedImageDigest: `sha256:${string}`;
  readonly buckets: readonly number[];
}

export interface RemoteWorkerFleetConfigV1 {
  readonly protocolVersion: typeof REMOTE_WORKER_PROTOCOL_VERSION;
  readonly bucketCount: typeof REMOTE_WORKER_BUCKET_COUNT_V1;
  readonly workers: readonly RemoteWorkerFleetWorkerConfigV1[];
}

export interface ParseRemoteWorkerFleetConfigOptionsV1 {
  /** Tests may use an in-process loopback worker. Production config remains HTTPS-only. */
  allowInsecureLoopback?: boolean;
}

function configError(message: string, cause?: unknown): SandboxProviderError {
  return new SandboxProviderError(
    REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function validateWorkerUrl(
  rawUrl: string,
  allowInsecureLoopback: boolean,
): string {
  const url = new URL(rawUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw configError(
      "remote-worker baseUrl must contain only scheme and authority",
    );
  }
  if (url.protocol !== "https:") {
    if (!(
      allowInsecureLoopback &&
      url.protocol === "http:" &&
      isLoopbackHostname(url.hostname)
    )) {
      throw configError("remote-worker baseUrl must use HTTPS");
    }
  }
  return url.toString().replace(/\/$/, "");
}

export function parseRemoteWorkerFleetConfigV1(
  input: unknown,
  options: ParseRemoteWorkerFleetConfigOptionsV1 = {},
): RemoteWorkerFleetConfigV1 {
  const parsed = RemoteWorkerFleetConfigSchemaV1.safeParse(input);
  if (!parsed.success) {
    throw configError(
      "remote-worker fleet config failed strict validation",
      parsed.error,
    );
  }

  const workerIds = new Set<string>();
  const tokenFiles = new Set<string>();
  const bucketOwners = new Array<string | undefined>(
    REMOTE_WORKER_BUCKET_COUNT_V1,
  );
  const workers = parsed.data.workers.map((worker) => {
    if (workerIds.has(worker.workerId)) {
      throw configError(
        "remote-worker fleet config contains a duplicate workerId",
      );
    }
    workerIds.add(worker.workerId);

    if (!isAbsolute(worker.tokenFile) || !isAbsolute(worker.caFile)) {
      throw configError(
        "remote-worker tokenFile and caFile must be absolute paths",
      );
    }
    if (tokenFiles.has(worker.tokenFile)) {
      throw configError(
        "remote-worker workers must not share tokenFile references",
      );
    }
    tokenFiles.add(worker.tokenFile);

    for (const bucket of worker.buckets) {
      if (bucketOwners[bucket] !== undefined) {
        throw configError(
          "remote-worker fleet config assigns a bucket more than once",
        );
      }
      bucketOwners[bucket] = worker.workerId;
    }

    return Object.freeze({
      ...worker,
      expectedEvidenceDigest:
        worker.expectedEvidenceDigest as `sha256:${string}`,
      expectedQualificationBundleDigest:
        worker.expectedQualificationBundleDigest as `sha256:${string}`,
      expectedProviderCohortDigest:
        worker.expectedProviderCohortDigest as `sha256:${string}`,
      expectedImageDigest: worker.expectedImageDigest as `sha256:${string}`,
      baseUrl: validateWorkerUrl(
        worker.baseUrl,
        options.allowInsecureLoopback === true,
      ),
      buckets: Object.freeze([...worker.buckets]),
    });
  });

  if (bucketOwners.includes(undefined)) {
    throw configError(
      "remote-worker fleet config must assign every bucket exactly once",
    );
  }

  return Object.freeze({
    protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
    bucketCount: REMOTE_WORKER_BUCKET_COUNT_V1,
    workers: Object.freeze(workers),
  });
}

export function remoteWorkerBucketForWorkspaceV1(workspaceId: string): number {
  const digest = new Uint8Array(
    createHash("sha256").update(workspaceId, "utf8").digest(),
  );
  return digest[digest.length - 1] ?? 0;
}

export function resolveRemoteWorkerPlacementV1(
  config: RemoteWorkerFleetConfigV1,
  workspaceId: string,
): RemoteWorkerFleetWorkerConfigV1 {
  const bucket = remoteWorkerBucketForWorkspaceV1(workspaceId);
  const worker = config.workers.find((candidate) =>
    candidate.buckets.includes(bucket),
  );
  if (!worker) {
    throw configError(
      "remote-worker placement has no owner for the workspace bucket",
    );
  }
  return worker;
}
