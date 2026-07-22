import { z } from "zod";

import type { ErrorCode } from "@hachej/boring-agent/shared";

import { PROVIDER_CONTRACT_VERSION } from "./providerMatrix";
import { InvocationSecretReferenceSchemaV1 } from "./invocationSecretsV1";

export const REMOTE_WORKER_PROTOCOL_VERSION = "boring.remote-worker.v1";
export const REMOTE_WORKER_RUNTIME_CWD = "/workspace";
export const REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS = 5 * 60 * 1000;

export const REMOTE_WORKER_HEADERS_V1 = Object.freeze({
  capability: "x-boring-internal-token",
  requestId: "x-boring-request-id",
  protocolVersion: "x-boring-protocol-version",
} as const);

export const REMOTE_WORKER_ERROR_CODES_V1 = Object.freeze({
  configInvalid: "REMOTE_WORKER_CONFIG_INVALID",
  protocolMismatch: "REMOTE_WORKER_PROTOCOL_MISMATCH",
  unauthenticated: "REMOTE_WORKER_UNAUTHENTICATED",
  unavailable: "REMOTE_WORKER_UNAVAILABLE",
  unqualified: "REMOTE_WORKER_UNQUALIFIED",
  requestInvalid: "REMOTE_WORKER_REQUEST_INVALID",
  responseInvalid: "REMOTE_WORKER_RESPONSE_INVALID",
  capabilityExpired: "REMOTE_WORKER_CAPABILITY_EXPIRED",
  capabilityReplay: "REMOTE_WORKER_CAPABILITY_REPLAY",
  capabilityNonceStoreExhausted:
    "REMOTE_WORKER_CAPABILITY_NONCE_STORE_EXHAUSTED",
  authorizedWorkspaceRequired: "REMOTE_WORKER_AUTHORIZED_WORKSPACE_REQUIRED",
  bindingReceiptInvalid: "REMOTE_WORKER_BINDING_RECEIPT_INVALID",
  sandboxWorkspaceMismatch: "REMOTE_WORKER_SANDBOX_WORKSPACE_MISMATCH",
  sandboxNotFound: "REMOTE_WORKER_SANDBOX_NOT_FOUND",
  sandboxExpired: "REMOTE_WORKER_SANDBOX_EXPIRED",
  sandboxDisposed: "REMOTE_WORKER_SANDBOX_DISPOSED",
  createConcurrencyExhausted: "REMOTE_WORKER_CREATE_CONCURRENCY_EXHAUSTED",
  execConcurrencyExhausted: "REMOTE_WORKER_EXEC_CONCURRENCY_EXHAUSTED",
  idempotencyConflict: "REMOTE_WORKER_IDEMPOTENCY_CONFLICT",
  execInProgress: "REMOTE_WORKER_EXEC_IN_PROGRESS",
  secretInvocationNotReplayable:
    "REMOTE_WORKER_SECRET_INVOCATION_NOT_REPLAYABLE",
  outcomeUnknown: "REMOTE_WORKER_OUTCOME_UNKNOWN",
  incompleteCleanup: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
  dockerCommandFailed: "REMOTE_WORKER_DOCKER_COMMAND_FAILED",
  pathUnsafe: "REMOTE_WORKER_PATH_UNSAFE",
  pathPrimitiveUnavailable: "REMOTE_WORKER_PATH_PRIMITIVE_UNAVAILABLE",
  quotaExceeded: "REMOTE_WORKER_QUOTA_EXCEEDED",
  secretReferenceRejected: "REMOTE_WORKER_SECRET_REFERENCE_REJECTED",
  execAborted: "REMOTE_WORKER_EXEC_ABORTED",
  outputLimit: "REMOTE_WORKER_OUTPUT_LIMIT",
  timeout: "REMOTE_WORKER_TIMEOUT",
  streamClosed: "REMOTE_WORKER_STREAM_CLOSED",
} as const satisfies Record<string, ErrorCode>);

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const maxTransferChars = 6 * 1024 * 1024;
const maxOutputBytes = 4 * 1024 * 1024;
const maxInvocationTimeoutMs = 15 * 60 * 1000;
const maxIdleTimeoutMs = 30 * 60 * 1000;

export const RemoteWorkerOpaqueIdSchemaV1 = z
  .string()
  .min(1)
  .max(128)
  .regex(opaqueIdPattern);

export const RemoteWorkerSha256DigestSchemaV1 = z.string().regex(sha256Pattern);

export const RemoteWorkerOperationSchemaV1 = z.enum([
  "health",
  "create",
  "fs",
  "events",
  "exec",
  "renew",
  "delete",
]);

export type RemoteWorkerOperationV1 = z.infer<
  typeof RemoteWorkerOperationSchemaV1
>;

const capabilityClaimsBaseV1 = {
  protocolVersion: z.literal(REMOTE_WORKER_PROTOCOL_VERSION),
  workerId: RemoteWorkerOpaqueIdSchemaV1,
  workspaceId: RemoteWorkerOpaqueIdSchemaV1,
  requestDigest: RemoteWorkerSha256DigestSchemaV1,
  issuedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive(),
  nonce: RemoteWorkerOpaqueIdSchemaV1,
};

export const RemoteWorkerCapabilityClaimsSchemaV1 = z.union([
  z
    .object({
      ...capabilityClaimsBaseV1,
      operation: z.enum(["health", "create"]),
    })
    .strict(),
  z
    .object({
      ...capabilityClaimsBaseV1,
      operation: z.enum(["fs", "events", "exec", "renew", "delete"]),
      sandboxId: RemoteWorkerOpaqueIdSchemaV1,
    })
    .strict(),
]);

export type RemoteWorkerCapabilityClaimsV1 = z.infer<
  typeof RemoteWorkerCapabilityClaimsSchemaV1
>;

export const RemoteWorkerHealthResponseSchemaV1 = z
  .object({
    protocolVersion: z.literal(REMOTE_WORKER_PROTOCOL_VERSION),
    providerContractVersion: z.literal(PROVIDER_CONTRACT_VERSION),
    workerId: RemoteWorkerOpaqueIdSchemaV1,
    evidenceDigest: RemoteWorkerSha256DigestSchemaV1,
    qualificationBundleDigest: RemoteWorkerSha256DigestSchemaV1,
    providerCohortDigest: RemoteWorkerSha256DigestSchemaV1,
    imageDigest: RemoteWorkerSha256DigestSchemaV1,
    qualificationRunId: RemoteWorkerOpaqueIdSchemaV1,
    isolation: z.literal("docker-runsc-systrap"),
    qualifiedAtMs: z.number().int().positive(),
    capabilities: z
      .array(z.enum(["fs", "events", "exec", "renew", "delete"]))
      .length(5)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();

export type RemoteWorkerHealthResponseV1 = z.infer<
  typeof RemoteWorkerHealthResponseSchemaV1
>;

export const RemoteWorkerCreateRequestSchemaV1 = z
  .object({
    protocolVersion: z.literal(REMOTE_WORKER_PROTOCOL_VERSION),
    providerContractVersion: z.literal(PROVIDER_CONTRACT_VERSION),
    workspaceId: RemoteWorkerOpaqueIdSchemaV1,
    sessionId: RemoteWorkerOpaqueIdSchemaV1,
    clientLeaseId: RemoteWorkerOpaqueIdSchemaV1,
    idleTimeoutMs: z.number().int().positive().max(maxIdleTimeoutMs),
    maxOutputBytes: z.number().int().positive().max(maxOutputBytes),
    expectedEvidenceDigest: RemoteWorkerSha256DigestSchemaV1,
    expectedQualificationBundleDigest: RemoteWorkerSha256DigestSchemaV1,
    expectedProviderCohortDigest: RemoteWorkerSha256DigestSchemaV1,
    expectedImageDigest: RemoteWorkerSha256DigestSchemaV1,
  })
  .strict();

export type RemoteWorkerCreateRequestV1 = z.infer<
  typeof RemoteWorkerCreateRequestSchemaV1
>;

export const RemoteWorkerBindingReceiptPayloadSchemaV1 = z
  .object({
    protocolVersion: z.literal(REMOTE_WORKER_PROTOCOL_VERSION),
    workspaceId: RemoteWorkerOpaqueIdSchemaV1,
    clientLeaseId: RemoteWorkerOpaqueIdSchemaV1,
    workerId: RemoteWorkerOpaqueIdSchemaV1,
    sandboxId: RemoteWorkerOpaqueIdSchemaV1,
    requestDigest: RemoteWorkerSha256DigestSchemaV1,
    expiresAtMs: z.number().int().positive(),
  })
  .strict();

export type RemoteWorkerBindingReceiptPayloadV1 = z.infer<
  typeof RemoteWorkerBindingReceiptPayloadSchemaV1
>;

export const RemoteWorkerBindingReceiptSchemaV1 = z
  .object({
    payload: RemoteWorkerBindingReceiptPayloadSchemaV1,
    authenticator: z.string().min(16).max(4096),
  })
  .strict();

export type RemoteWorkerBindingReceiptV1 = z.infer<
  typeof RemoteWorkerBindingReceiptSchemaV1
>;

export const RemoteWorkerCreateResponseSchemaV1 = z
  .object({
    protocolVersion: z.literal(REMOTE_WORKER_PROTOCOL_VERSION),
    providerContractVersion: z.literal(PROVIDER_CONTRACT_VERSION),
    workerId: RemoteWorkerOpaqueIdSchemaV1,
    sandboxId: RemoteWorkerOpaqueIdSchemaV1,
    runtimeCwd: z.literal(REMOTE_WORKER_RUNTIME_CWD),
    leaseExpiresAtMs: z.number().int().positive(),
    bindingReceipt: RemoteWorkerBindingReceiptSchemaV1,
  })
  .strict();

export type RemoteWorkerCreateResponseV1 = z.infer<
  typeof RemoteWorkerCreateResponseSchemaV1
>;

const RemoteWorkerStatSchemaV1 = z
  .object({
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().finite(),
    kind: z.enum(["file", "dir"]),
  })
  .strict();

const RemoteWorkerEntrySchemaV1 = z
  .object({
    name: z.string().min(1).max(1024),
    kind: z.enum(["file", "dir"]),
  })
  .strict();

const workspacePath = z.string().max(4096);

export const RemoteWorkerWorkspaceOperationSchemaV1 = z.discriminatedUnion(
  "op",
  [
    z.object({ op: z.literal("readFile"), path: workspacePath }).strict(),
    z.object({ op: z.literal("readBinaryFile"), path: workspacePath }).strict(),
    z
      .object({
        op: z.literal("writeFile"),
        path: workspacePath,
        data: z.string().max(maxTransferChars),
      })
      .strict(),
    z
      .object({
        op: z.literal("writeBinaryFile"),
        path: workspacePath,
        dataBase64: z.string().max(maxTransferChars),
      })
      .strict(),
    z
      .object({ op: z.literal("readFileWithStat"), path: workspacePath })
      .strict(),
    z
      .object({
        op: z.literal("writeFileWithStat"),
        path: workspacePath,
        data: z.string().max(maxTransferChars),
      })
      .strict(),
    z
      .object({
        op: z.literal("writeBinaryFileWithStat"),
        path: workspacePath,
        dataBase64: z.string().max(maxTransferChars),
      })
      .strict(),
    z.object({ op: z.literal("unlink"), path: workspacePath }).strict(),
    z.object({ op: z.literal("readdir"), path: workspacePath }).strict(),
    z.object({ op: z.literal("stat"), path: workspacePath }).strict(),
    z
      .object({
        op: z.literal("mkdir"),
        path: workspacePath,
        recursive: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        op: z.literal("rename"),
        from: workspacePath,
        to: workspacePath,
      })
      .strict(),
  ],
);

export type RemoteWorkerWorkspaceOperationV1 = z.infer<
  typeof RemoteWorkerWorkspaceOperationSchemaV1
>;

export const RemoteWorkerWorkspaceResultSchemaV1 = z.union([
  z.object({ content: z.string().max(maxTransferChars) }).strict(),
  z.object({ dataBase64: z.string().max(maxTransferChars) }).strict(),
  z.object({ stat: RemoteWorkerStatSchemaV1 }).strict(),
  z
    .object({
      content: z.string().max(maxTransferChars),
      stat: RemoteWorkerStatSchemaV1,
    })
    .strict(),
  z
    .object({ entries: z.array(RemoteWorkerEntrySchemaV1).max(100_000) })
    .strict(),
  z.object({ ok: z.literal(true) }).strict(),
]);

export type RemoteWorkerWorkspaceResultV1 = z.infer<
  typeof RemoteWorkerWorkspaceResultSchemaV1
>;

const RemoteWorkerEnvSchemaV1 = z
  .record(z.string().regex(envNamePattern), z.string().max(64 * 1024))
  .superRefine((env, context) => {
    if (Object.keys(env).length > 128) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "too many env entries",
      });
    }
  });

export const RemoteWorkerSecretEnvEntrySchemaV1 = z
  .object({
    name: z.string().regex(envNamePattern),
    value: z.string().max(64 * 1024),
    reference: InvocationSecretReferenceSchemaV1,
  })
  .strict();

export type RemoteWorkerSecretEnvEntryV1 = z.infer<
  typeof RemoteWorkerSecretEnvEntrySchemaV1
>;

export const RemoteWorkerExecRequestSchemaV1 = z
  .object({
    invocationId: RemoteWorkerOpaqueIdSchemaV1,
    command: z
      .string()
      .min(1)
      .max(64 * 1024),
    cwd: z.string().min(1).max(4096).optional(),
    env: RemoteWorkerEnvSchemaV1.optional(),
    secretEnv: z.array(RemoteWorkerSecretEnvEntrySchemaV1).max(32).optional(),
    timeoutMs: z.number().int().positive().max(maxInvocationTimeoutMs),
    maxOutputBytes: z.number().int().positive().max(maxOutputBytes),
  })
  .strict();

export type RemoteWorkerExecRequestV1 = z.infer<
  typeof RemoteWorkerExecRequestSchemaV1
>;

export const RemoteWorkerExecResponseSchemaV1 = z
  .object({
    stdoutBase64: z.string().max(maxTransferChars),
    stderrBase64: z.string().max(maxTransferChars),
    exitCode: z.number().int(),
    durationMs: z.number().nonnegative(),
    truncated: z.boolean(),
    stdoutEncoding: z.enum(["utf-8", "binary"]).optional(),
    stderrEncoding: z.enum(["utf-8", "binary"]).optional(),
  })
  .strict();

export type RemoteWorkerExecResponseV1 = z.infer<
  typeof RemoteWorkerExecResponseSchemaV1
>;

export const RemoteWorkerRenewRequestSchemaV1 = z
  .object({ idleTimeoutMs: z.number().int().positive().max(maxIdleTimeoutMs) })
  .strict();

export type RemoteWorkerRenewRequestV1 = z.infer<
  typeof RemoteWorkerRenewRequestSchemaV1
>;

export const RemoteWorkerRenewResponseSchemaV1 = z
  .object({ leaseExpiresAtMs: z.number().int().positive() })
  .strict();

export type RemoteWorkerRenewResponseV1 = z.infer<
  typeof RemoteWorkerRenewResponseSchemaV1
>;

export const RemoteWorkerDeleteResponseSchemaV1 = z
  .object({ disposed: z.literal(true) })
  .strict();

export const RemoteWorkerFsEventSchemaV1 = z
  .object({
    op: z.enum(["write", "unlink", "rename", "mkdir"]),
    path: workspacePath,
    oldPath: workspacePath.optional(),
    mtimeMs: z.number().finite().optional(),
  })
  .strict();

export const RemoteWorkerFsEventEnvelopeSchemaV1 = z
  .object({ event: RemoteWorkerFsEventSchemaV1 })
  .strict();

export type RemoteWorkerFsEventEnvelopeV1 = z.infer<
  typeof RemoteWorkerFsEventEnvelopeSchemaV1
>;

export const RemoteWorkerErrorPayloadSchemaV1 = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1).max(1024),
        retryable: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export type RemoteWorkerErrorPayloadV1 = z.infer<
  typeof RemoteWorkerErrorPayloadSchemaV1
>;
