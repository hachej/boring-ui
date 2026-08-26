import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiSessionStore } from "../sessions.js";

/**
 * Reproduces issue #1338's shape: one session store holding hundreds of native
 * Pi transcripts. `summarizeNativeTranscript` streams and JSON-parses a whole
 * transcript per session and its result is deliberately never cached, so an
 * unbounded `list()` pays the entire store on every request. A bounded page must
 * pay only for the page.
 *
 * Off by default (it writes ~100 MB of fixtures); run with `BENCH_1338=1`.
 */
const enabled = process.env.BENCH_1338 === "1";
const SESSIONS = Number(process.env.BENCH_SESSIONS ?? 600);
const MESSAGES = Number(process.env.BENCH_MESSAGES ?? 120);

function buildStore(): { root: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-sessions-perf-"));
  const cwd = join(root, "workspace");
  const dir = join(root, `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
  mkdirSync(dir, { recursive: true });
  const body = "x".repeat(1200);
  for (let index = 0; index < SESSIONS; index += 1) {
    const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    const base = Date.UTC(2026, 7, 1) + index * 60_000;
    const iso = new Date(base).toISOString();
    const lines = [JSON.stringify({ type: "session", version: 1, id, timestamp: iso, cwd })];
    for (let message = 0; message < MESSAGES; message += 1) {
      lines.push(JSON.stringify({
        type: "message",
        id: `${id}-m${message}`,
        parentId: null,
        timestamp: new Date(base + message * 1000).toISOString(),
        message: {
          role: message % 2 === 0 ? "user" : "assistant",
          content: [{ type: "text", text: `message ${message} ${body}` }],
        },
      }));
    }
    writeFileSync(join(dir, `${iso.replace(/[:.]/g, "-")}_${id}.jsonl`), `${lines.join("\n")}\n`);
  }
  return { root, cwd };
}

describe.skipIf(!enabled)("PiSessionStore.list pagination cost", () => {
  it("pays for the page, not the store", async () => {
    const { root, cwd } = buildStore();
    const ctx = { workspaceId: "perf-workspace" };
    const measure = async (options?: { limit: number }) => {
      // Fresh store per case: cold caches, exactly like a fresh host boot.
      const store = new PiSessionStore(cwd, { sessionRoot: root, storageCwd: cwd });
      const started = performance.now();
      const rows = await store.list(ctx, options);
      return { ms: performance.now() - started, rows: rows.length };
    };

    // Warm re-list on the SAME store instance: the shape a live host serves
    // after boot, where the prefix cache is already populated.
    const warm = async () => {
      const store = new PiSessionStore(cwd, { sessionRoot: root, storageCwd: cwd });
      await store.list(ctx, { limit: 50 });
      const started = performance.now();
      const rows = await store.list(ctx, { limit: 50 });
      return { ms: performance.now() - started, rows: rows.length };
    };

    const unbounded = await measure();
    const paged = await measure({ limit: 50 });
    const warmed = await warm();
    process.stdout.write(
      `[#1338] sessions=${SESSIONS} messages=${MESSAGES}`
      + ` unbounded=${unbounded.ms.toFixed(0)}ms (${unbounded.rows} rows)`
      + ` cold-limit50=${paged.ms.toFixed(0)}ms (${paged.rows} rows)`
      + ` warm-limit50=${warmed.ms.toFixed(0)}ms (${warmed.rows} rows)\n`,
    );

    expect(unbounded.rows).toBe(SESSIONS);
    expect(paged.rows).toBe(50);
    expect(warmed.rows).toBe(50);
    expect(paged.ms).toBeLessThan(unbounded.ms / 2);
    expect(warmed.ms).toBeLessThan(paged.ms);
  }, 600_000);
});
