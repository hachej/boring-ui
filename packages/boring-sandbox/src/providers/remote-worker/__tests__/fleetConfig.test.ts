import { describe, expect, test } from "vitest";

import { SandboxProviderError } from "../../../shared/providerV1";
import { REMOTE_WORKER_PROTOCOL_VERSION } from "../../../shared/remoteWorkerProtocolV1";
import {
  parseRemoteWorkerFleetConfigV1,
  remoteWorkerBucketForWorkspaceV1,
  resolveRemoteWorkerPlacementV1,
} from "../fleetConfig";

const digest = `sha256:${"a".repeat(64)}`;

function worker(workerId: string, buckets: number[]) {
  return {
    workerId,
    baseUrl: `https://${workerId}.example.test`,
    tokenFile: `/run/boring/${workerId}.token`,
    caFile: "/run/boring/fleet.ca",
    tlsServerName: `${workerId}.example.test`,
    expectedEvidenceDigest: digest,
    expectedQualificationBundleDigest: digest,
    expectedProviderCohortDigest: digest,
    expectedImageDigest: digest,
    buckets,
  };
}

function config(workers: unknown[]) {
  return {
    protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
    bucketCount: 256,
    workers,
  };
}

describe("remote-worker static fleet placement", () => {
  test("is total and deterministic without health-based fallback", () => {
    const fleet = parseRemoteWorkerFleetConfigV1(
      config([
        worker(
          "worker-a",
          Array.from({ length: 128 }, (_, index) => index),
        ),
        worker(
          "worker-b",
          Array.from({ length: 128 }, (_, index) => index + 128),
        ),
      ]),
    );

    const bucket = remoteWorkerBucketForWorkspaceV1("workspace-tenant-a");
    const first = resolveRemoteWorkerPlacementV1(fleet, "workspace-tenant-a");
    const second = resolveRemoteWorkerPlacementV1(fleet, "workspace-tenant-a");
    expect(first).toBe(second);
    expect(first.buckets).toContain(bucket);
    expect(Object.isFrozen(fleet)).toBe(true);
    expect(Object.isFrozen(fleet.workers)).toBe(true);
  });

  test("rejects missing, duplicate, unknown, insecure, and shared-token config", () => {
    const allBuckets = Array.from({ length: 256 }, (_, index) => index);
    const base = worker("worker-a", allBuckets);

    for (const invalid of [
      config([{ ...base, buckets: allBuckets.slice(1) }]),
      config([base, worker("worker-b", [0])]),
      config([{ ...base, unexpected: true }]),
      config([{ ...base, baseUrl: "http://worker-a.example.test" }]),
      config([
        { ...base, buckets: allBuckets.slice(0, 128) },
        {
          ...worker("worker-b", allBuckets.slice(128)),
          tokenFile: base.tokenFile,
        },
      ]),
    ]) {
      expect(() => parseRemoteWorkerFleetConfigV1(invalid)).toThrow(
        SandboxProviderError,
      );
    }
  });

  test("allows cleartext only for explicit loopback tests", () => {
    const allBuckets = Array.from({ length: 256 }, (_, index) => index);
    const loopback = config([
      {
        ...worker("worker-test", allBuckets),
        baseUrl: "http://127.0.0.1:4319",
        tlsServerName: "localhost",
      },
    ]);
    expect(() => parseRemoteWorkerFleetConfigV1(loopback)).toThrow();
    expect(
      parseRemoteWorkerFleetConfigV1(loopback, {
        allowInsecureLoopback: true,
      }).workers[0]?.baseUrl,
    ).toBe("http://127.0.0.1:4319");
  });
});
