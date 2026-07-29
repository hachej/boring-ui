import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { PiSessionStore } from "../sessions.js";
import {
  acquireNativeSessionIdClaim,
  nativeSessionClaimPath,
  NATIVE_SESSION_CLAIM_TTL_MS,
  type NativeSessionIdClaim,
} from "../nativeSessionPersistence.js";

const tempDirs: string[] = [];

async function tempSessionDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "native-session-claim-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("native session id claims", () => {
  it("allows exactly one of two concurrent filesystem claimants to win", async () => {
    const sessionDir = await tempSessionDir();
    const sessionId = "123e4567-e89b-42d3-a456-426614174000";

    const claims = await Promise.all([
      acquireNativeSessionIdClaim(sessionDir, sessionId),
      acquireNativeSessionIdClaim(sessionDir, sessionId),
    ]);

    const winners = claims.filter((claim): claim is NativeSessionIdClaim => claim !== undefined);
    expect(winners).toHaveLength(1);
    expect(claims.filter((claim) => claim === undefined)).toHaveLength(1);

    await winners[0]!.release();
    expect(await readdir(sessionDir)).toEqual([]);
  });

  it("rejects a fresh claim and atomically reclaims a crashed claim after the bounded TTL", async () => {
    const sessionDir = await tempSessionDir();
    const sessionId = "stale-claim";
    const fresh = await acquireNativeSessionIdClaim(sessionDir, sessionId);
    expect(fresh).toBeDefined();
    await expect(acquireNativeSessionIdClaim(sessionDir, sessionId)).resolves.toBeUndefined();
    await fresh!.release();

    const claimPath = nativeSessionClaimPath(sessionDir, sessionId);
    await writeFile(claimPath, 'crashed-owner', { flag: 'wx' });
    const staleTime = new Date(Date.now() - NATIVE_SESSION_CLAIM_TTL_MS - 1_000);
    await utimes(claimPath, staleTime, staleTime);

    const [first, second] = await Promise.all([
      acquireNativeSessionIdClaim(sessionDir, sessionId),
      acquireNativeSessionIdClaim(sessionDir, sessionId),
    ]);
    const reclaimed = [first, second].filter((claim): claim is NativeSessionIdClaim => claim !== undefined);
    expect(reclaimed).toHaveLength(1);
    expect([first, second].filter((claim) => claim === undefined)).toHaveLength(1);
    await expect(acquireNativeSessionIdClaim(sessionDir, sessionId)).resolves.toBeUndefined();

    await reclaimed[0]!.release();
    expect(await readdir(sessionDir)).toEqual([]);
  });

  it("does not expose an active claim as a transcript or session summary", async () => {
    const sessionDir = await tempSessionDir();
    const claim = await acquireNativeSessionIdClaim(sessionDir, "hidden-claim");
    const store = new PiSessionStore("/workspace", { sessionDir, allowNativeUnscopedAccess: true });

    await expect(SessionManager.listAll(sessionDir)).resolves.toEqual([]);
    await expect(store.list({})).resolves.toEqual([]);
    expect((await readdir(sessionDir)).every((file) => !file.endsWith(".jsonl"))).toBe(true);

    await claim!.release();
  });

});
