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
  open,
} from "node:fs/promises";
import { closeSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
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
  SessionListOptions,
} from "../../../shared/session.js";
import type { UIMessage } from "../../../shared/message.js";
import { dropEmptyAssistantUiMessages, sanitizeUiMessages } from "../../../shared/message-sanitizer.js";

function defaultSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(homedir(), ".pi", "agent", "sessions", safePath);
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_SESSION_NAMESPACE = /^[a-zA-Z0-9_-]+$/;
const SUMMARY_PREFIX_BYTES = 64 * 1024;

type SessionFileStat = { filepath: string; stat: Awaited<ReturnType<typeof fsStat>> };

interface PrefixCacheEntry {
  mtimeMs: number;
  size: number;
  referencedPiFile: string | null;
  linkedMtimeMs?: number;
  linkedSize?: number;
  summary?: SessionSummary | null;
}

interface NormalizedListOptions {
  limit: number | undefined;
  offset: number;
  includeId: string | undefined;
}

interface UiSnapshotRecord {
  messages: UIMessage[];
  timestampMs: number;
}

function sessionDirForNamespace(namespace: string): string {
  const safeNamespace = namespace.trim();
  if (!SAFE_SESSION_NAMESPACE.test(safeNamespace)) {
    throw new Error("session namespace must contain only letters, numbers, underscores, and dashes");
  }
  return join(homedir(), ".pi", "agent", "sessions", safeNamespace);
}

function normalizeListOptions(options: SessionListOptions | undefined): NormalizedListOptions {
  return {
    limit: options?.limit === undefined ? undefined : Math.max(0, options.limit),
    offset: Math.max(0, options?.offset ?? 0),
    includeId: options?.includeId,
  };
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
  private prefixCache = new Map<string, PrefixCacheEntry>();
  private listInFlight = new Map<string, Promise<SessionSummary[]>>();

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

  async list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]> {
    const normalizedOptions = normalizeListOptions(options);
    const inFlightKey = JSON.stringify([
      ctx.workspaceId,
      ctx.userId ?? null,
      normalizedOptions.limit ?? null,
      normalizedOptions.offset,
      normalizedOptions.includeId ?? null,
    ]);
    const inFlight = this.listInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const promise = this.listUncached(ctx, normalizedOptions);
    this.listInFlight.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      if (this.listInFlight.get(inFlightKey) === promise) this.listInFlight.delete(inFlightKey);
    }
  }

  private async listUncached(_ctx: SessionCtx, options: NormalizedListOptions): Promise<SessionSummary[]> {
    const files = await readdir(this.sessionDir).catch(() => []);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const filepaths = jsonlFiles.map((f) => join(this.sessionDir, f));
    const fileStats = await Promise.all(filepaths.map(async (filepath) => {
      try {
        return { filepath, stat: await fsStat(filepath) };
      } catch {
        return null;
      }
    }));
    const existingFiles = fileStats
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const referencedPiFiles = await this.referencedPiFiles(existingFiles);
    const visibleFiles = await Promise.all(existingFiles
      .filter(({ filepath }) => !referencedPiFiles.has(resolve(filepath)))
      .map(async (file) => ({
        ...file,
        sortMtimeMs: await this.sessionSortMtimeMs(file),
      })));
    visibleFiles.sort((a, b) => b.sortMtimeMs - a.sortMtimeMs);

    const { offset, limit } = options;
    const pageSummaries = await this.summarizeVisiblePage(visibleFiles, { offset, limit });
    const includeId = options.includeId;
    if (!includeId || pageSummaries.some((summary) => summary.id === includeId)) return pageSummaries;

    const includeSummary = await this.summarizeIncludedSession(includeId, referencedPiFiles);
    return includeSummary ? [...pageSummaries, includeSummary] : pageSummaries;
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
    const transcriptEntries = linkedEntries.length > 0 ? linkedEntries : sessionEntries;
    const uiSnapshot = extractLatestUiSnapshot([...fileEntries, ...linkedEntries]);
    const resolvedSessionId = header?.id ?? sessionId;
    const messages = uiSnapshot && isUiSnapshotCurrent(uiSnapshot, transcriptEntries)
      ? uiSnapshot.messages
      : dropEmptyAssistantUiMessages(piMessagesToUIMessages(
          transcriptEntries
            .filter((entry): entry is SessionMessageEntry => entry.type === "message")
            .map((entry) => entry.message),
          resolvedSessionId,
        ));

    const title = extractTitle(sessionEntries) ?? extractTitle(linkedEntries) ?? "New session";
    const turnCount = messages.filter((m) => m.role === "user").length;
    const updatedAtMs = Math.max(fileStat.mtime.getTime(), linked?.mtime.getTime() ?? 0);

    return {
      id: resolvedSessionId,
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
      messages: sanitizeUiMessages(messages, { dropEmptyAssistantMessages: true }),
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
      let filepath = direct;
      let content: string;
      try {
        content = readFileSync(direct, "utf-8");
      } catch {
        const files = readdirSync(this.sessionDir).filter((f) =>
          f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`,
        );
        if (files.length === 0) return null;
        filepath = join(this.sessionDir, files[0]);
        content = readFileSync(filepath, "utf-8");
      }
      const entries = safeParseEntries(content);
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (linkedPiFile) return linkedPiFile;
      if (!isTimestampNamedPiSessionFile(filepath, sessionId)) return null;
      const existingWrapper = this.findWrapperReferencingNativeSessionSync(filepath);
      if (existingWrapper) {
        const existingEntries = parseJsonlPrefixEntries(readJsonlPrefixSync(existingWrapper));
        if (extractSessionHeaderId(existingEntries) !== sessionId) return null;
        return extractPiSessionFilePath(existingEntries);
      }
      this.ensureWrapperForNativeSessionSync(sessionId, filepath, entries);
      return filepath;
    } catch {
      return null;
    }
  }

  async loadPiSessionFile(_ctx: SessionCtx, sessionId: string): Promise<string | null> {
    try {
      const filepath = await this.resolveSessionFile(sessionId);
      const content = await readFile(filepath, "utf-8");
      return extractPiSessionFilePath(safeParseEntries(content))
        ?? (isTimestampNamedPiSessionFile(filepath, sessionId) ? filepath : null);
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
    const fileSessionId = await this.readSessionFileId(filepath);
    if (fileSessionId && fileSessionId !== sessionId) return;
    const linkedPiFile = await this.linkedPiFileFor(filepath);
    await rm(filepath, { force: true });
    this.prefixCache.delete(filepath);
    if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
      await rm(linkedPiFile, { force: true });
      this.prefixCache.delete(linkedPiFile);
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
    const matchedPath = join(this.sessionDir, match);
    if (!isTimestampNamedPiSessionFile(matchedPath, sessionId)) return matchedPath;
    const existingWrapper = await this.findWrapperReferencingNativeSession(matchedPath);
    if (existingWrapper) {
      const wrapperSessionId = await this.readSessionFileId(existingWrapper);
      if (wrapperSessionId === sessionId) return existingWrapper;
      throw new Error(`Session not found: ${sessionId}`);
    }
    return this.ensureWrapperForNativeSession(sessionId, matchedPath);
  }

  private async readSessionFileId(filepath: string): Promise<string | null> {
    try {
      const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
      return extractSessionHeaderId(entries);
    } catch {
      return null;
    }
  }

  private async linkedPiFileFor(filepath: string): Promise<string | null> {
    try {
      const content = await readFile(filepath, "utf-8");
      return extractPiSessionFilePath(safeParseEntries(content));
    } catch {
      return null;
    }
  }

  private async referencedPiFiles(files: SessionFileStat[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    await Promise.all(files.map(async ({ filepath, stat }) => {
      try {
        const piFilePath = (await this.readPrefixCache(filepath, stat)).referencedPiFile;
        if (piFilePath && resolve(piFilePath) !== resolve(filepath)) {
          referenced.add(resolve(piFilePath));
        }
      } catch {
        // Ignore unreadable files; summarizeFile will drop them later.
      }
    }));
    return referenced;
  }

  private async sessionSortMtimeMs({ filepath, stat }: SessionFileStat): Promise<number> {
    let sortMtimeMs = stat.mtime.getTime();
    try {
      const linkedPiFile = (await this.readPrefixCache(filepath, stat)).referencedPiFile;
      if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
        const linkedStat = await fsStat(linkedPiFile);
        sortMtimeMs = Math.max(sortMtimeMs, linkedStat.mtime.getTime());
      }
    } catch {
      // Fall back to the wrapper/native file mtime for unreadable links.
    }
    return sortMtimeMs;
  }

  private async summarizeFile(
    filepath: string,
    existingStat?: Awaited<ReturnType<typeof fsStat>>,
  ): Promise<SessionSummary | null> {
    try {
      const fileStat = existingStat ?? await fsStat(filepath);
      const cached = this.cachedPrefix(filepath, fileStat);
      if (cached && "summary" in cached && await this.cachedSummaryIsFresh(filepath, cached)) {
        return cached.summary ?? null;
      }

      const content = await readJsonlPrefix(filepath);

      const firstNewline = content.indexOf("\n");
      if (firstNewline === -1) return null;

      const header: SessionHeader = JSON.parse(
        content.slice(0, firstNewline),
      );
      if (header.type !== "session") return null;

      const entries = parseJsonlPrefixEntries(content);
      const sessionEntries = entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      );
      const linkedPiFile = extractPiSessionFilePath(entries);
      const linked = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
        ? await this.readLinkedPiSessionSummary(linkedPiFile)
        : null;
      const linkedEntries = linked?.entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      ) ?? [];

      const title =
        extractTitle(sessionEntries) ??
        extractTitle(linkedEntries) ??
        firstUserMessage(linkedEntries) ??
        firstUserMessage(sessionEntries) ??
        "New session";

      const turnCount = [...sessionEntries, ...linkedEntries].filter(
        (e) =>
          e.type === "message" &&
          ((e as SessionMessageEntry).message as any)?.role === "user",
      ).length;
      const updatedAtMs = Math.max(fileStat.mtime.getTime(), linked?.mtime.getTime() ?? 0);

      const summary = {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: new Date(updatedAtMs).toISOString(),
        turnCount,
      };
      this.prefixCache.set(filepath, {
        mtimeMs: fileStat.mtime.getTime(),
        size: Number(fileStat.size),
        referencedPiFile: linkedPiFile,
        ...(linked ? { linkedMtimeMs: linked.mtime.getTime(), linkedSize: linked.size } : {}),
        summary,
      });
      return summary;
    } catch {
      return null;
    }
  }

  private cachedPrefix(
    filepath: string,
    fileStat: Awaited<ReturnType<typeof fsStat>>,
  ): PrefixCacheEntry | undefined {
    const cached = this.prefixCache.get(filepath);
    if (!cached) return undefined;
    if (cached.mtimeMs !== fileStat.mtime.getTime() || cached.size !== Number(fileStat.size)) return undefined;
    return cached;
  }

  private async cachedSummaryIsFresh(filepath: string, cached: PrefixCacheEntry): Promise<boolean> {
    const linkedPiFile = cached.referencedPiFile;
    if (!linkedPiFile || resolve(linkedPiFile) === resolve(filepath)) return true;
    try {
      const linkedStat = await fsStat(linkedPiFile);
      return cached.linkedMtimeMs === linkedStat.mtime.getTime() && cached.linkedSize === Number(linkedStat.size);
    } catch {
      return cached.linkedMtimeMs === undefined && cached.linkedSize === undefined;
    }
  }

  private async readPrefixCache(
    filepath: string,
    fileStat: Awaited<ReturnType<typeof fsStat>>,
  ): Promise<PrefixCacheEntry> {
    const cached = this.cachedPrefix(filepath, fileStat);
    if (cached) return cached;

    const content = await readJsonlPrefix(filepath);
    const entry: PrefixCacheEntry = {
      mtimeMs: fileStat.mtime.getTime(),
      size: Number(fileStat.size),
      referencedPiFile: extractPiSessionFilePath(parseJsonlPrefixEntries(content)),
    };
    this.prefixCache.set(filepath, entry);
    return entry;
  }

  private async summarizeVisiblePage(
    visibleFiles: Array<{ filepath: string; stat: Awaited<ReturnType<typeof fsStat>> }>,
    options: { offset: number; limit: number | undefined },
  ): Promise<SessionSummary[]> {
    if (options.limit === 0) return [];

    const page: SessionSummary[] = [];
    let validSeen = 0;
    let index = 0;
    const batchSize = options.limit === undefined
      ? Math.max(1, visibleFiles.length)
      : Math.max(1, options.limit);

    while (index < visibleFiles.length && (options.limit === undefined || page.length < options.limit)) {
      const batch = visibleFiles.slice(index, index + batchSize);
      index += batch.length;
      const summaries = await Promise.all(
        batch.map(({ filepath, stat }) => this.summarizeFile(filepath, stat)),
      );

      for (const summary of summaries) {
        if (!summary) continue;
        if (validSeen < options.offset) {
          validSeen += 1;
          continue;
        }
        if (options.limit !== undefined && page.length >= options.limit) break;
        page.push(summary);
        validSeen += 1;
      }
    }

    return page;
  }

  private async summarizeIncludedSession(
    sessionId: string,
    referencedPiFiles: Set<string>,
  ): Promise<SessionSummary | null> {
    try {
      const filepath = await this.resolveSessionFile(sessionId);
      if (referencedPiFiles.has(resolve(filepath))) return null;
      return this.summarizeFile(filepath);
    } catch {
      return null;
    }
  }

  private findWrapperReferencingNativeSessionSync(nativePath: string): string | null {
    const resolvedNativePath = resolve(nativePath);
    try {
      const files = readdirSync(this.sessionDir).filter((file) => file.endsWith(".jsonl"));
      for (const file of files) {
        const filepath = join(this.sessionDir, file);
        if (resolve(filepath) === resolvedNativePath) continue;
        try {
          const linkedPiFile = extractPiSessionFilePath(parseJsonlPrefixEntries(readJsonlPrefixSync(filepath)));
          if (linkedPiFile && resolve(linkedPiFile) === resolvedNativePath) return filepath;
        } catch {
          // Ignore unreadable files while resolving imported native sessions.
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private async findWrapperReferencingNativeSession(nativePath: string): Promise<string | null> {
    const resolvedNativePath = resolve(nativePath);
    const files = await readdir(this.sessionDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filepath = join(this.sessionDir, file);
      if (resolve(filepath) === resolvedNativePath) continue;
      try {
        const linkedPiFile = extractPiSessionFilePath(parseJsonlPrefixEntries(await readJsonlPrefix(filepath)));
        if (linkedPiFile && resolve(linkedPiFile) === resolvedNativePath) return filepath;
      } catch {
        // Ignore unreadable files while resolving imported native sessions.
      }
    }
    return null;
  }

  private ensureWrapperForNativeSessionSync(
    sessionId: string,
    nativePath: string,
    entries: (SessionHeader | SessionEntry)[],
  ): string {
    const wrapperPath = join(this.sessionDir, `${sessionId}.jsonl`);
    if (resolve(wrapperPath) === resolve(nativePath)) return wrapperPath;
    try {
      readFileSync(wrapperPath, "utf-8");
      return wrapperPath;
    } catch {
      // Create the metadata wrapper below.
    }
    try {
      writeFileSync(
        wrapperPath,
        buildNativePiSessionWrapper(sessionId, this.cwd, nativePath, entries),
        { encoding: "utf-8", flag: "wx" },
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    this.prefixCache.delete(wrapperPath);
    return wrapperPath;
  }

  private async ensureWrapperForNativeSession(sessionId: string, nativePath: string): Promise<string> {
    const wrapperPath = join(this.sessionDir, `${sessionId}.jsonl`);
    if (resolve(wrapperPath) === resolve(nativePath)) return wrapperPath;
    try {
      await fsStat(wrapperPath);
      return wrapperPath;
    } catch {
      // Create the metadata wrapper below.
    }

    const entries = parseJsonlPrefixEntries(await readJsonlPrefix(nativePath));
    try {
      await writeFile(
        wrapperPath,
        buildNativePiSessionWrapper(sessionId, this.cwd, nativePath, entries),
        { encoding: "utf-8", flag: "wx" },
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    this.prefixCache.delete(wrapperPath);
    return wrapperPath;
  }

  private async readLinkedPiSession(filepath: string): Promise<{ entries: (SessionHeader | SessionEntry)[]; mtime: Date; size: number } | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readFile(filepath, "utf-8"),
      ]);
      return { entries: safeParseEntries(content), mtime: fileStat.mtime, size: Number(fileStat.size) };
    } catch {
      return null;
    }
  }

  private async readLinkedPiSessionSummary(filepath: string): Promise<{ entries: (SessionHeader | SessionEntry)[]; mtime: Date; size: number } | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readJsonlPrefix(filepath),
      ]);
      return { entries: parseJsonlPrefixEntries(content), mtime: fileStat.mtime, size: Number(fileStat.size) };
    } catch {
      return null;
    }
  }
}

async function readJsonlPrefix(filepath: string, maxBytes = SUMMARY_PREFIX_BYTES): Promise<string> {
  const handle = await open(filepath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    let content = buffer.subarray(0, bytesRead).toString("utf-8");
    if (bytesRead === maxBytes) {
      const lastNewline = content.lastIndexOf("\n");
      if (lastNewline >= 0) content = content.slice(0, lastNewline + 1);
    }
    return content;
  } finally {
    await handle.close();
  }
}

function readJsonlPrefixSync(filepath: string, maxBytes = SUMMARY_PREFIX_BYTES): string {
  const fd = openSync(filepath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    let content = buffer.subarray(0, bytesRead).toString("utf-8");
    if (bytesRead === maxBytes) {
      const lastNewline = content.lastIndexOf("\n");
      if (lastNewline >= 0) content = content.slice(0, lastNewline + 1);
    }
    return content;
  } finally {
    closeSync(fd);
  }
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

function buildNativePiSessionWrapper(
  sessionId: string,
  cwd: string,
  piFilePath: string,
  entries: (SessionHeader | SessionEntry)[],
): string {
  const nativeHeader = entries.find((entry): entry is SessionHeader => entry.type === "session");
  const timestamp = nativeHeader?.timestamp ?? new Date().toISOString();
  return [
    {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp,
      cwd: nativeHeader?.cwd ?? cwd,
    },
    {
      type: "pi_session_file",
      timestamp,
      path: piFilePath,
    },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function extractSessionHeaderId(entries: (SessionHeader | SessionEntry)[]): string | null {
  const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
  return header?.id ?? null;
}

function isTimestampNamedPiSessionFile(filepath: string, sessionId: string): boolean {
  return basename(filepath).endsWith(`_${sessionId}.jsonl`);
}

function extractLatestUiSnapshot(entries: (SessionHeader | SessionEntry)[]): UiSnapshotRecord | null {
  let latest: UiSnapshotRecord | null = null;
  for (const e of entries) {
    const rec = e as { type?: string; messages?: unknown; timestamp?: unknown };
    if (rec.type === "ui_snapshot" && Array.isArray(rec.messages)) {
      const timestampMs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
      const snapshot = {
        messages: sanitizeUiMessages(rec.messages as UIMessage[], { dropEmptyAssistantMessages: true }),
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
      };
      if (!latest || snapshot.timestampMs >= latest.timestampMs) latest = snapshot;
    }
  }
  return latest;
}

function isUiSnapshotCurrent(snapshot: UiSnapshotRecord, transcriptEntries: SessionEntry[]): boolean {
  const latestMessageTimestamp = latestMessageTimestampMs(transcriptEntries);
  return latestMessageTimestamp === undefined || snapshot.timestampMs >= latestMessageTimestamp;
}

function latestMessageTimestampMs(entries: SessionEntry[]): number | undefined {
  let latest: number | undefined;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const timestampMs = Date.parse((entry as { timestamp?: string }).timestamp ?? "");
    if (!Number.isFinite(timestampMs)) continue;
    latest = latest === undefined ? timestampMs : Math.max(latest, timestampMs);
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
    const text = textFromPiContent(msg.content);
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

function parseJsonlPrefixEntries(content: string): (SessionHeader | SessionEntry)[] {
  const entries: (SessionHeader | SessionEntry)[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Prefix summaries should tolerate malformed or truncated tail lines.
    }
  }
  return entries;
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

function textFromPiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = part as { type?: unknown; text?: unknown } | null;
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join("");
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
        const text = textFromPiContent(msg.content);

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
          for (const rawItem of msg.content) {
            const item = rawItem as {
              type?: unknown;
              text?: unknown;
              thinking?: unknown;
              name?: unknown;
              id?: unknown;
              arguments?: unknown;
            } | null;
            if (!item || typeof item !== "object") continue;
            switch (item.type) {
              case "text":
                parts.push({ type: "text", text: typeof item.text === "string" ? item.text : "", state: "done" });
                break;
              case "thinking":
                parts.push({
                  type: "reasoning",
                  text: typeof item.thinking === "string" ? item.thinking : "",
                  state: "done",
                });
                break;
              case "toolCall":
                if (typeof item.name !== "string" || typeof item.id !== "string") break;
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
              ? msg.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n")
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
