import { describe, expect, test } from "vitest";

import { canonicalJson, remoteWorkerRequestDigestV1 } from "../requestDigest";

describe("remote-worker canonical request digests", () => {
  test("stabilizes Date-bearing bodies across property insertion order", () => {
    const when = new Date("2026-07-22T10:00:00.000Z");
    const first = { when, workspaceId: "workspace-a", nested: { b: 2, a: 1 } };
    const second = {
      nested: { a: 1, b: 2 },
      workspaceId: "workspace-a",
      when: new Date(when.getTime()),
    };

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(remoteWorkerRequestDigestV1(first)).toBe(
      remoteWorkerRequestDigestV1(second),
    );
    expect(canonicalJson(first)).toContain(when.toISOString());
  });

  test("rejects cyclic and bigint request bodies", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow();
    expect(() => remoteWorkerRequestDigestV1(1n)).toThrow();
  });
});
