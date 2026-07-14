import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  parseSessionEntries,
  SessionManager,
  type CustomEntry,
  type SessionInfoEntry,
  type SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { PiSessionStore } from "../sessions.js";

const EXPECTED_PI_PACKAGE_VERSION = "0.80.3";
const COMPAT_TITLE = "Boring #747 native title";
const FILE_NOT_FOUND_CODE = "ENOENT";

function piPackageRoot(): string {
  const entrypoint = new URL(import.meta.resolve("@mariozechner/pi-coding-agent"));
  return dirname(dirname(entrypoint.pathname));
}

async function readResolvedPiPackageVersion(): Promise<{ packageRoot: string; version: string }> {
  const packageRoot = piPackageRoot();
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf-8")) as { version?: string };
  return { packageRoot, version: packageJson.version ?? "" };
}

async function readSessionEntries(path: string) {
  return parseSessionEntries(await readFile(path, "utf-8"));
}

async function runPiResumeUntilOutputContains(args: {
  cwd: string;
  sessionDir: string;
  expected: string;
}): Promise<{ output: string; exitCode: number | null; signal: NodeJS.Signals | null }> {
  const cliPath = join(piPackageRoot(), "dist", "cli.js");
  const child = spawn(process.execPath, [cliPath, "--offline", "--session-dir", args.sessionDir, "--resume"], {
    cwd: args.cwd,
    env: {
      ...process.env,
      PI_OFFLINE: "1",
      TERM: process.env.TERM || "xterm-256color",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();

  let output = "";
  let settled = false;
  const maybeStop = () => {
    if (!settled && output.includes(args.expected)) {
      settled = true;
      child.kill("SIGTERM");
    }
  };
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf-8");
    maybeStop();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf-8");
    maybeStop();
  });

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      child.kill("SIGTERM");
    }
  }, 5_000);

  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  clearTimeout(timeout);
  return { output, ...result };
}

describe("Pi SDK native session compatibility (#747)", () => {
  it("uses the resolved Pi SDK version declared for packages/agent", async () => {
    const resolved = await readResolvedPiPackageVersion();
    expect(resolved.packageRoot).toContain("@earendil-works+pi-coding-agent@0.80.3");
    expect(resolved.version).toBe(EXPECTED_PI_PACKAGE_VERSION);
  });

  it("creates/recreates a chosen native ID, retains pre-materialization metadata, and materializes one native transcript", async () => {
    const runtimeCwd = await mkdtemp(join(tmpdir(), "boring-pi-runtime-"));
    const sessionRoot = await mkdtemp(join(tmpdir(), "boring-pi-session-root-"));
    const store = new PiSessionStore(runtimeCwd, { sessionRoot, storageCwd: runtimeCwd });
    const nativeSessionDir = store.getSessionDir();
    const chosenId = "compat_747_native_id";

    try {
      const firstHandle = SessionManager.create(runtimeCwd, nativeSessionDir, { id: chosenId });
      expect(firstHandle.getSessionId()).toBe(chosenId);
      expect(firstHandle.getSessionFile()).toContain(chosenId);
      await expect(stat(firstHandle.getSessionFile()!)).rejects.toMatchObject({ code: FILE_NOT_FOUND_CODE });

      const sessionManager = SessionManager.create(runtimeCwd, nativeSessionDir, { id: chosenId });
      expect(sessionManager.getSessionId()).toBe(chosenId);
      expect(sessionManager.getSessionFile()).toContain(chosenId);

      const markerId = sessionManager.appendCustomEntry("boring.compat.prompt_intent", {
        issue: 747,
        operationId: "op-compat-747",
        idempotencyKey: "idem-compat-747",
        promptHash: "sha256:compat-747",
      });
      const titleId = sessionManager.appendSessionInfo(COMPAT_TITLE);
      expect(sessionManager.getSessionName()).toBe(COMPAT_TITLE);
      await expect(stat(sessionManager.getSessionFile()!)).rejects.toMatchObject({ code: FILE_NOT_FOUND_CODE });

      sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "hello from #747" }] } as any);
      await expect(stat(sessionManager.getSessionFile()!)).rejects.toMatchObject({ code: FILE_NOT_FOUND_CODE });
      sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "materialized for #747" }] } as any);

      const sessionFile = sessionManager.getSessionFile()!;
      const entries = await readSessionEntries(sessionFile);
      const header = entries.find((entry) => entry.type === "session");
      const marker = entries.find(
        (entry): entry is CustomEntry => entry.type === "custom" && entry.id === markerId,
      );
      const title = entries.find(
        (entry): entry is SessionInfoEntry => entry.type === "session_info" && entry.id === titleId,
      );
      const messages = entries.filter((entry): entry is SessionMessageEntry => entry.type === "message");

      expect(header).toEqual(expect.objectContaining({ id: chosenId, cwd: runtimeCwd }));
      expect(marker).toEqual(expect.objectContaining({
        customType: "boring.compat.prompt_intent",
        data: expect.objectContaining({ operationId: "op-compat-747" }),
      }));
      expect(title).toEqual(expect.objectContaining({ name: COMPAT_TITLE }));
      expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);

      const reopened = SessionManager.open(sessionFile, nativeSessionDir, runtimeCwd);
      expect(reopened.getSessionId()).toBe(chosenId);
      expect(reopened.getSessionName()).toBe(COMPAT_TITLE);
      expect(reopened.getEntries().some((entry) => entry.type === "custom" && entry.id === markerId)).toBe(true);

      const listed = await SessionManager.list(runtimeCwd, nativeSessionDir);
      expect(listed).toEqual([
        expect.objectContaining({
          id: chosenId,
          name: COMPAT_TITLE,
          cwd: runtimeCwd,
          path: sessionFile,
          messageCount: 2,
        }),
      ]);
    } finally {
      await rm(runtimeCwd, { recursive: true, force: true });
      await rm(sessionRoot, { recursive: true, force: true });
    }
  });

  it("lets the standalone Pi CLI resume scanner see the same cwd/session directory", async () => {
    const runtimeCwd = await mkdtemp(join(tmpdir(), "boring-pi-cli-runtime-"));
    const sessionRoot = await mkdtemp(join(tmpdir(), "boring-pi-cli-session-root-"));
    const store = new PiSessionStore(runtimeCwd, { sessionRoot, storageCwd: runtimeCwd });
    const nativeSessionDir = store.getSessionDir();
    const chosenId = "compat_747_cli_id";

    try {
      const sessionManager = SessionManager.create(runtimeCwd, nativeSessionDir, { id: chosenId });
      sessionManager.appendSessionInfo(COMPAT_TITLE);
      sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "cli sees this" }] } as any);
      sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "cli materialized this" }] } as any);

      const listed = await SessionManager.list(runtimeCwd, nativeSessionDir);
      expect(listed).toEqual([expect.objectContaining({ id: chosenId, name: COMPAT_TITLE })]);

      const result = await runPiResumeUntilOutputContains({
        cwd: runtimeCwd,
        sessionDir: nativeSessionDir,
        expected: COMPAT_TITLE,
      });
      expect(result.output).toContain(COMPAT_TITLE);
    } finally {
      await rm(runtimeCwd, { recursive: true, force: true });
      await rm(sessionRoot, { recursive: true, force: true });
    }
  }, 10_000);
});
