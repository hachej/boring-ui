import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  stat as fsStat,
  rm,
  mkdir,
  writeFile,
  appendFile,
  utimes,
} from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import {
  parseSessionEntries,
  buildSessionContext,
  type SessionEntry,
  type SessionHeader,
  type SessionMessageEntry,
  type SessionInfoEntry,
  CURRENT_SESSION_VERSION,
} from "@mariozechner/pi-coding-agent";
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
} from "../../../shared/session.js";
import type { UIMessage } from "../../../shared/message.js";

function defaultSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(homedir(), ".pi", "agent", "sessions", safePath);
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export class PiSessionStore implements SessionStore {
  private cwd: string;
  private sessionDir: string;

  constructor(cwd: string, sessionDir?: string) {
    this.cwd = cwd;
    this.sessionDir = sessionDir ?? defaultSessionDir(cwd);
  }

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    const files = await readdir(this.sessionDir).catch(() => []);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const summaries = await Promise.all(
      jsonlFiles.map((f) => this.summarizeFile(join(this.sessionDir, f))),
    );

    return summaries
      .filter((s): s is SessionSummary => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(
    ctx: SessionCtx,
    init?: { title?: string },
  ): Promise<SessionSummary> {
    await mkdir(this.sessionDir, { recursive: true });

    const id = randomUUID();
    const now = new Date().toISOString();
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp: now,
      cwd: this.cwd,
    };

    const lines = [JSON.stringify(header)];
    if (init?.title) {
      const infoEntry: SessionInfoEntry = {
        type: "session_info",
        id: randomUUID(),
        parentId: null,
        timestamp: now,
        name: init.title,
      };
      lines.push(JSON.stringify(infoEntry));
    }

    const filepath = join(this.sessionDir, `${id}.jsonl`);
    await writeFile(filepath, lines.join("\n") + "\n", "utf-8");

    return {
      id,
      title: init?.title ?? "New session",
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    };
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const filepath = await this.resolveSessionFile(sessionId);
    let content: string;
    try {
      content = await readFile(filepath, "utf-8");
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const fileEntries = safeParseEntries(content);
    const header = fileEntries.find(
      (e): e is SessionHeader => e.type === "session",
    );
    const sessionEntries = fileEntries.filter(
      (e): e is SessionEntry => e.type !== "session",
    );

    const fileStat = await fsStat(filepath);

    // Prefer a persisted UI snapshot if available — these are written by
    // the client after each turn and survive server restarts. Fall back to
    // reconstructing from pi's native message format (which is empty when
    // SessionManager.inMemory() is used, so the fallback is mostly a no-op).
    const uiSnapshot = extractLatestUiSnapshot(fileEntries);
    const messages = uiSnapshot ?? piMessagesToUIMessages(
      buildSessionContext(sessionEntries).messages,
    );

    const title = extractTitle(sessionEntries) ?? "New session";
    const turnCount = messages.filter((m) => m.role === "user").length;

    return {
      id: sessionId,
      title,
      createdAt: header?.timestamp ?? fileStat.birthtime.toISOString(),
      updatedAt: fileStat.mtime.toISOString(),
      turnCount,
      messages,
    };
  }

  async saveMessages(ctx: SessionCtx, sessionId: string, messages: UIMessage[]): Promise<void> {
    const filepath = await this.resolveSessionFile(sessionId);
    const entry = JSON.stringify({
      type: "ui_snapshot",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      messages,
    });
    await appendFile(filepath, entry + "\n");
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const filepath = await this.resolveSessionFile(sessionId).catch(
      () => null,
    );
    if (filepath) await rm(filepath, { force: true });
  }

  touchSession(sessionId: string, title?: string): void {
    this.resolveSessionFile(sessionId)
      .then((filepath) => {
        if (title) {
          const entry: SessionInfoEntry = {
            type: "session_info",
            id: randomUUID(),
            parentId: null,
            timestamp: new Date().toISOString(),
            name: title,
          };
          return appendFile(filepath, JSON.stringify(entry) + "\n");
        }
        const now = new Date();
        return utimes(filepath, now, now);
      })
      .catch(() => {});
  }

  private async resolveSessionFile(sessionId: string): Promise<string> {
    if (!SAFE_ID.test(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const direct = join(this.sessionDir, `${sessionId}.jsonl`);
    try {
      await fsStat(direct);
      return direct;
    } catch {
      // Pi uses ${timestamp}_${id}.jsonl naming
    }
    const files = await readdir(this.sessionDir).catch(() => []);
    const match = files.find(
      (f) => f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`,
    );
    if (!match) throw new Error(`Session not found: ${sessionId}`);
    return join(this.sessionDir, match);
  }

  private async summarizeFile(
    filepath: string,
  ): Promise<SessionSummary | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readFile(filepath, "utf-8"),
      ]);

      const firstNewline = content.indexOf("\n");
      if (firstNewline === -1) return null;

      const header: SessionHeader = JSON.parse(
        content.slice(0, firstNewline),
      );
      if (header.type !== "session") return null;

      const entries = safeParseEntries(content);
      const sessionEntries = entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      );

      const title =
        extractTitle(sessionEntries) ??
        firstUserMessage(sessionEntries) ??
        "New session";

      const turnCount = sessionEntries.filter(
        (e) =>
          e.type === "message" &&
          ((e as SessionMessageEntry).message as any)?.role === "user",
      ).length;

      return {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: fileStat.mtime.toISOString(),
        turnCount,
      };
    } catch {
      return null;
    }
  }
}

function extractLatestUiSnapshot(entries: (SessionHeader | SessionEntry)[]): UIMessage[] | null {
  let latest: UIMessage[] | null = null;
  for (const e of entries) {
    const rec = e as { type?: string; messages?: unknown };
    if (rec.type === "ui_snapshot" && Array.isArray(rec.messages)) {
      latest = rec.messages as UIMessage[];
    }
  }
  return latest;
}

function extractTitle(entries: SessionEntry[]): string | undefined {
  const last = entries
    .filter((e): e is SessionInfoEntry => e.type === "session_info")
    .pop();
  return last?.name;
}

function firstUserMessage(entries: SessionEntry[]): string | undefined {
  for (const e of entries) {
    if (e.type !== "message") continue;
    const msg = (e as SessionMessageEntry).message as any;
    if (msg?.role !== "user") continue;
    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
          : "";
    if (text) return text.slice(0, 80);
  }
}

function safeParseEntries(
  content: string,
): (SessionHeader | SessionEntry)[] {
  try {
    return parseSessionEntries(content);
  } catch {
    const results: (SessionHeader | SessionEntry)[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        results.push(JSON.parse(line));
      } catch {
        // Skip malformed lines silently
      }
    }
    return results;
  }
}

function piMessagesToUIMessages(messages: unknown[]): UIMessage[] {
  const result: UIMessage[] = [];
  let currentAssistant: UIMessage | null = null;

  for (const raw of messages) {
    const msg = raw as any;
    if (!msg || typeof msg !== "object" || !("role" in msg)) continue;

    switch (msg.role) {
      case "user": {
        currentAssistant = null;
        const content = msg.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("")
              : "";

        result.push({
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        } as UIMessage);
        break;
      }

      case "assistant": {
        const parts: any[] = [];
        if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            switch (item.type) {
              case "text":
                parts.push({ type: "text", text: item.text, state: "done" });
                break;
              case "thinking":
                parts.push({
                  type: "reasoning",
                  text: item.thinking,
                  state: "done",
                });
                break;
              case "toolCall":
                // AI SDK convention: static tool parts use `type: "tool-${toolName}"`.
                // The frontend's `getToolName()` reads the suffix after the
                // first hyphen, so "tool-invocation" yields the tool name
                // "invocation" — which doesn't match any registered renderer
                // and falls back to the generic fallback. Use the actual tool
                // name in the type discriminator so renderers (exec_ui, read,
                // bash, etc.) match.
                parts.push({
                  type: `tool-${item.name}`,
                  toolCallId: item.id,
                  toolName: item.name,
                  state: "input-available",
                  input: item.arguments,
                });
                break;
            }
          }
        }
        const uiMsg = {
          id: randomUUID(),
          role: "assistant",
          parts,
        } as UIMessage;
        result.push(uiMsg);
        currentAssistant = uiMsg;
        break;
      }

      case "toolResult": {
        if (!currentAssistant) break;
        const toolPart = (currentAssistant.parts as any[]).find(
          (p) =>
            typeof p.type === "string" && p.type.startsWith("tool-") && p.toolCallId === msg.toolCallId,
        );
        if (toolPart) {
          if (msg.isError) {
            toolPart.state = "output-error";
            toolPart.errorText = Array.isArray(msg.content)
              ? msg.content.map((c: any) => c.text).join("\n")
              : String(msg.content);
          } else {
            toolPart.state = "output-available";
            toolPart.output = msg.content;
          }
        }
        break;
      }
    }
  }

  return result;
}
