import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  stat as fsStat,
  rm,
  mkdir,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { join } from "node:path";
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

export class PiSessionStore implements SessionStore {
  private sessionDir: string;

  constructor(cwd: string, sessionDir?: string) {
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
      cwd: this.sessionDir,
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
    const filepath = join(this.sessionDir, `${sessionId}.jsonl`);
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
    const context = buildSessionContext(sessionEntries);
    const messages = piMessagesToUIMessages(context.messages);

    const title = extractTitle(sessionEntries) ?? "New session";
    const turnCount = context.messages.filter(
      (m) => "role" in m && (m as any).role === "user",
    ).length;

    return {
      id: sessionId,
      title,
      createdAt: header?.timestamp ?? fileStat.birthtime.toISOString(),
      updatedAt: fileStat.mtime.toISOString(),
      turnCount,
      messages,
    };
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const filepath = join(this.sessionDir, `${sessionId}.jsonl`);
    await rm(filepath, { force: true });
  }

  touchSession(sessionId: string, title?: string): void {
    if (!title) return;
    const filepath = join(this.sessionDir, `${sessionId}.jsonl`);
    const entry: SessionInfoEntry = {
      type: "session_info",
      id: randomUUID(),
      parentId: null,
      timestamp: new Date().toISOString(),
      name: title,
    };
    appendFile(filepath, JSON.stringify(entry) + "\n").catch(() => {});
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
                parts.push({
                  type: "tool-invocation",
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
            p.type === "tool-invocation" && p.toolCallId === msg.toolCallId,
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
