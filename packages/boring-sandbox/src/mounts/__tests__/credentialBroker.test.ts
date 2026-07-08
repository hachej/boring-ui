import { inspect } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  EU_S3_ENDPOINTS,
  brokerMountCredentials,
  createPrefixScopedPolicy,
  isListPrefixAllowedByMountPolicy,
  isObjectKeyAllowedByMountPolicy,
  prepareMountCredentialEnv,
} from "../credentialBroker";
import type { MountCredentialMintRequest } from "../credentialBroker";
import type { MountEndpoint } from "../credentialBroker";

describe("mount credential broker", () => {
  it("mints a short-lived prefix-scoped host-side handle that does not serialize secrets", async () => {
    const mintMountCredential = vi.fn(async (request: MountCredentialMintRequest) => ({
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "super-secret-value",
      sessionToken: "session-secret-value",
      expiresAt: request.expiresAt,
      credentialProcessCommand: "/usr/local/bin/refresh-mount-credential",
    }));

    const handle = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: { mintMountCredential },
      now: new Date("2026-07-08T00:00:00.000Z"),
      ttlSeconds: 120,
    });

    expect(mintMountCredential).toHaveBeenCalledTimes(1);
    const request = mintMountCredential.mock.calls[0][0];
    expect(request.prefix).toBe("workspaces/ws-1");
    expect(isObjectKeyAllowedByMountPolicy(request.policy, "workspace-bucket", "workspaces/ws-1/src/index.ts")).toBe(true);
    expect(isObjectKeyAllowedByMountPolicy(request.policy, "workspace-bucket", "workspaces/ws-2/src/index.ts")).toBe(false);
    expect(isListPrefixAllowedByMountPolicy(request.policy, "workspace-bucket", "workspaces/ws-1/")).toBe(true);
    expect(isListPrefixAllowedByMountPolicy(request.policy, "workspace-bucket", "workspaces/ws-1/src/")).toBe(true);
    expect(isListPrefixAllowedByMountPolicy(request.policy, "workspace-bucket", "workspaces/ws-1")).toBe(false);
    expect(isListPrefixAllowedByMountPolicy(request.policy, "workspace-bucket", "workspaces/ws-10/")).toBe(false);
    expect(isListPrefixAllowedByMountPolicy(request.policy, "workspace-bucket", "workspaces/ws-1-copy/")).toBe(false);
    expect(JSON.stringify(handle)).not.toContain("super-secret-value");
    expect(JSON.stringify(handle)).not.toContain("session-secret-value");
    expect(inspect(handle)).not.toContain("super-secret-value");
  });

  it("omits write and delete actions for read-only mount credentials", async () => {
    const mintMountCredential = vi.fn(async (request: MountCredentialMintRequest) => ({
      accessKeyId: "AKIA_READONLY",
      secretAccessKey: "readonly-secret-value",
      expiresAt: request.expiresAt,
      credentialProcessCommand: "/usr/local/bin/refresh-readonly-mount-credential",
    }));

    const handle = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      accessMode: "read-only",
      access: { mintMountCredential },
    });

    const request = mintMountCredential.mock.calls[0][0];
    const objectStatement = request.policy.Statement.find((statement) => statement.Resource === "arn:aws:s3:::workspace-bucket/workspaces/ws-1/*");
    expect(request.accessMode).toBe("read-only");
    expect(handle.accessMode).toBe("read-only");
    expect(objectStatement?.Action).toEqual(["s3:GetObject"]);
    expect(JSON.stringify(request.policy)).not.toContain("s3:PutObject");
    expect(JSON.stringify(request.policy)).not.toContain("s3:DeleteObject");
  });

  it("keeps write actions for readwrite mount credentials", () => {
    const policy = createPrefixScopedPolicy("workspace-bucket", "workspaces/ws-1", "readwrite");
    expect(JSON.stringify(policy)).toContain("s3:PutObject");
    expect(JSON.stringify(policy)).not.toContain("s3:PutObjectAcl");
    expect(JSON.stringify(policy)).toContain("s3:DeleteObject");
    expect(JSON.stringify(policy)).toContain("s3:AbortMultipartUpload");
    expect(JSON.stringify(policy)).toContain("s3:ListMultipartUploadParts");
    expect(JSON.stringify(policy)).toContain("s3:ListBucketMultipartUploads");
  });

  it("fails closed on unknown credential access modes", async () => {
    expect(() => createPrefixScopedPolicy("workspace-bucket", "workspaces/ws-1", "readonly" as never))
      .toThrow("mount access mode");

    const mintMountCredential = vi.fn(async (request: MountCredentialMintRequest) => ({
      accessKeyId: "AKIA_BAD_MODE",
      secretAccessKey: "bad-mode-secret",
      expiresAt: request.expiresAt,
      credentialProcessCommand: "/usr/local/bin/refresh-bad-mode",
    }));

    await expect(brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      accessMode: "readonly" as never,
      access: { mintMountCredential },
    })).rejects.toMatchObject({ code: "unsupported-mount-mode" });
    expect(mintMountCredential).not.toHaveBeenCalled();
  });

  it("caps requested credential TTL and rejects issuer tokens beyond the cap", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const mintMountCredential = vi.fn(async (request: MountCredentialMintRequest) => ({
      accessKeyId: "AKIA_TTL",
      secretAccessKey: "ttl-secret",
      expiresAt: request.expiresAt,
      credentialProcessCommand: "/usr/local/bin/refresh-ttl",
    }));

    const handle = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      ttlSeconds: 24 * 60 * 60,
      now,
      access: { mintMountCredential },
    });

    expect(handle.expiresAt.toISOString()).toBe("2026-07-08T01:00:00.000Z");
    expect(mintMountCredential.mock.calls[0][0].expiresAt.toISOString()).toBe("2026-07-08T01:00:00.000Z");

    await expect(brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      ttlSeconds: 120,
      now,
      access: {
        async mintMountCredential() {
          return {
            accessKeyId: "AKIA_TOO_LONG",
            secretAccessKey: "too-long-secret",
            expiresAt: new Date("2026-07-08T02:00:00.000Z"),
            credentialProcessCommand: "/usr/local/bin/refresh-too-long",
          };
        },
      },
    })).rejects.toMatchObject({ code: "mount-unavailable" });
  });

  it("copies and freezes endpoint scope metadata on the handle", async () => {
    const endpoint: MountEndpoint = { ...EU_S3_ENDPOINTS.minio };
    const handle = await brokerMountCredentials({
      endpoint,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-1",
          };
        },
      },
    });

    endpoint.url = "https://evil.example";

    expect(handle.endpoint.url).toBe(EU_S3_ENDPOINTS.minio.url);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.endpoint)).toBe(true);
  });

  it("injects credentials only through the mount-process env and writes credential_process config", async () => {
    const handle = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.scaleway,
      bucket: "workspace-bucket",
      prefix: "tenants/acme/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "SCW_ACCESS",
            secretAccessKey: "scw-secret-value",
            sessionToken: "scw-session-token",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-1",
          };
        },
      },
    });
    const credentialProcessDir = await mkdtemp(join(tmpdir(), "boring-sandbox-credential-process-"));

    const env = await prepareMountCredentialEnv(handle, { credentialProcessDir });

    expect(env).toMatchObject({
      AWS_CONFIG_FILE: expect.stringContaining(credentialProcessDir),
      AWS_SHARED_CREDENTIALS_FILE: expect.stringContaining(credentialProcessDir),
      AWS_PROFILE: "default",
      AWS_SDK_LOAD_CONFIG: "1",
      AWS_EC2_METADATA_DISABLED: "true",
    });
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    const config = await readFile(env.AWS_CONFIG_FILE, "utf8");
    expect(config).toContain("credential_process = /opt/boring/bin/refresh-rclone-creds --handle mount-1");
    expect(config).not.toContain("scw-secret-value");
    const credentials = await readFile(env.AWS_SHARED_CREDENTIALS_FILE, "utf8");
    expect(credentials).toBe("");
  });

  it("rejects IAM wildcard characters before creating a prefix-scoped policy", () => {
    expect(() => createPrefixScopedPolicy("workspace-bucket", "workspaces/ws-*")).toThrow("wildcard");
    expect(() => createPrefixScopedPolicy("workspace-bucket?", "workspaces/ws-1")).toThrow("wildcard");
  });

  it("rejects bucket names that can smuggle prefixes or are not S3-compatible", () => {
    expect(() => createPrefixScopedPolicy("workspace-bucket/tenant-b", "workspaces/ws-1")).toThrow("valid S3 bucket");
    expect(() => createPrefixScopedPolicy("Workspace-Bucket", "workspaces/ws-1")).toThrow("valid S3 bucket");
    expect(() => createPrefixScopedPolicy("workspace_bucket", "workspaces/ws-1")).toThrow("valid S3 bucket");
    expect(() => createPrefixScopedPolicy("192.168.0.1", "workspaces/ws-1")).toThrow("valid S3 bucket");
  });

  it("does not fall back to raw AWS env when credential_process is required without a private dir", async () => {
    const handle = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/boring/bin/refresh-rclone-creds --handle mount-1",
          };
        },
      },
    });

    await expect(prepareMountCredentialEnv(handle, { requireCredentialProcess: true }))
      .rejects.toThrow("credential_process refresh");
  });

  it("rejects credential_process commands with config-injection control characters", async () => {
    const handle = await brokerMountCredentials({
      endpoint: EU_S3_ENDPOINTS.minio,
      bucket: "workspace-bucket",
      prefix: "workspaces/ws-1",
      access: {
        async mintMountCredential(request: MountCredentialMintRequest) {
          return {
            accessKeyId: "MINIO_ACCESS",
            secretAccessKey: "minio-secret-value",
            expiresAt: request.expiresAt,
            credentialProcessCommand: "/opt/refresh\nrole_arn = arn:aws:iam::123:role/escape",
          };
        },
      },
    });
    const credentialProcessDir = await mkdtemp(join(tmpdir(), "boring-sandbox-credential-process-injection-"));

    await expect(prepareMountCredentialEnv(handle, { credentialProcessDir }))
      .rejects.toThrow("control character");
  });
});
