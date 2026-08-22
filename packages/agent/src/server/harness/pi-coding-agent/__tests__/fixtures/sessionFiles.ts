import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionCtx } from "../../../../../shared/session.js";

/**
 * Pi's CURRENT_SESSION_VERSION, inlined because several suites mock the whole
 * `@mariozechner/pi-coding-agent` module. `singleTranscript.test.ts` asserts
 * this stays equal to pi's real export, so drift fails loudly.
 */
export const SEEDED_SESSION_VERSION = 3;

/**
 * Test-side mirror of the ONE file `PiSessionStore.create` writes: pi's own
 * `${timestamp}_${id}.jsonl` transcript carrying Boring's tenancy pin. Tests
 * that need a specific session id (which `create()` mints itself) seed it here
 * instead of hand-rolling the legacy `${id}.jsonl` wrapper, which no longer
 * exists for server-minted sessions.
 */
export async function seedNativeSession(
  sessionDir: string,
  cwd: string,
  sessionId: string,
  ctx: SessionCtx,
  options?: { timestamp?: string },
): Promise<string> {
  await mkdir(sessionDir, { recursive: true });
  const timestamp = options?.timestamp ?? new Date().toISOString();
  const filepath = join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
  const header = {
    type: "session",
    version: SEEDED_SESSION_VERSION,
    id: sessionId,
    timestamp,
    cwd,
    boringSessionCtx: ctx,
  };
  await writeFile(filepath, `${JSON.stringify(header)}\n`, "utf-8");
  return filepath;
}

/** Resolves the single transcript for a session id, whatever its filename. */
export async function sessionFilePath(sessionDir: string, sessionId: string): Promise<string> {
  const files = await readdir(sessionDir);
  const match = files.find((file) => file.endsWith(`_${sessionId}.jsonl`) || file === `${sessionId}.jsonl`);
  if (!match) throw new Error(`no transcript for ${sessionId} in ${sessionDir}`);
  return join(sessionDir, match);
}

/**
 * Simulates the tenancy pin that a transcript carries when pi creates it for
 * us. Production no longer does this — `PiSessionStore.create` writes the
 * pinned transcript itself and the harness only ever opens it — but tests that
 * drive pi's `SessionManager` directly still need to mirror the shape a real
 * session has. `getHeader()` returns pi's LIVE header object, so mutating it
 * before pi's lazy first flush lands the pin in the file pi eventually writes.
 */
export function pinSessionCtxOnHeaderForTest(header: object | null | undefined, ctx: SessionCtx): void {
  if (!header || typeof header !== "object") throw new Error("pi session header is unavailable")
  ;(header as { boringSessionCtx?: Record<string, string> }).boringSessionCtx = {
    ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }
}
