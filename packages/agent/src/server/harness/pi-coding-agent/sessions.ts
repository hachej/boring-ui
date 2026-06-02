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
import { readFileSync, readdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import {
  parseSessionEntries,
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
const SAFE_SESSION_NAMESPACE = /^[a-zA-Z0-9_-]+$/;

function sessionDirForNamespace(namespace: string): string {
  const safeNamespace = namespace.trim();
  if (!SAFE_SESSION_NAMESPACE.test(safeNamespace)) {
    throw new Error("session namespace must contain only letters, numbers, underscores, and dashes");
  }
  return join(homedir(), ".pi", "agent", "sessions", safeNamespace);
}

export interface PiSessionStoreOptions {
  sessionDir?: string;
  sessionNamespace?: string;
  /** Host/storage cwd used only to derive the default file-backed session directory. */
  storageCwd?: string;
}

export class PiSessionStore implements SessionStore {
  private cwd: string;
  private sessionDir: string;

  constructor(cwd: string, options?: string | PiSessionStoreOptions) {
    this.cwd = cwd;
    if (typeof options === "string") {
      this.sessionDir = options;
      return;
    }
    this.sessionDir = options?.sessionDir
      ?? (options?.sessionNamespace
        ? sessionDirForNamespace(options.sessionNamespace)
        : defaultSessionDir(options?.storageCwd ?? cwd));
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    const files = await readdir(this.sessionDir).catch(() => []);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const filepaths = jsonlFiles.map((f) => join(this.sessionDir, f));
    const referencedPiFiles = await this.referencedPiFiles(filepaths);
    const visibleFiles = filepaths.filter((filepath) => !referencedPiFiles.has(resolve(filepath)));

    const summaries = await Promise.all(
      visibleFiles.map((filepath) => this.summarizeFile(filepath)),
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
    const linkedPiFile = extractPiSessionFilePath(fileEntries);
    const linked = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
      ? await this.readLinkedPiSession(linkedPiFile)
      : null;
    const linkedEntries = linked?.entries.filter(
      (e): e is SessionEntry => e.type !== "session",
    ) ?? [];

    // Prefer a persisted UI snapshot if available — these are written by
    // the client after each turn and survive server restarts. When no
    // snapshot exists, rebuild the UI transcript from every persisted message
    // entry in file order rather than pi's compacted LLM working context.
    const uiSnapshot = extractLatestUiSnapshot(fileEntries);
    const transcriptEntries = linkedEntries.length > 0 ? linkedEntries : sessionEntries;
    const messages = uiSnapshot ?? dropEmptyAssistantMessages(piMessagesToUIMessages(
      transcriptEntries
        .filter((entry): entry is SessionMessageEntry => entry.type === "message")
        .map((entry) => entry.message),
      sessionId,
    ));

    const title = extractTitle(sessionEntries) ?? extractTitle(linkedEntries) ?? "New session";
    const turnCount = messages.filter((m) => m.role === "user").length;
    const updatedAtMs = Math.max(fileStat.mtime.getTime(), linked?.mtime.getTime() ?? 0);

    return {
      id: sessionId,
      title,
      createdAt: header?.timestamp ?? fileStat.birthtime.toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
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

  // Synchronous variant used during session initialization so that no async
  // I/O hop is introduced before createAgentSession (which would break test
  // timing when fake timers are in use). The file is tiny (metadata only).
  loadPiSessionFileSync(sessionId: string): string | null {
    if (!SAFE_ID.test(sessionId)) return null;
    try {
      const direct = join(this.sessionDir, `${sessionId}.jsonl`);
      let content: string;
      try {
        content = readFileSync(direct, "utf-8");
      } catch {
        const files = readdirSync(this.sessionDir).filter((f) =>
          f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`,
        );
        if (files.length === 0) return null;
        content = readFileSync(join(this.sessionDir, files[0]), "utf-8");
      }
      const entries = safeParseEntries(content);
      let piFilePath: string | null = null;
      for (const e of entries) {
        const rec = e as { type?: string; path?: string };
        if (rec.type === "pi_session_file" && typeof rec.path === "string") {
          piFilePath = rec.path;
        }
      }
      return piFilePath;
    } catch {
      return null;
    }
  }

  async loadPiSessionFile(_ctx: SessionCtx, sessionId: string): Promise<string | null> {
    try {
      const filepath = await this.resolveSessionFile(sessionId);
      const content = await readFile(filepath, "utf-8");
      const entries = safeParseEntries(content);
      let piFilePath: string | null = null;
      for (const e of entries) {
        const rec = e as { type?: string; path?: string };
        if (rec.type === "pi_session_file" && typeof rec.path === "string") {
          piFilePath = rec.path;
        }
      }
      return piFilePath;
    } catch {
      return null;
    }
  }

  async savePiSessionFile(_ctx: SessionCtx, sessionId: string, piFilePath: string): Promise<void> {
    const filepath = await this.resolveSessionFile(sessionId);
    const entry = JSON.stringify({
      type: "pi_session_file",
      timestamp: new Date().toISOString(),
      path: piFilePath,
    });
    await appendFile(filepath, entry + "\n");
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const filepath = await this.resolveSessionFile(sessionId).catch(
      () => null,
    );
    if (!filepath) return;
    const linkedPiFile = await this.linkedPiFileFor(filepath);
    await rm(filepath, { force: true });
    if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
      await rm(linkedPiFile, { force: true });
    }
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

  private async linkedPiFileFor(filepath: string): Promise<string | null> {
    try {
      const content = await readFile(filepath, "utf-8");
      return extractPiSessionFilePath(safeParseEntries(content));
    } catch {
      return null;
    }
  }

  private async referencedPiFiles(filepaths: string[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    await Promise.all(filepaths.map(async (filepath) => {
      try {
        const content = await readFile(filepath, "utf-8");
        const piFilePath = extractPiSessionFilePath(safeParseEntries(content));
        if (piFilePath && resolve(piFilePath) !== resolve(filepath)) {
          referenced.add(resolve(piFilePath));
        }
      } catch {
        // Ignore unreadable files; summarizeFile will drop them later.
      }
    }));
    return referenced;
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
      const linkedPiFile = extractPiSessionFilePath(entries);
      const linked = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
        ? await this.readLinkedPiSession(linkedPiFile)
        : null;
      const linkedEntries = linked?.entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      ) ?? [];
      const uiSnapshot = extractLatestUiSnapshot(entries);

      const title =
        extractTitle(sessionEntries) ??
        extractTitle(linkedEntries) ??
        firstUserMessage(linkedEntries) ??
        firstUserMessage(sessionEntries) ??
        "New session";

      const turnCount = uiSnapshot
        ? uiSnapshot.filter((m) => m.role === "user").length
        : [...sessionEntries, ...linkedEntries].filter(
            (e) =>
              e.type === "message" &&
              ((e as SessionMessageEntry).message as any)?.role === "user",
          ).length;
      const updatedAtMs = Math.max(fileStat.mtime.getTime(), linked?.mtime.getTime() ?? 0);

      return {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: new Date(updatedAtMs).toISOString(),
        turnCount,
      };
    } catch {
      return null;
    }
  }

  private async readLinkedPiSession(filepath: string): Promise<{ entries: (SessionHeader | SessionEntry)[]; mtime: Date } | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readFile(filepath, "utf-8"),
      ]);
      return { entries: safeParseEntries(content), mtime: fileStat.mtime };
    } catch {
      return null;
    }
  }
}

function dropEmptyAssistantMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => !(message.role === "assistant" && (!message.parts || message.parts.length === 0)));
}

function extractPiSessionFilePath(entries: (SessionHeader | SessionEntry)[]): string | null {
  let piFilePath: string | null = null;
  for (const e of entries) {
    const rec = e as { type?: string; path?: string };
    if (rec.type === "pi_session_file" && typeof rec.path === "string") {
      piFilePath = rec.path;
    }
  }
  return piFilePath;
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

// Reconstructed message ids must be DETERMINISTIC across repeated loads of the
// same session file. If they were random (randomUUID), every GET /messages
// would return identical content but fresh ids, defeating the client's
// merge-by-id dedup and causing chat history to visually duplicate/stack on
// each browser reload. Derive a stable id from the session id + the message's
// position in the reconstructed list.
function reconstructedMessageId(
  sessionId: string | undefined,
  role: string,
  index: number,
): string {
  return sessionId ? `${sessionId}-${role}-${index}` : `${role}-${index}`;
}

function piMessagesToUIMessages(
  messages: unknown[],
  sessionId?: string,
): UIMessage[] {
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
          id: reconstructedMessageId(sessionId, "user", result.length),
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
          id: reconstructedMessageId(sessionId, "assistant", result.length),
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
