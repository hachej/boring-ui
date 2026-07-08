import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";

export type MountEndpointProvider = "OVH" | "Scaleway" | "MinIO" | "AWS" | "Other";

export interface MountEndpoint {
  provider: MountEndpointProvider;
  url: string;
  region?: string;
}

export const EU_S3_ENDPOINTS = {
  minio: {
    provider: "MinIO",
    url: "http://127.0.0.1:9000",
    region: "eu-west-1",
  },
  scaleway: {
    provider: "Scaleway",
    url: "https://s3.fr-par.scw.cloud",
    region: "fr-par",
  },
  ovh: {
    provider: "OVH",
    url: "https://s3.gra.io.cloud.ovh.net",
    region: "gra",
  },
} as const satisfies Record<string, MountEndpoint>;

export const DEFAULT_MOUNT_ENDPOINT = EU_S3_ENDPOINTS.minio;

export interface PrefixScopedPolicy {
  Version: "2012-10-17";
  Statement: Array<{
    Effect: "Allow";
    Action: string | string[];
    Resource: string | string[];
    Condition?: Record<string, Record<string, string | string[]>>;
  }>;
}

export interface MountCredentialToken {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt: Date;
  credentialProcessCommand?: string;
}

export interface MountCredentialMintRequest {
  endpoint: MountEndpoint;
  bucket: string;
  prefix: string;
  accessMode: MountCredentialAccessMode;
  policy: PrefixScopedPolicy;
  expiresAt: Date;
}

export interface MountCredentialAccess {
  mintMountCredential(request: MountCredentialMintRequest): Promise<MountCredentialToken>;
}

export interface BrokerMountCredentialsSpec {
  endpoint: MountEndpoint;
  bucket: string;
  prefix: string;
  accessMode?: MountCredentialAccessMode;
  access: MountCredentialAccess;
  ttlSeconds?: number;
  now?: Date;
}

export type MountCredentialAccessMode = "read-only" | "readwrite";

export interface MountCredentialHandle {
  readonly id: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly endpoint: MountEndpoint;
  readonly accessMode: MountCredentialAccessMode;
  readonly expiresAt: Date;
  readonly policy: PrefixScopedPolicy;
  toJSON(): Record<string, unknown>;
}

const MIN_TTL_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 60 * 60;
const credentialTokens = new WeakMap<MountCredentialHandle, MountCredentialToken>();

const inspectCustom = inspect.custom;
const IAM_WILDCARD_PATTERN = /[*?]/;
const S3_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const IPV4_ADDRESS_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export class MountCredentialBrokerError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "MountCredentialBrokerError";
    this.code = code;
  }
}

export function validateMountCredentialAccessMode(accessMode: unknown): MountCredentialAccessMode {
  if (accessMode === "read-only" || accessMode === "readwrite") {
    return accessMode;
  }
  throw new MountCredentialBrokerError("mount access mode must be read-only or readwrite", "unsupported-mount-mode");
}

function validateCredentialProcessCommand(command: string): string {
  if (command.includes("\0") || command.includes("\n") || command.includes("\r")) {
    throw new MountCredentialBrokerError("credential_process command contains an invalid control character", "mount-unavailable");
  }
  return command;
}

export function normalizeMountPrefix(prefix: string): string {
  const normalized = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.length === 0) {
    throw new MountCredentialBrokerError("mount prefix must not be the bucket root", "path-outside-prefix");
  }
  if (normalized.includes("\0") || normalized.includes("\n") || normalized.includes("\r")) {
    throw new MountCredentialBrokerError("mount prefix contains an invalid character", "path-outside-prefix");
  }
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new MountCredentialBrokerError("mount prefix must not contain traversal segments", "path-outside-prefix");
  }
  if (IAM_WILDCARD_PATTERN.test(normalized)) {
    throw new MountCredentialBrokerError("mount prefix must not contain IAM wildcard characters", "path-outside-prefix");
  }
  return normalized;
}

export function validateMountBucket(bucket: string): string {
  if (IAM_WILDCARD_PATTERN.test(bucket)) {
    throw new MountCredentialBrokerError("mount bucket must not contain IAM wildcard characters", "path-outside-prefix");
  }
  if (!S3_BUCKET_PATTERN.test(bucket)
    || bucket.includes("..")
    || bucket.includes(".-")
    || bucket.includes("-.")
    || IPV4_ADDRESS_PATTERN.test(bucket)) {
    throw new MountCredentialBrokerError("mount bucket must be a valid S3 bucket name", "path-outside-prefix");
  }
  return bucket;
}

export function createPrefixScopedPolicy(
  bucket: string,
  prefix: string,
  accessMode: MountCredentialAccessMode = "readwrite",
): PrefixScopedPolicy {
  const validatedBucket = validateMountBucket(bucket);
  const normalizedPrefix = normalizeMountPrefix(prefix);
  const validatedAccessMode = validateMountCredentialAccessMode(accessMode);
  const objectArn = `arn:aws:s3:::${validatedBucket}/${normalizedPrefix}/*`;
  const bucketArn = `arn:aws:s3:::${validatedBucket}`;
  const listPrefix = `${normalizedPrefix}/`;
  const listPrefixGlob = `${normalizedPrefix}/*`;
  const objectActions = validatedAccessMode === "read-only"
    ? ["s3:GetObject"]
    : [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ];
  const bucketActions = validatedAccessMode === "read-only"
    ? "s3:ListBucket"
    : ["s3:ListBucket", "s3:ListBucketMultipartUploads"];

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: bucketActions,
        Resource: bucketArn,
        Condition: {
          StringLike: {
            "s3:prefix": [listPrefix, listPrefixGlob],
          },
        },
      },
      {
        Effect: "Allow",
        Action: objectActions,
        Resource: objectArn,
      },
    ],
  };
}

export function isObjectKeyAllowedByMountPolicy(policy: PrefixScopedPolicy, bucket: string, key: string): boolean {
  const objectArn = `arn:aws:s3:::${bucket}/${key}`;
  return policy.Statement.some((statement) => {
    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
    return resources.some((resource) => resource.endsWith("/*") && objectArn.startsWith(resource.slice(0, -1)));
  });
}

export function isListPrefixAllowedByMountPolicy(policy: PrefixScopedPolicy, bucket: string, prefix: string): boolean {
  const bucketArn = `arn:aws:s3:::${bucket}`;
  return policy.Statement.some((statement) => {
    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
    if (!actions.includes("s3:ListBucket") || statement.Resource !== bucketArn) return false;
    const allowed = statement.Condition?.StringLike?.["s3:prefix"];
    const allowedPrefixes = Array.isArray(allowed) ? allowed : allowed ? [allowed] : [];
    return allowedPrefixes.some((allowedPrefix) => {
      if (allowedPrefix.endsWith("*")) {
        return prefix.startsWith(allowedPrefix.slice(0, -1));
      }
      return prefix === allowedPrefix;
    });
  });
}

export async function brokerMountCredentials(spec: BrokerMountCredentialsSpec): Promise<MountCredentialHandle> {
  const prefix = normalizeMountPrefix(spec.prefix);
  validateMountBucket(spec.bucket);
  const ttlSeconds = Math.min(Math.max(spec.ttlSeconds ?? DEFAULT_TTL_SECONDS, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
  const now = spec.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const accessMode = validateMountCredentialAccessMode(spec.accessMode ?? "readwrite");
  const endpoint = Object.freeze({ ...spec.endpoint });
  const policy = createPrefixScopedPolicy(spec.bucket, prefix, accessMode);
  const token = await spec.access.mintMountCredential({
    endpoint,
    bucket: spec.bucket,
    prefix,
    accessMode,
    policy,
    expiresAt,
  });
  if (token.expiresAt.getTime() > expiresAt.getTime()) {
    throw new MountCredentialBrokerError("mount credential issuer returned a token beyond the allowed TTL", "mount-unavailable");
  }

  const handle = Object.freeze({
    id: `mount-cred-${randomUUID()}`,
    bucket: spec.bucket,
    prefix,
    endpoint,
    accessMode,
    expiresAt: token.expiresAt,
    policy,
    toJSON() {
      return {
        type: "MountCredentialHandle",
        id: this.id,
        bucket: this.bucket,
        prefix: this.prefix,
        accessMode: this.accessMode,
        expiresAt: this.expiresAt.toISOString(),
        redacted: true,
      };
    },
    [inspectCustom]() {
      return `MountCredentialHandle<${this.id}, redacted>`;
    },
  }) satisfies MountCredentialHandle & { [inspectCustom](): string };

  credentialTokens.set(handle, token);
  return handle;
}

export interface PrepareMountCredentialEnvOptions {
  credentialProcessDir?: string;
  requireCredentialProcess?: boolean;
}

export async function prepareMountCredentialEnv(
  handle: MountCredentialHandle,
  options: PrepareMountCredentialEnvOptions = {},
): Promise<Record<string, string>> {
  const token = credentialTokens.get(handle);
  if (!token) {
    throw new MountCredentialBrokerError("unknown mount credential handle", "mount-unavailable");
  }

  const env: Record<string, string> = {
    AWS_REGION: handle.endpoint.region ?? "eu-west-1",
  };

  if (options.requireCredentialProcess && (!token.credentialProcessCommand || !options.credentialProcessDir)) {
    throw new MountCredentialBrokerError("mount credentials require credential_process refresh", "mount-unavailable");
  }

  if (token.credentialProcessCommand && options.credentialProcessDir) {
    const credentialProcessCommand = validateCredentialProcessCommand(token.credentialProcessCommand);
    await mkdir(options.credentialProcessDir, { recursive: true, mode: 0o700 });
    const configPath = join(options.credentialProcessDir, "aws-config");
    await writeFile(
      configPath,
      `[default]\ncredential_process = ${credentialProcessCommand}\n`,
      { mode: 0o600 },
    );
    const credentialsPath = join(options.credentialProcessDir, "aws-credentials");
    await writeFile(credentialsPath, "", { mode: 0o600 });
    env.AWS_CONFIG_FILE = configPath;
    env.AWS_SHARED_CREDENTIALS_FILE = credentialsPath;
    env.AWS_PROFILE = "default";
    env.AWS_SDK_LOAD_CONFIG = "1";
    env.AWS_EC2_METADATA_DISABLED = "true";
  } else if (token.credentialProcessCommand) {
    throw new MountCredentialBrokerError("credential_process requires a private config directory", "mount-unavailable");
  } else {
    env.AWS_ACCESS_KEY_ID = token.accessKeyId;
    env.AWS_SECRET_ACCESS_KEY = token.secretAccessKey;
    env.AWS_SESSION_TOKEN = token.sessionToken ?? "";
  }

  return env;
}
